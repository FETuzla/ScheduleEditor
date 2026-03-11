import express from "express";
import session from "express-session";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// =============================================================================
// SETUP & CONFIG
// =============================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "changeme";
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";
const PORT = process.env.PORT || 3000;

const DATA_FILE = path.join(__dirname, "data", "schedule.json");
const DRAFT_FILE = path.join(__dirname, "data", "draft.json");
const CHANGELOG_FILE = path.join(__dirname, "data", "changelog.json");
const LOCATIONS_FILE = path.join(__dirname, "data", "locations.json");

const CSV_HEADERS = [
  "year",
  "orientation",
  "name",
  "displayName",
  "day",
  "startTime",
  "endTime",
  "location",
  "teacher",
  "type",
];

// =============================================================================
// MIDDLEWARE
// =============================================================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 }, // 8 hours
  }),
);
app.use(express.static(path.join(__dirname, "public")));

// =============================================================================
// DATA HELPERS
// =============================================================================

async function readJSON(filePath, fallback = []) {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

async function writeJSON(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

async function readData() {
  return readJSON(DATA_FILE);
}
async function writeData(data) {
  return writeJSON(DATA_FILE, data);
}

async function readDraft() {
  try {
    const raw = await fs.readFile(DRAFT_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    // No draft yet — seed from published data
    const data = await readData();
    await writeDraft(data);
    return data;
  }
}
async function writeDraft(data) {
  return writeJSON(DRAFT_FILE, data);
}

async function readChangelog() {
  try {
    const raw = await fs.readFile(CHANGELOG_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    await writeChangelog([]);
    return [];
  }
}
async function writeChangelog(changelog) {
  return writeJSON(CHANGELOG_FILE, changelog);
}

async function readLocations() {
  return readJSON(LOCATIONS_FILE, []);
}
async function writeLocations(data) {
  return writeJSON(LOCATIONS_FILE, data);
}

function toCSV(rows) {
  const lines = [CSV_HEADERS.join(",")];
  for (const row of rows) {
    const vals = CSV_HEADERS.map((h) => {
      const v = String(row[h] ?? "").replace(/"/g, '""');
      return v.includes(",") || v.includes('"') || v.includes("\n")
        ? `"${v}"`
        : v;
    });
    lines.push(vals.join(","));
  }
  return lines.join("\n");
}

// =============================================================================
// AUTH MIDDLEWARE
// =============================================================================

function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  res.status(401).json({ error: "Unauthorized" });
}

// =============================================================================
// PUBLIC ROUTES
// =============================================================================

app.get("/api/schedule.csv", async (req, res) => {
  const data = await readData();
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.send(toCSV(data));
});

// =============================================================================
// AUTH ROUTES
// =============================================================================

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.authenticated = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: "Invalid credentials" });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  res.json({ authenticated: !!req.session?.authenticated });
});

// =============================================================================
// SCHEDULE ROUTES (protected)
// =============================================================================

app.get("/api/schedule/live", requireAuth, async (req, res) => {
  res.json(await readData());
});

app.get("/api/schedule", requireAuth, async (req, res) => {
  res.json(await readDraft());
});

app.post("/api/schedule", requireAuth, async (req, res) => {
  const data = await readDraft();
  const item = { ...req.body, id: Date.now().toString() };
  data.push(item);
  await writeDraft(data);
  res.json(item);
});

// Bulk replace (CSV import)
app.put("/api/schedule", requireAuth, async (req, res) => {
  const rows = req.body;
  if (!Array.isArray(rows))
    return res.status(400).json({ error: "Expected array" });
  await writeData(rows);
  res.json({ ok: true, count: rows.length });
});

app.put("/api/schedule/:id", requireAuth, async (req, res) => {
  const data = await readDraft();
  const idx = data.findIndex((r) => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  data[idx] = { ...data[idx], ...req.body, id: req.params.id };
  await writeDraft(data);
  res.json(data[idx]);
});

app.delete("/api/schedule/:id", requireAuth, async (req, res) => {
  let data = await readDraft();
  const before = data.length;
  data = data.filter((r) => r.id !== req.params.id);
  if (data.length === before)
    return res.status(404).json({ error: "Not found" });
  await writeDraft(data);
  res.json({ ok: true });
});

app.post("/api/schedule/restore", requireAuth, async (req, res) => {
  const data = await readDraft();
  const item = req.body;
  if (data.find((r) => r.id === item.id)) return res.json(item); // already exists
  data.push(item);
  await writeDraft(data);
  res.json(item);
});

// =============================================================================
// PUBLISH ROUTE (protected)
// =============================================================================

app.post("/api/publish", requireAuth, async (req, res) => {
  const [draft, live] = await Promise.all([readDraft(), readData()]);
  await writeData(draft);

  const added = draft.filter((d) => !live.find((l) => l.id === d.id));
  const removed = live.filter((l) => !draft.find((d) => d.id === l.id));
  const modified = draft
    .filter((d) => {
      const old = live.find((l) => l.id === d.id);
      return old && JSON.stringify(old) !== JSON.stringify(d);
    })
    .map((d) => ({ before: live.find((l) => l.id === d.id), after: d }));

  const changelog = await readChangelog();
  changelog.unshift({
    publishedAt: new Date().toISOString(),
    added,
    removed,
    modified,
  });
  writeChangelog(changelog);

  res.json({ ok: true });
});

// =============================================================================
// LOCATIONS ROUTES (protected)
// =============================================================================

app.get("/api/locations", requireAuth, async (req, res) => {
  res.json(await readLocations());
});

app.post("/api/locations", requireAuth, async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Name required" });

  const locations = await readLocations();
  if (locations.includes(name.trim())) return res.json(locations);
  locations.push(name.trim());
  await writeLocations(locations);
  res.json(locations);
});

app.delete("/api/locations", requireAuth, async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Name required" });

  const [locations, data] = await Promise.all([readLocations(), readData()]);

  const updatedLocations = locations.filter((l) => l !== name.trim());
  const updatedData = data.map((row) => {
    const locs = (row.location || "")
      .split("/")
      .map((l) => l.trim())
      .filter((l) => l !== name.trim());
    return { ...row, location: locs.join("/") };
  });

  await writeLocations(updatedLocations);
  await writeData(updatedData);
  res.json(updatedLocations);
});

// =============================================================================
// SPA FALLBACK
// =============================================================================

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// =============================================================================
// START
// =============================================================================

app.listen(PORT, () => {
  console.log(`Schedule app running at http://localhost:${PORT}`);
  console.log(`Public CSV endpoint: http://localhost:${PORT}/api/schedule.csv`);
});

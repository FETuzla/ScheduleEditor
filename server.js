import express from "express";
import session from "express-session";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const DATA_FILE = path.join(__dirname, "data", "schedule.json");

// --- Config from env ---
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "changeme";
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";
const PORT = process.env.PORT || 3000;

// --- Middleware ---
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

// --- Data helpers ---
async function readData() {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeData(data) {
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
}

const DRAFT_FILE = path.join(__dirname, "data", "draft.json");

async function readDraft() {
  try {
    const raw = await fs.readFile(DRAFT_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") {
      const data = await readData();
      await writeDraft(data);
      return data;
    }
    throw err;
  }
}

async function writeDraft(data) {
  await fs.writeFile(DRAFT_FILE, JSON.stringify(data, null, 2), "utf-8");
}

const CHANGELOG_FILE = path.join(__dirname, "data", "changelog.json");

async function readChangelog() {
  try {
    const raw = await fs.readFile(CHANGELOG_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") {
      await writeChangelog([]);
      return [];
    }
    return [];
  }
}

async function writeChangelog(changelog) {
  await fs.writeFile(
    CHANGELOG_FILE,
    JSON.stringify(changelog, null, 2),
    "utf-8",
  );
}

function toCSV(rows) {
  const headers = [
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
  const lines = [headers.join(",")];
  for (const row of rows) {
    const vals = headers.map((h) => {
      const v = String(row[h] ?? "").replace(/"/g, '""');
      return v.includes(",") || v.includes('"') || v.includes("\n")
        ? `"${v}"`
        : v;
    });
    lines.push(vals.join(","));
  }
  return lines.join("\n");
}

const LOCATIONS_FILE = path.join(__dirname, "data", "locations.json");

async function readLocations() {
  try {
    const raw = await fs.readFile(LOCATIONS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeLocations(data) {
  await fs.writeFile(LOCATIONS_FILE, JSON.stringify(data, null, 2), "utf-8");
}

// --- Auth middleware ---
function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  res.status(401).json({ error: "Unauthorized" });
}

// --- Public route: CSV export ---
app.get("/api/schedule.csv", async (req, res) => {
  const data = await readData();
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.send(toCSV(data));
});

// --- Auth routes ---
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

// --- Schedule CRUD routes (protected) ---
app.get("/api/schedule/live", requireAuth, async (req, res) => {
  res.json(await readData());
});

app.post("/api/schedule/restore", requireAuth, async (req, res) => {
  const data = await readDraft();
  const item = req.body; // keep original id
  if (data.find((r) => r.id === item.id)) return res.json(item); // already exists
  data.push(item);
  await writeDraft(data);
  res.json(item);
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

app.put("/api/schedule", requireAuth, async (req, res) => {
  const rows = req.body;
  if (!Array.isArray(rows))
    return res.status(400).json({ error: "Expected array" });
  await writeDraft(rows);
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

app.post("/api/publish", requireAuth, async (req, res) => {
  const draft = await readDraft();
  const live = await readData();
  await writeData(draft);

  // compute diff
  const added = draft.filter((d) => !live.find((l) => l.id === d.id));
  const removed = live.filter((l) => !draft.find((d) => d.id === l.id));
  const modified = draft
    .filter((d) => {
      const old = live.find((l) => l.id === d.id);
      return old && JSON.stringify(old) !== JSON.stringify(d);
    })
    .map((d) => ({
      before: live.find((l) => l.id === d.id),
      after: d,
    }));

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

app.get("/api/locations", requireAuth, async (req, res) => {
  const locations = await readLocations();
  res.json(locations);
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

  // remove from locations
  let locations = await readLocations();
  locations = locations.filter((l) => l !== name.trim());
  await writeLocations(locations);

  // remove from all schedule rows
  let data = await readData();
  data = data.map((row) => {
    const locs = (row.location || "")
      .split("/")
      .map((l) => l.trim())
      .filter((l) => l !== name.trim());
    return { ...row, location: locs.join("/") };
  });
  await writeData(data);

  res.json(locations);
});

// --- Serve the SPA ---
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Schedule app running at http://localhost:${PORT}`);
  console.log(`Public CSV endpoint: http://localhost:${PORT}/api/schedule.csv`);
});

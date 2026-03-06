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
app.get("/api/schedule", requireAuth, async (req, res) => {
  const data = await readData();
  res.json(data);
});

app.post("/api/schedule", requireAuth, async (req, res) => {
  const data = await readData();
  const item = { ...req.body, id: Date.now().toString() };
  data.push(item);
  await writeData(data);
  res.json(item);
});

app.put("/api/schedule", requireAuth, async (req, res) => {
  const rows = req.body;
  if (!Array.isArray(rows))
    return res.status(400).json({ error: "Expected array" });
  await writeData(rows);
  res.json({ ok: true, count: rows.length });
});

app.put("/api/schedule/:id", requireAuth, async (req, res) => {
  const data = await readData();
  const idx = data.findIndex((r) => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  data[idx] = { ...data[idx], ...req.body, id: req.params.id };
  await writeData(data);
  res.json(data[idx]);
});

app.delete("/api/schedule/:id", requireAuth, async (req, res) => {
  let data = await readData();
  const before = data.length;
  data = data.filter((r) => r.id !== req.params.id);
  if (data.length === before)
    return res.status(404).json({ error: "Not found" });
  await writeData(data);
  res.json({ ok: true });
});

// --- Serve the SPA ---
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Schedule app running at http://localhost:${PORT}`);
  console.log(`Public CSV endpoint: http://localhost:${PORT}/api/schedule.csv`);
});

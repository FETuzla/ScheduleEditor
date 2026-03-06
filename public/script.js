// ── State ──────────────────────────────────────────────────────────────────
let rows = [];
let editingId = null;
let sortCol = "day",
  sortDir = 1;

// after
const DAYS_EN = [
  "Ponedjeljak",
  "Utorak",
  "Srijeda",
  "Četvrtak",
  "Petak",
  "Subota",
  "Nedjelja",
];
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
const DAY_LABELS_FULL = [
  "Ponedjeljak",
  "Utorak",
  "Srijeda",
  "Četvrtak",
  "Petak",
];
const DAY_LABELS_SHORT = ["PON", "UTO", "SRI", "ČET", "PET"];
const TYPES = ["Predavanje", "AV", "LV"];
const LOCATIONS = [
  "Room A101",
  "Room B202",
  "Room C303",
  "Auditorium",
  "Lab 1",
  "Lab 2",
  "Online",
  "Library",
];

let highlightedLecture = null;
let processedLectures = [];

// ── Selectors ──────────────────────────────────────────────────────────────
const SECOND_OPTIONS = {
  "Prva godina": ["Linija 1", "Linija 2"],
  "Druga godina": ["AR", "EEMS", "ESKE", "RI", "TK"],
  "Treca godina": ["AR", "EEMS", "ESKE", "RI", "TK"],
  "Cetvrta godina": ["AR", "EEMS", "ESKE", "RI", "TK"],
  BMI: [],
  TOI: ["Prva godina", "Druga godina", "Treca godina"],
  Profesori: null, // dynamic — derived from data
  Prostorije: null, // dynamic — derived from data
};

function getSecondOptions(first) {
  if (SECOND_OPTIONS[first] !== null) return SECOND_OPTIONS[first] ?? [];
  if (first === "Profesori") {
    return [
      ...new Set(
        rows.flatMap((r) =>
          (r.teacher || "")
            .split("/")
            .map((t) => t.replace(/\(.*\)/g, "").trim()),
        ),
      ),
    ]
      .filter(Boolean)
      .sort((a, b) => {
        const priorityDiff = this.getPriority(a) - this.getPriority(b);
        if (priorityDiff !== 0) return priorityDiff;

        return a.localeCompare(b, "bs"); //
      });
  }
  if (first === "Prostorije") {
    return [
      ...new Set(rows.map((r) => (r.location || "").split("/")[0].trim())),
    ]
      .filter(Boolean)
      .sort();
  }
  return [];
}

function populateSecond(secondEl, first, currentVal) {
  const opts = getSecondOptions(first);
  secondEl.innerHTML = opts.length
    ? opts
        .map(
          (o) => `<option${o === currentVal ? " selected" : ""}>${o}</option>`,
        )
        .join("")
    : '<option value="">—</option>';
  secondEl.disabled = opts.length === 0;
}

function onCanvasFirstChange() {
  const first = document.getElementById("canvas-first").value;
  populateSecond(document.getElementById("canvas-second"), first, null);
  updateProcessedLectures();
}

function onTableFirstChange() {
  const first = document.getElementById("table-first").value;
  populateSecond(document.getElementById("table-second"), first, null);
  renderTable();
}

// hook second-select changes
document
  .getElementById("canvas-second")
  .addEventListener("change", () => updateProcessedLectures());
document
  .getElementById("table-second")
  .addEventListener("change", () => renderTable());

// ── Auth ───────────────────────────────────────────────────────────────────
async function checkAuth() {
  const r = await fetch("/api/me");
  const d = await r.json();
  d.authenticated ? showApp() : showLogin();
}
function showLogin() {
  document.getElementById("login-view").style.display = "flex";
  document.getElementById("app-view").style.display = "none";
}
function showApp() {
  document.getElementById("login-view").style.display = "none";
  document.getElementById("app-view").style.display = "flex";
  loadData();
}
async function doLogin() {
  const username = document.getElementById("login-user").value;
  const password = document.getElementById("login-pass").value;
  const r = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (r.ok) {
    showApp();
    document.getElementById("login-error").textContent = "";
  } else
    document.getElementById("login-error").textContent = "Invalid credentials.";
}
async function doLogout() {
  await fetch("/api/logout", { method: "POST" });
  showLogin();
}
document.getElementById("login-pass").addEventListener("keydown", (e) => {
  if (e.key === "Enter") doLogin();
});

// ── Data ───────────────────────────────────────────────────────────────────
async function loadData() {
  setStatus("Loading…", false);
  rows = await (await fetch("/api/schedule")).json();
  // refresh dynamic second options if currently on Profesori/Prostorije
  populateSecond(
    document.getElementById("canvas-second"),
    document.getElementById("canvas-first").value,
    document.getElementById("canvas-second").value,
  );
  populateSecond(
    document.getElementById("table-second"),
    document.getElementById("table-first").value,
    document.getElementById("table-second").value,
  );
  updateProcessedLectures();
  renderTable();
  setStatus(`${rows.length} rows`, false);
}

function setStatus(msg, saving) {
  document.getElementById("status-text").textContent = msg;
  document.getElementById("status-dot").className =
    "status-dot" + (saving ? " saving" : "");
}

// ── Canvas — exact port of drawing-tool.ts ────────────────────────────────
function getDecimalHour(t) {
  const [hh, mm] = t.split(":").map(Number);
  return hh + mm / 60;
}

function updateProcessedLectures() {
  processedLectures = [];
  const filtered = getRowsForSelectors("canvas-first", "canvas-second");
  const groups = new Map();
  filtered.forEach((lec) => {
    if (!lec.startTime || !lec.endTime) return;
    const dl = (lec.day || "").toLowerCase();
    const isWeekend = ["saturday", "sunday", "subota", "nedjelja"].includes(dl);
    const key = isWeekend ? "petak" : dl;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(lec);
  });
  groups.forEach((dayLectures, dayName) => {
    processedLectures.push(...processDayLayout(dayLectures, dayName));
  });
  renderCanvas();
}

function processDayLayout(dayLectures, dayName) {
  dayLectures = dayLectures.map((lec) =>
    ["saturday", "subota"].includes((lec.day || "").toLowerCase())
      ? { ...lec, startTime: "18:00", endTime: "20:00" }
      : lec,
  );
  const dayBase =
    {
      monday: 0,
      tuesday: 20,
      wednesday: 40,
      thursday: 60,
      friday: 80,
      saturday: 80,
      sunday: 80,
      ponedjeljak: 0,
      utorak: 20,
      srijeda: 40,
      četvrtak: 60,
      cetvrtak: 60,
      petak: 80,
      subota: 80,
      nedjelja: 80,
    }[dayName.toLowerCase()] ?? 0;
  const hourScale = 100 / HOURS.length;
  dayLectures.sort(
    (a, b) => getDecimalHour(a.startTime) - getDecimalHour(b.startTime),
  );

  const clusters = [];
  dayLectures.forEach((lec) => {
    const start = getDecimalHour(lec.startTime),
      end = getDecimalHour(lec.endTime);
    const target = clusters.find((c) =>
      c.some(
        (l) =>
          start < getDecimalHour(l.endTime) &&
          end > getDecimalHour(l.startTime),
      ),
    );
    if (target) target.push(lec);
    else clusters.push([lec]);
  });

  const result = [];
  clusters.forEach((cluster) => {
    const columns = [],
      assignedSlots = new Map();
    cluster.forEach((lec) => {
      const start = getDecimalHour(lec.startTime);
      let found = false;
      for (let i = 0; i < columns.length; i++) {
        if (columns[i] <= start) {
          columns[i] = getDecimalHour(lec.endTime);
          assignedSlots.set(lec, i);
          found = true;
          break;
        }
      }
      if (!found) {
        assignedSlots.set(lec, columns.length);
        columns.push(getDecimalHour(lec.endTime));
      }
    });
    const slotW = 20 / columns.length;
    cluster.forEach((l) => {
      result.push({
        ...l,
        topPercent: (getDecimalHour(l.startTime) - 8) * hourScale,
        heightPercent:
          (getDecimalHour(l.endTime) - getDecimalHour(l.startTime)) * hourScale,
        widthPercent: slotW,
        leftPercent: dayBase + assignedSlots.get(l) * slotW,
      });
    });
  });
  return result;
}

function getTextColor(type) {
  if (!type) return "#000";
  const t = type.toLowerCase();
  if (t === "lecture" || t === "predavanje") return "#ff0000";
  if (t === "lab" || t === "lv") return "#1b5e20";
  if (t === "seminar" || t === "av") return "#2600ff";
  return "#000";
}

function getWrappedLines(ctx, text, maxWidth) {
  const words = (text || "").split(" ");
  const lines = [];
  let current = words[0] || "";
  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    if (
      /^\d[a-zA-Z]/.test(word) ||
      ctx.measureText(current + " " + word).width > maxWidth
    ) {
      lines.push(current);
      current = word;
    } else {
      current += " " + word;
    }
  }
  lines.push(current);
  return lines;
}

function renderCanvas() {
  const canvas = document.getElementById("scheduleCanvas");
  const container = canvas.parentElement;
  if (!container) return;

  const sidebarWidth = 70,
    headerHeight = 45;
  const CW = 1920,
    CH = 1080;
  const dayWidth = (CW - sidebarWidth) / 5;
  const hourHeight = (CH - headerHeight) / HOURS.length;

  let dispW = container.clientWidth;
  if (dispW > 1000) dispW = 1000;
  canvas.style.width = dispW + "px";
  canvas.style.height = (dispW * 9) / 16 + "px";
  canvas.width = CW;
  canvas.height = CH;

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, CW, CH);
  ctx.lineWidth = CW / dispW;

  // Grid background
  ctx.fillStyle = "#f8f9fa";
  ctx.fillRect(0, 0, CW, CH);
  ctx.strokeStyle = "#000";

  // Header line
  ctx.beginPath();
  ctx.moveTo(0, headerHeight);
  ctx.lineTo(CW, headerHeight);
  ctx.stroke();

  // Day columns + labels
  ctx.beginPath();
  const dayFontSize = Math.max(14, Math.min(18, CW / 55));
  for (let i = 0; i <= 5; i++) {
    const x = sidebarWidth + i * dayWidth;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, CH);
    if (i < 5) {
      ctx.fillStyle = "#000";
      ctx.font = `bold ${dayFontSize}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(
        dispW < 700 ? DAY_LABELS_SHORT[i] : DAY_LABELS_FULL[i],
        x + dayWidth / 2,
        headerHeight / 2 + 4,
      );
    }
  }
  ctx.stroke();

  // Hour rows + labels
  ctx.beginPath();
  const hourFontSize = Math.max(14, Math.min(18, CW / 55));
  HOURS.forEach((hour, i) => {
    const y = headerHeight + i * hourHeight;
    ctx.moveTo(0, y);
    ctx.lineTo(sidebarWidth, y);
    ctx.save();
    ctx.font = `900 ${hourFontSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${hour}-${hour + 1}`, sidebarWidth / 2, y + hourHeight / 2);
    ctx.restore();
  });
  ctx.stroke();
  ctx.strokeRect(0, 0, CW, CH);

  // Lectures
  const availW = CW - sidebarWidth,
    availH = CH - headerHeight;
  processedLectures.forEach((lec) => {
    const x = sidebarWidth + (lec.leftPercent * availW) / 100;
    const y = headerHeight + (lec.topPercent * availH) / 100;
    const w = (lec.widthPercent * availW) / 100;
    const h = (lec.heightPercent * availH) / 100;

    ctx.fillStyle = highlightedLecture === lec ? "#bbdefb" : "#ffffff";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#000";
    ctx.strokeRect(x, y, w, h);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = getTextColor(lec.type);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const isLecture = (lec.type || "").toLowerCase() === "lecture";
    let teacherList = lec.teacher
      ? lec.teacher.split("/").map((t) => t.trim())
      : [];
    if (h < 30 || w < 40) teacherList = [];

    let fontSize = Math.max(
      16,
      Math.min(isLecture ? 32 : 26, CW / (isLecture ? 32 : 42)),
    );
    let lines = [],
      fontValid = false;
    const maxWidth = w - 4;

    while (!fontValid && fontSize > 4) {
      ctx.font = `bold ${fontSize}px sans-serif`;
      fontValid = true;
      for (const word of (lec.displayName || "").split(" ")) {
        if (ctx.measureText(word).width > maxWidth) {
          fontValid = false;
          fontSize -= 0.5;
          break;
        }
      }
      if (fontValid) {
        lines = getWrappedLines(ctx, lec.displayName, maxWidth);
        const tfs = Math.max(8, fontSize * 0.5);
        ctx.font = `${tfs}px sans-serif`;
        const wt = [];
        teacherList.forEach((t) =>
          getWrappedLines(ctx, t, maxWidth).forEach((l) => wt.push(l)),
        );
        const tot =
          lines.length * (fontSize + 2.5) +
          (fontSize * 0.85 + 2.5) +
          wt.length * (tfs + 2.5);
        if (tot > h - 4) {
          fontValid = false;
          fontSize -= 0.5;
        }
      }
    }

    ctx.font = `bold ${fontSize}px sans-serif`;
    lines = getWrappedLines(ctx, lec.displayName, maxWidth);
    const locFS = Math.max(9, fontSize * 0.75);
    const tFS = Math.max(8, fontSize * 0.6);
    const nameLH = fontSize + 2.5,
      locLH = locFS + 2.5,
      tLH = tFS + 2.5;

    ctx.font = `${tFS}px sans-serif`;
    const tLines = [];
    teacherList.forEach((t) =>
      getWrappedLines(ctx, t, maxWidth).forEach((l) => tLines.push(l)),
    );

    const totalH = lines.length * nameLH + locLH + tLines.length * tLH;
    let startY = y + (h - totalH) / 2 + nameLH / 2;
    if (startY < y + nameLH / 2) startY = y + nameLH / 2;

    let curY = startY;
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.fillStyle = getTextColor(lec.type);
    lines.forEach((line) => {
      ctx.fillText(line.trim(), x + w / 2, curY);
      curY += nameLH;
    });

    curY += (locLH - nameLH) / 2;
    ctx.font = `${locFS}px sans-serif`;
    ctx.fillText(lec.location || "", x + w / 2, curY);

    if (tLines.length > 0) {
      curY += (locLH + tLH) / 2;
      ctx.font = `${tFS}px sans-serif`;
      ctx.fillStyle = getTextColor(lec.type);
      tLines.forEach((line) => {
        ctx.fillText(line, x + w / 2, curY);
        curY += tLH;
      });
    }
    ctx.restore();
  });
}

document
  .getElementById("scheduleCanvas")
  .addEventListener("click", function (e) {
    const rect = this.getBoundingClientRect();
    const sW = 70,
      hH = 45;
    const cx = (e.clientX - rect.left) * (this.width / rect.width);
    const cy = (e.clientY - rect.top) * (this.height / rect.height);
    const aW = this.width - sW,
      aH = this.height - hH;
    const clicked = processedLectures.find((lec) => {
      const lx = sW + (lec.leftPercent * aW) / 100,
        ly = hH + (lec.topPercent * aH) / 100;
      const lw = (lec.widthPercent * aW) / 100,
        lh = (lec.heightPercent * aH) / 100;
      return cx >= lx && cx <= lx + lw && cy >= ly && cy <= ly + lh;
    });
    if (clicked) {
      highlightedLecture = clicked;
      renderCanvas();
      setTimeout(() => {
        highlightedLecture = null;
        renderCanvas();
      }, 150);
    }
  });

window.addEventListener("resize", renderCanvas);

function saveCanvas() {
  const link = document.createElement("a");
  link.href = document.getElementById("scheduleCanvas").toDataURL("image/png");
  link.download = "schedule.png";
  link.click();
}

function generateIcs() {
  if (!rows.length) return;
  const dayMap = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  const getNextDay = (name) => {
    const d = new Date(),
      target = dayMap[name.toLowerCase()] ?? 5;
    d.setDate(d.getDate() + ((target + 7 - d.getDay()) % 7));
    return d;
  };
  const fmt = (date, t) => {
    const [h, m] = t.split(":").map(Number),
      d = new Date(date);
    d.setHours(h, m, 0, 0);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
  };
  const stamp =
    new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  let ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ScheduleManager//EN"];
  rows.forEach((lec, i) => {
    if (!lec.startTime || !lec.endTime || !lec.day) return;
    const base = getNextDay(lec.day);
    ics.push(
      "BEGIN:VEVENT",
      `UID:sched-${Date.now()}-${i}@app`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${fmt(base, lec.startTime)}`,
      `DTEND:${fmt(base, lec.endTime)}`,
      `RRULE:FREQ=WEEKLY;COUNT=15`,
      `SUMMARY:${lec.name || lec.displayName || ""}`,
      `LOCATION:${lec.location || ""}`,
      `DESCRIPTION:Type: ${lec.type}\\nTeacher: ${lec.teacher || ""}`,
      "END:VEVENT",
    );
  });
  ics.push("END:VCALENDAR");
  const blob = new Blob([ics.join("\r\n")], { type: "text/calendar" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "schedule.ics";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

// ── Table ──────────────────────────────────────────────────────────────────
function sortBy(col) {
  if (sortCol === col) sortDir *= -1;
  else {
    sortCol = col;
    sortDir = 1;
  }
  renderTable();
}

function getFiltered() {
  const q = document.getElementById("filter-input").value.toLowerCase();
  const selectorFiltered = getRowsForSelectors("table-first", "table-second");
  return selectorFiltered
    .filter(
      (r) =>
        !q || Object.values(r).some((v) => String(v).toLowerCase().includes(q)),
    )
    .sort(
      (a, b) =>
        String(a[sortCol] ?? "").localeCompare(String(b[sortCol] ?? "")) *
        sortDir,
    );
}

function renderTable() {
  const filtered = getFiltered();
  document.getElementById("row-count").textContent = `${filtered.length} rows`;
  const tbody = document.getElementById("table-body");
  tbody.innerHTML = "";
  const FIELDS = [
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

  for (const row of filtered) {
    const tr = document.createElement("tr");
    if (editingId === row.id) tr.classList.add("is-editing");

    for (const f of FIELDS) {
      const td = document.createElement("td");
      if (editingId === row.id) {
        if (["day", "type", "location"].includes(f)) {
          const sel = document.createElement("select");
          sel.id = `edit-${f}`;
          const opts = f === "day" ? DAYS_EN : f === "type" ? TYPES : LOCATIONS;
          sel.innerHTML =
            `<option value="">—</option>` +
            opts
              .map(
                (o) =>
                  `<option${o === row[f] ? " selected" : ""}>${o}</option>`,
              )
              .join("");
          td.appendChild(sel);
        } else {
          const inp = document.createElement("input");
          inp.type = f.includes("Time") ? "time" : "text";
          inp.id = `edit-${f}`;
          inp.value = row[f] ?? "";
          td.appendChild(inp);
        }
      } else {
        td.textContent = row[f] ?? "";
      }
      tr.appendChild(td);
    }

    const actTd = document.createElement("td");
    const actDiv = document.createElement("div");
    actDiv.className = "actions-cell";
    if (editingId === row.id) {
      actDiv.innerHTML = `<button class="btn sm" onclick="saveEdit('${row.id}')">Save</button>
        <button class="btn outline sm" onclick="cancelEdit()">✕</button>`;
    } else {
      actDiv.innerHTML = `<button class="btn outline sm" onclick="startEdit('${row.id}')">Edit</button>
        <button class="btn danger sm" onclick="deleteRow('${row.id}')">Del</button>`;
    }
    actTd.appendChild(actDiv);
    tr.appendChild(actTd);
    tbody.appendChild(tr);
  }
}

function startEdit(id) {
  editingId = id;
  renderTable();
}
function cancelEdit() {
  editingId = null;
  renderTable();
}

async function saveEdit(id) {
  const FIELDS = [
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
  const body = {};
  FIELDS.forEach((f) => {
    body[f] = document.getElementById(`edit-${f}`)?.value ?? "";
  });
  setStatus("Saving…", true);
  await fetch(`/api/schedule/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  editingId = null;
  await loadData();
  setStatus("Saved ✓", false);
}

async function deleteRow(id) {
  if (!confirm("Delete this row?")) return;
  setStatus("Saving…", true);
  await fetch(`/api/schedule/${id}`, { method: "DELETE" });
  await loadData();
  setStatus("Deleted ✓", false);
}

// ── Modal ──────────────────────────────────────────────────────────────────
function openAddModal() {
  [
    "year",
    "orientation",
    "name",
    "displayName",
    "startTime",
    "endTime",
    "teacher",
  ].forEach((f) => (document.getElementById(`f-${f}`).value = ""));
  ["day", "type", "location"].forEach(
    (f) => (document.getElementById(`f-${f}`).value = ""),
  );
  document.getElementById("modal").classList.add("open");
}
function closeModal() {
  document.getElementById("modal").classList.remove("open");
}
document.getElementById("modal").addEventListener("click", (e) => {
  if (e.target === document.getElementById("modal")) closeModal();
});

async function saveModal() {
  const FIELDS = [
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
  const body = {};
  FIELDS.forEach((f) => {
    body[f] = document.getElementById(`f-${f}`).value;
  });
  setStatus("Saving…", true);
  await fetch("/api/schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  closeModal();
  await loadData();
  setStatus("Saved ✓", false);
}

// ── Init ───────────────────────────────────────────────────────────────────
populateSecond(
  document.getElementById("canvas-second"),
  document.getElementById("canvas-first").value,
  null,
);
populateSecond(
  document.getElementById("table-second"),
  document.getElementById("table-first").value,
  null,
);
checkAuth();

function importCSV(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const lines = e.target.result.trim().split("\n");
    const headers = lines[0].split(",").map((h) => h.trim());
    const rows = lines
      .slice(1)
      .map((line) => {
        // handle quoted fields
        const values = [];
        let current = "",
          inQuotes = false;
        for (const ch of line) {
          if (ch === '"') {
            inQuotes = !inQuotes;
          } else if (ch === "," && !inQuotes) {
            values.push(current.trim());
            current = "";
          } else {
            current += ch;
          }
        }
        values.push(current.trim());

        const row = { id: Date.now().toString() + Math.random() };
        headers.forEach((h, i) => {
          row[h] = values[i] ?? "";
        });
        return row;
      })
      .filter((r) => Object.values(r).some((v) => v)); // skip empty lines

    setStatus("Importing…", true);
    await fetch("/api/schedule", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rows),
    });
    input.value = ""; // reset so same file can be re-imported
    await loadData();
    setStatus(`Imported ${rows.length} rows`, false);
  };
  reader.readAsText(file);
}

// Add this helper:
function getRowsForSelectors(firstId, secondId) {
  const first = document.getElementById(firstId)?.value;
  const second = document.getElementById(secondId)?.value;
  if (!first) return rows;
  if (first === "Profesori")
    return rows.filter((r) => (r.teacher || "").includes(second));
  if (first === "Prostorije")
    return rows.filter((r) => (r.location || "").includes(second));
  // direct match against year and orientation fields
  return rows.filter((r) => {
    const yearMatch = r.year === first;
    const orientMatch = !second || second === "—" || r.orientation === second;
    return yearMatch && orientMatch;
  });
}

// map selector label → year number
function extractYear(first) {
  const map = {
    "Prva godina": 1,
    "Druga godina": 2,
    "Treca godina": 3,
    "Cetvrta godina": 4,
    BMI: null,
    TOI: null,
  };
  return map[first] ?? null;
}

function getPriority(title) {
  if (title.startsWith("red.prof.dr.")) return 1;
  if (title.startsWith("vanr.prof.dr.")) return 2;
  if (title.includes("doc.dr")) return 3;
  if (title.startsWith("v.as.MA")) return 4;
  if (title.startsWith("v.as.")) return 5;
  if (title.startsWith("as.")) return 6;
  if (title.startsWith("sp.MA")) return 7;
  return 8;
}

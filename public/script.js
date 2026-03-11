// =============================================================================
// CONSTANTS & CONFIGURATION
// =============================================================================

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

const DAY_BASE_MAP = {
  monday: 0,
  ponedjeljak: 0,
  tuesday: 20,
  utorak: 20,
  wednesday: 40,
  srijeda: 40,
  thursday: 60,
  četvrtak: 60,
  cetvrtak: 60,
  friday: 80,
  petak: 80,
  saturday: 80,
  subota: 80,
  sunday: 80,
  nedjelja: 80,
};

const TEACHER_PRIORITY_MAP = [
  { prefix: "red.prof.dr.", priority: 1 },
  { prefix: "vanr.prof.dr.", priority: 2 },
  { prefix: "doc.dr", priority: 3 },
  { prefix: "v.as.MA", priority: 4 },
  { prefix: "v.as.", priority: 5 },
  { prefix: "as.", priority: 6 },
  { prefix: "sp.MA", priority: 7 },
];

const SECOND_OPTIONS = {
  "Prva godina": ["Linija 1", "Linija 2"],
  "Druga godina": ["AR", "EEMS", "ESKE", "RI", "TK"],
  "Treca godina": ["AR", "EEMS", "ESKE", "RI", "TK"],
  "Cetvrta godina": ["AR", "EEMS", "ESKE", "RI", "TK"],
  BMI: [],
  TOI: ["Prva godina", "Druga godina", "Treca godina"],
  Predavači: null, // dynamic — derived from data
  Prostorije: null, // dynamic — derived from data
};

// =============================================================================
// STATE
// =============================================================================

let rows = [];
let liveRows = [];
let editingId = null;
let sortCol = "day";
let sortDir = 1;
let LOCATIONS = [];
let highlightedLecture = null;
let processedLectures = [];

// =============================================================================
// AUTH
// =============================================================================

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
  } else {
    document.getElementById("login-error").textContent = "Invalid credentials.";
  }
}

async function doLogout() {
  await fetch("/api/logout", { method: "POST" });
  showLogin();
}

document.getElementById("login-pass").addEventListener("keydown", (e) => {
  if (e.key === "Enter") doLogin();
});

// =============================================================================
// DATA
// =============================================================================

async function loadData() {
  setStatus("Loading…", false);
  await loadLocations();
  [rows, liveRows] = await Promise.all([
    fetch("/api/schedule").then((r) => r.json()),
    fetch("/api/schedule/live").then((r) => r.json()),
  ]);
  populateSecond(
    document.getElementById("canvas-second"),
    document.getElementById("canvas-first").value,
    document.getElementById("canvas-second").value,
  );
  updateProcessedLectures();
  renderTable();
  setStatus(`${rows.length} rows`, false);
}

async function loadLocations() {
  const r = await fetch("/api/locations");
  const data = await r.json();
  if (data.length > 0) LOCATIONS = data;
}

function setStatus(msg, saving) {
  document.getElementById("status-text").textContent = msg;
  document.getElementById("status-dot").className =
    "status-dot" + (saving ? " saving" : "");
}

function getRowStatus(row) {
  const live = liveRows.find((l) => l.id === row.id);
  if (!live) return "added";
  if (JSON.stringify(live) !== JSON.stringify(row)) return "modified";
  return null;
}

function hasUnpublishedChanges() {
  if (rows.length !== liveRows.length) return true;
  return rows.some((row) => {
    const live = liveRows.find((l) => l.id === row.id);
    return !live || JSON.stringify(live) !== JSON.stringify(row);
  });
}

window.addEventListener("beforeunload", (e) => {
  if (hasUnpublishedChanges()) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// =============================================================================
// SELECTORS
// =============================================================================

function getSecondOptions(first) {
  if (SECOND_OPTIONS[first] !== null) return SECOND_OPTIONS[first] ?? [];

  if (first === "Predavači") {
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
        const priorityDiff = getPriority(a) - getPriority(b);
        if (priorityDiff !== 0) return priorityDiff;
        return a.localeCompare(b, "bs");
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

function getRowsForSelectors(firstId, secondId) {
  const first = document.getElementById(firstId)?.value;
  const second = document.getElementById(secondId)?.value;
  if (!first) return rows;
  if (first === "Predavači")
    return rows.filter((r) => (r.teacher || "").includes(second));
  if (first === "Prostorije")
    return rows.filter((r) => (r.location || "").includes(second));
  return rows.filter((r) => {
    const yearMatch = r.year === first;
    const orientMatch = !second || second === "—" || r.orientation === second;
    return yearMatch && orientMatch;
  });
}

function onCanvasFirstChange() {
  const first = document.getElementById("canvas-first").value;
  populateSecond(document.getElementById("canvas-second"), first, null);
  updateProcessedLectures();
  renderTable();
}

document.getElementById("canvas-second").addEventListener("change", () => {
  updateProcessedLectures();
  renderTable();
});

// =============================================================================
// CANVAS — LAYOUT
// =============================================================================

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
  // Remap Saturday lectures to end-of-day Friday slot
  dayLectures = dayLectures.map((lec) =>
    ["saturday", "subota"].includes((lec.day || "").toLowerCase())
      ? { ...lec, startTime: "18:00", endTime: "20:00" }
      : lec,
  );

  const dayBase = DAY_BASE_MAP[dayName.toLowerCase()] ?? 0;
  const hourScale = 100 / HOURS.length;

  dayLectures.sort(
    (a, b) => getDecimalHour(a.startTime) - getDecimalHour(b.startTime),
  );

  // Group overlapping lectures into clusters
  const clusters = [];
  dayLectures.forEach((lec) => {
    const start = getDecimalHour(lec.startTime);
    const end = getDecimalHour(lec.endTime);
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

  // Assign columns within each cluster and compute layout percentages
  const result = [];
  clusters.forEach((cluster) => {
    const columns = [];
    const assignedSlots = new Map();

    cluster.forEach((lec) => {
      const start = getDecimalHour(lec.startTime);
      let placed = false;
      for (let i = 0; i < columns.length; i++) {
        if (columns[i] <= start) {
          columns[i] = getDecimalHour(lec.endTime);
          assignedSlots.set(lec, i);
          placed = true;
          break;
        }
      }
      if (!placed) {
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

// =============================================================================
// CANVAS — RENDERING
// =============================================================================

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const SIDEBAR_WIDTH = 70;
const HEADER_HEIGHT = 45;

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

  const CW = CANVAS_WIDTH;
  const CH = CANVAS_HEIGHT;
  const dayWidth = (CW - SIDEBAR_WIDTH) / 5;
  const hourHeight = (CH - HEADER_HEIGHT) / HOURS.length;

  const dispW = window.innerWidth * 0.8;
  canvas.style.width = dispW + "px";
  canvas.style.height = (dispW * 9) / 16 + "px";
  canvas.width = CW;
  canvas.height = CH;

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, CW, CH);
  ctx.lineWidth = CW / dispW;

  // Background
  ctx.fillStyle = "#f8f9fa";
  ctx.fillRect(0, 0, CW, CH);
  ctx.strokeStyle = "#000";

  // Header separator
  ctx.beginPath();
  ctx.moveTo(0, HEADER_HEIGHT);
  ctx.lineTo(CW, HEADER_HEIGHT);
  ctx.stroke();

  // Day columns & labels
  const dayFontSize = Math.max(14, Math.min(18, CW / 55));
  ctx.beginPath();
  for (let i = 0; i <= 5; i++) {
    const x = SIDEBAR_WIDTH + i * dayWidth;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, CH);
    if (i < 5) {
      ctx.fillStyle = "#000";
      ctx.font = `bold ${dayFontSize}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(
        dispW < 700 ? DAY_LABELS_SHORT[i] : DAY_LABELS_FULL[i],
        x + dayWidth / 2,
        HEADER_HEIGHT / 2 + 4,
      );
    }
  }
  ctx.stroke();

  // Hour rows & labels
  const hourFontSize = Math.max(14, Math.min(18, CW / 55));
  ctx.beginPath();
  HOURS.forEach((hour, i) => {
    const y = HEADER_HEIGHT + i * hourHeight;
    ctx.moveTo(0, y);
    ctx.lineTo(SIDEBAR_WIDTH, y);
    ctx.save();
    ctx.font = `900 ${hourFontSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${hour}-${hour + 1}`, SIDEBAR_WIDTH / 2, y + hourHeight / 2);
    ctx.restore();
  });
  ctx.stroke();
  ctx.strokeRect(0, 0, CW, CH);

  // Lecture blocks
  const availW = CW - SIDEBAR_WIDTH;
  const availH = CH - HEADER_HEIGHT;
  processedLectures.forEach((lec) => {
    const x = SIDEBAR_WIDTH + (lec.leftPercent * availW) / 100;
    const y = HEADER_HEIGHT + (lec.topPercent * availH) / 100;
    const w = (lec.widthPercent * availW) / 100;
    const h = (lec.heightPercent * availH) / 100;

    ctx.fillStyle = highlightedLecture === lec ? "#bbdefb" : "#ffffff";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#000";
    ctx.strokeRect(x, y, w, h);

    renderLectureText(ctx, lec, x, y, w, h);
  });
}

function renderLectureText(ctx, lec, x, y, w, h) {
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

  // Find the largest font size that fits
  let fontSize = Math.max(
    16,
    Math.min(isLecture ? 32 : 26, CANVAS_WIDTH / (isLecture ? 32 : 42)),
  );
  let lines = [];
  let fontValid = false;
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
      const tLines = [];
      teacherList.forEach((t) =>
        getWrappedLines(ctx, t, maxWidth).forEach((l) => tLines.push(l)),
      );
      const totalH =
        lines.length * (fontSize + 2.5) +
        (fontSize * 0.85 + 2.5) +
        tLines.length * (tfs + 2.5);
      if (totalH > h - 4) {
        fontValid = false;
        fontSize -= 0.5;
      }
    }
  }

  // Draw name lines
  ctx.font = `bold ${fontSize}px sans-serif`;
  lines = getWrappedLines(ctx, lec.displayName, maxWidth);

  const locFS = Math.max(9, fontSize * 0.75);
  const tFS = Math.max(8, fontSize * 0.6);
  const nameLH = fontSize + 2.5;
  const locLH = locFS + 2.5;
  const tLH = tFS + 2.5;

  ctx.font = `${tFS}px sans-serif`;
  const tLines = [];
  teacherList.forEach((t) =>
    getWrappedLines(ctx, t, maxWidth).forEach((l) => tLines.push(l)),
  );

  const totalH = lines.length * nameLH + locLH + tLines.length * tLH;
  let curY = y + (h - totalH) / 2 + nameLH / 2;
  if (curY < y + nameLH / 2) curY = y + nameLH / 2;

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
}

// Canvas — interaction & export

document
  .getElementById("scheduleCanvas")
  .addEventListener("click", function (e) {
    const rect = this.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (this.width / rect.width);
    const cy = (e.clientY - rect.top) * (this.height / rect.height);
    const aW = this.width - SIDEBAR_WIDTH;
    const aH = this.height - HEADER_HEIGHT;

    const clicked = processedLectures.find((lec) => {
      const lx = SIDEBAR_WIDTH + (lec.leftPercent * aW) / 100;
      const ly = HEADER_HEIGHT + (lec.topPercent * aH) / 100;
      const lw = (lec.widthPercent * aW) / 100;
      const lh = (lec.heightPercent * aH) / 100;
      return cx >= lx && cx <= lx + lw && cy >= ly && cy <= ly + lh;
    });

    if (!clicked) return;

    highlightedLecture = clicked;
    renderCanvas();
    setTimeout(() => {
      highlightedLecture = null;
      renderCanvas();
    }, 150);

    editingId = clicked.id;
    renderTable();
    setTimeout(() => {
      document
        .querySelector("tr.is-editing")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  });

window.addEventListener("resize", renderCanvas);

function saveCanvas() {
  const link = document.createElement("a");
  link.href = document.getElementById("scheduleCanvas").toDataURL("image/png");
  link.download = "schedule.png";
  link.click();
}

async function exportToPdf() {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF("l", "mm", "a4");
  const first = document.getElementById("canvas-first").value;
  const second = document.getElementById("canvas-second").value;

  const buildExportCanvas = (canvas, label, showLegend) => {
    const legendH = 45;
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height + legendH;
    const ctx = out.getContext("2d");

    // Legend bar
    ctx.fillStyle = "#f8f9fa";
    ctx.fillRect(0, 0, out.width, legendH);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, out.width, legendH);

    const fs = Math.round(legendH * 0.5);
    ctx.font = `bold ${fs}px sans-serif`;
    ctx.fillStyle = "#000";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 20, legendH / 2);

    if (showLegend) {
      const rectSize = Math.round(legendH * 0.85);
      const legendItems = [
        { color: "#ff0000", label: "Predavanje" },
        { color: "#2600ff", label: "AV" },
        { color: "#1b5e20", label: "LV" },
      ];
      ctx.font = `${fs}px sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";

      const napomena = "Napomena:";
      const napomenaW = ctx.measureText(napomena + " ").width;
      let lx = out.width - 20;
      for (let i = legendItems.length - 1; i >= 0; i--) {
        lx -=
          ctx.measureText(" " + legendItems[i].label + "  ").width +
          rectSize +
          10;
      }
      lx -= napomenaW;

      ctx.fillStyle = "#000";
      ctx.fillText(napomena + " ", lx, legendH / 2);
      lx += napomenaW;

      for (const item of legendItems) {
        ctx.fillStyle = item.color;
        ctx.fillRect(lx, legendH / 2 - rectSize / 2, rectSize, rectSize);
        lx += rectSize + 6;
        ctx.fillStyle = "#000";
        ctx.fillText(item.label + "  ", lx, legendH / 2);
        lx += ctx.measureText(item.label + "  ").width;
      }
    }

    ctx.drawImage(canvas, 0, legendH);
    return out.toDataURL("image/png");
  };

  // Single-page export for teachers / rooms
  if (first === "Profesori" || first === "Prostorije") {
    const canvas = document.getElementById("scheduleCanvas");
    const label = `${first}${second ? " - " + second : ""}`;
    pdf.addImage(
      buildExportCanvas(canvas, label, false),
      "PNG",
      10,
      10,
      277,
      0,
    );
    pdf.save(`${first} - ${second}.pdf`);
    return;
  }

  // One page per orientation for year-based selectors
  const opts = getSecondOptions(first);
  const orientations = opts.length > 0 ? opts : [null];
  const originalSecond = second;
  let firstPage = true;

  for (const orientation of orientations) {
    document.getElementById("canvas-second").value = orientation ?? "";
    updateProcessedLectures();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const canvas = document.getElementById("scheduleCanvas");
    const label = `${first}${orientation ? " - " + orientation : ""}`;
    if (!firstPage) pdf.addPage();
    pdf.addImage(buildExportCanvas(canvas, label, true), "PNG", 10, 10, 277, 0);
    firstPage = false;
  }

  document.getElementById("canvas-second").value = originalSecond;
  updateProcessedLectures();
  pdf.save(`${first}.pdf`);
}

// =============================================================================
// TABLE
// =============================================================================

const TABLE_FIELDS = [
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
  const selectorFiltered = getRowsForSelectors("canvas-first", "canvas-second");
  return selectorFiltered
    .filter(
      (r) =>
        !q || Object.values(r).some((v) => String(v).toLowerCase().includes(q)),
    )
    .sort((a, b) =>
      sortCol === "day"
        ? (DAYS_EN.findIndex((x) => x === a[sortCol]) -
            DAYS_EN.findIndex((x) => x === b[sortCol])) *
          sortDir
        : String(a[sortCol] ?? "").localeCompare(String(b[sortCol] ?? "")) *
          sortDir,
    );
}

function renderTable() {
  const filtered = getFiltered();
  const rowCountEl = document.getElementById("row-count");
  rowCountEl.textContent = `${filtered.length} predavanja`;
  rowCountEl.style.color = "rgba(255, 255, 255, 0.65)";

  const tbody = document.getElementById("table-body");
  tbody.innerHTML = "";

  for (const row of filtered) {
    tbody.appendChild(buildTableRow(row));
  }

  // Append soft-deleted (removed) rows
  const removedRows = liveRows.filter((l) => !rows.find((r) => r.id === l.id));
  for (const row of removedRows) {
    tbody.appendChild(buildRemovedRow(row));
  }
}

function buildTableRow(row) {
  const tr = document.createElement("tr");
  if (editingId === row.id) tr.classList.add("is-editing");
  const status = getRowStatus(row);
  if (status === "added") tr.classList.add("is-added");
  if (status === "modified") tr.classList.add("is-modified");

  for (const f of TABLE_FIELDS) {
    const td = document.createElement("td");
    if (editingId === row.id) {
      td.appendChild(buildEditCell(f, row));
    } else {
      td.textContent = row[f] ?? "";
    }
    tr.appendChild(td);
  }

  tr.appendChild(buildActionCell(row.id, true));
  return tr;
}

function buildRemovedRow(row) {
  const tr = document.createElement("tr");
  tr.classList.add("is-removed");
  TABLE_FIELDS.forEach((f) => {
    const td = document.createElement("td");
    td.textContent = row[f] ?? "";
    tr.appendChild(td);
  });
  const actDiv = document.createElement("div");
  actDiv.className = "actions-cell";
  actDiv.innerHTML = `<button class="btn outline sm" onclick="restoreRow('${row.id}')">Vrati</button>`;
  const actTd = document.createElement("td");
  actTd.appendChild(actDiv);
  tr.appendChild(actTd);
  return tr;
}

function buildEditCell(field, row) {
  if (field === "location") {
    return buildMultiSelect("edit-location", row[field] ?? "", true);
  }
  if (field === "day" || field === "type") {
    const sel = document.createElement("select");
    sel.id = `edit-${field}`;
    const opts = field === "day" ? DAYS_EN : TYPES;
    sel.innerHTML =
      `<option value="">—</option>` +
      opts
        .map(
          (o) => `<option${o === row[field] ? " selected" : ""}>${o}</option>`,
        )
        .join("");
    return sel;
  }
  const inp = document.createElement("input");
  inp.type = "text";
  inp.id = `edit-${field}`;
  inp.value = row[field] ?? "";
  if (field.includes("Time")) inp.placeholder = "08:00";
  return inp;
}

function buildActionCell(id, isEditing) {
  const actDiv = document.createElement("div");
  actDiv.className = "actions-cell";
  if (isEditing && editingId === id) {
    actDiv.innerHTML = `
      <button class="btn sm" onclick="saveEdit('${id}')">Save</button>
      <button class="btn outline sm" onclick="cancelEdit()">✕</button>`;
  } else {
    actDiv.innerHTML = `
      <button class="btn outline sm" onclick="startEdit('${id}')">Uredi</button>
      <button class="btn danger sm" onclick="deleteRow('${id}')">🗑</button>`;
  }
  const td = document.createElement("td");
  td.appendChild(actDiv);
  return td;
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
  const body = {};
  TABLE_FIELDS.forEach((f) => {
    body[f] =
      f === "location"
        ? getMultiSelectValue("edit-location")
        : (document.getElementById(`edit-${f}`)?.value ?? "");
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
  if (!confirm("Jeste li sigurni da želite obrisati ovo predavanje?")) return;
  setStatus("Saving…", true);
  await fetch(`/api/schedule/${id}`, { method: "DELETE" });
  await loadData();
  setStatus("Deleted ✓", false);
}

async function restoreRow(id) {
  const row = liveRows.find((l) => l.id === id);
  if (!row) return;
  setStatus("Saving…", true);
  await fetch("/api/schedule/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(row),
  });
  await loadData();
  setStatus("Vraćeno ✓", false);
}

async function publish() {
  if (!confirm("Objaviti raspored? Promjene će biti vidljive javno.")) return;
  setStatus("Objavljujem…", true);
  await fetch("/api/publish", { method: "POST" });
  await loadData();
  setStatus("Objavljeno ✓", false);
}

// =============================================================================
// MODAL — ADD ROW
// =============================================================================

function openAddModal() {
  ["name", "displayName", "startTime", "endTime", "teacher"].forEach(
    (f) => (document.getElementById(`f-${f}`).value = ""),
  );
  ["day", "type"].forEach(
    (f) => (document.getElementById(`f-${f}`).value = ""),
  );
  document.getElementById("f-year").selectedIndex = 0;
  onModalYearChange();

  const locWrap = document.getElementById("f-location-wrap");
  locWrap.innerHTML = "";
  locWrap.appendChild(buildMultiSelect("f-location", ""));

  document.getElementById("modal").classList.add("open");
}

function closeModal() {
  document.getElementById("modal").classList.remove("open");
}

document.getElementById("modal").addEventListener("click", (e) => {
  if (e.target === document.getElementById("modal")) closeModal();
});

function onModalYearChange() {
  const year = document.getElementById("f-year").value;
  const opts = SECOND_OPTIONS[year] ?? [];
  const sel = document.getElementById("f-orientation");
  sel.innerHTML = opts.length
    ? opts.map((o) => `<option>${o}</option>`).join("")
    : '<option value="">—</option>';
  sel.disabled = opts.length === 0;
}

async function saveModal() {
  const body = {};
  TABLE_FIELDS.forEach((f) => {
    body[f] =
      f === "location"
        ? getMultiSelectValue("f-location")
        : (document.getElementById(`f-${f}`)?.value ?? "");
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

// =============================================================================
// MODAL — LOCATIONS
// =============================================================================

function openLocationsModal() {
  renderLocationsList();
  document.getElementById("locations-modal").classList.add("open");
}

function closeLocationsModal() {
  document.getElementById("locations-modal").classList.remove("open");
}

document.getElementById("locations-modal").addEventListener("click", (e) => {
  if (e.target === document.getElementById("locations-modal"))
    closeLocationsModal();
});

function renderLocationsList() {
  const ul = document.getElementById("locations-list");
  ul.innerHTML = LOCATIONS.map(
    (loc, i) => `
    <li style="display:flex; align-items:center; justify-content:space-between;
               padding:6px 0; border-bottom:1px solid rgba(108,106,176,0.2); color:white; font-size:13px;">
      <span>${loc}</span>
      <button class="btn danger sm" onclick="removeLocation(${i})">🗑</button>
    </li>`,
  ).join("");
}

async function addLocation() {
  const input = document.getElementById("new-location-input");
  const name = input.value.trim();
  if (!name) return;
  const r = await fetch("/api/locations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  LOCATIONS = await r.json();
  input.value = "";
  renderLocationsList();
}

async function removeLocation(index) {
  const name = LOCATIONS[index];
  if (!confirm(`Obrisati prostoriju "${name}"?`)) return;
  const r = await fetch("/api/locations", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  LOCATIONS = await r.json();
  await loadData();
  renderLocationsList();
}

// =============================================================================
// CSV IMPORT
// =============================================================================

function importCSV(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const lines = e.target.result.trim().split("\n");
    const headers = lines[0].split(",").map((h) => h.trim());
    const parsed = lines
      .slice(1)
      .map((line) => {
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
      .filter((r) => Object.values(r).some((v) => v)); // skip blank lines

    setStatus("Importing…", true);
    await fetch("/api/schedule", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    });
    input.value = "";
    await loadData();
    setStatus(`Imported ${parsed.length} rows`, false);
  };
  reader.readAsText(file);
}

// =============================================================================
// MULTI-SELECT WIDGET
// =============================================================================

function buildMultiSelect(id, selectedSlashStr, inline = false) {
  const selected = selectedSlashStr
    ? selectedSlashStr
        .split("/")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const wrap = document.createElement("div");
  wrap.className = "multi-select-wrap" + (inline ? " inline" : "");

  const display = document.createElement("div");
  display.className = "multi-select-display";
  display.id = id + "-display";
  display.textContent = selected.length ? selected.join(" / ") : "—";

  const dropdown = document.createElement("div");
  dropdown.className = "multi-select-dropdown";
  dropdown.id = id + "-dropdown";

  LOCATIONS.forEach((loc) => {
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = loc;
    cb.checked = selected.includes(loc);
    cb.addEventListener("change", () => updateMultiSelectDisplay(id));
    label.appendChild(cb);
    label.appendChild(document.createTextNode(loc));
    dropdown.appendChild(label);
  });

  display.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdown.classList.toggle("open");
  });

  wrap.appendChild(display);
  wrap.appendChild(dropdown);
  return wrap;
}

function updateMultiSelectDisplay(id) {
  const dropdown = document.getElementById(id + "-dropdown");
  const display = document.getElementById(id + "-display");
  const checked = [
    ...dropdown.querySelectorAll('input[type="checkbox"]:checked'),
  ].map((cb) => cb.value);
  display.textContent = checked.length ? checked.join(" / ") : "—";
}

function getMultiSelectValue(id) {
  const dropdown = document.getElementById(id + "-dropdown");
  return [...dropdown.querySelectorAll('input[type="checkbox"]:checked')]
    .map((cb) => cb.value)
    .join("/");
}

document.addEventListener("click", () => {
  document
    .querySelectorAll(".multi-select-dropdown.open")
    .forEach((d) => d.classList.remove("open"));
});

// =============================================================================
// UTILITIES
// =============================================================================

function getPriority(title) {
  for (const { prefix, priority } of TEACHER_PRIORITY_MAP) {
    if (title.startsWith(prefix)) return priority;
  }
  return 8;
}

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

// =============================================================================
// INIT
// =============================================================================

populateSecond(
  document.getElementById("canvas-second"),
  document.getElementById("canvas-first").value,
  null,
);
checkAuth();

// ============================================================
// CONFIGURATION
// ============================================================
// Identifiant de la Google Sheet publique (lecture seule).
const SHEET_ID = "1VOqCt19cDgk06bNNxXoUoeReC_I09Bgub6kkvyu8hcc";
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;
const PHOTOS_DIR = "photos/";
const MANIFEST_URL = "manifest.json";

// ============================================================
// CSV PARSING (gère les guillemets et virgules dans les champs)
// ============================================================
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ""; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ""; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(f => f.trim() !== ""));
}

// ============================================================
// CORRESPONDANCE PHOTOS <-> LIGNES (gère les doublons d'espèces)
// ============================================================
// Google Drive renomme les fichiers en double : "Nom.JPG", "Nom 1.JPG", "Nom 2.JPG"...
// On associe ces variantes aux lignes du tableau dans l'ordre d'apparition.
function buildPhotoIndex(manifest) {
  // base name (sans extension, sans suffixe " N") -> liste triée de fichiers réels
  const groups = {};
  const re = /^(.*?)(?: (\d+))?\.(jpe?g|png|webp)$/i;
  manifest.forEach(filename => {
    const m = filename.match(re);
    if (!m) return;
    const base = m[1].trim().toLowerCase();
    const suffix = m[2] ? parseInt(m[2], 10) : -1; // -1 = pas de suffixe = premier
    if (!groups[base]) groups[base] = [];
    groups[base].push({ filename, suffix });
  });
  Object.values(groups).forEach(list => list.sort((a, b) => a.suffix - b.suffix));

  const cursors = {}; // base -> index du prochain fichier à distribuer
  return function nextPhotoFor(baseNameRaw) {
    const base = (baseNameRaw || "").trim().toLowerCase();
    const list = groups[base];
    if (!list) return null;
    const idx = cursors[base] || 0;
    if (idx >= list.length) return null;
    cursors[base] = idx + 1;
    return PHOTOS_DIR + list[idx].filename;
  };
}

// ============================================================
// CHARGEMENT
// ============================================================
let ALL_SPECIMENS = [];
let currentSort = { key: null, dir: 1 };

async function loadData() {
  const [csvRes, manifestRes] = await Promise.all([
    fetch(SHEET_CSV_URL),
    fetch(MANIFEST_URL).catch(() => null)
  ]);
  const csvText = await csvRes.text();
  const manifest = manifestRes && manifestRes.ok ? await manifestRes.json() : [];
  const rows = parseCSV(csvText);

  const header = rows[0].map(h => h.trim().toLowerCase());
  const idx = {
    nom: header.indexOf("nom"),
    origine: header.indexOf("origine"),
    taille: header.indexOf("taille"),
    qualite: header.indexOf("qualité") >= 0 ? header.indexOf("qualité") : header.indexOf("qualite"),
    auteur: header.indexOf("auteur"),
    photo1: header.indexOf("photos1"),
    photo2: header.indexOf("photos2"),
  };

  const nextPhoto = buildPhotoIndex(manifest);

  const specimens = rows.slice(1).map((r, i) => {
    const photo1Base = idx.photo1 >= 0 ? r[idx.photo1] : "";
    const photo2Base = idx.photo2 >= 0 ? r[idx.photo2] : "";
    return {
      id: i,
      nom: (r[idx.nom] || "").trim(),
      origine: (r[idx.origine] || "").trim(),
      taille: (r[idx.taille] || "").trim(),
      qualite: (r[idx.qualite] || "").trim(),
      auteur: (r[idx.auteur] || "").trim(),
      photo1: nextPhoto(photo1Base),
      photo2: nextPhoto(photo2Base),
    };
  }).filter(s => s.nom);

  return specimens;
}

// ============================================================
// RENDU
// ============================================================
function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function photoOrPlaceholder(src, label) {
  return src
    ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(label)}" loading="lazy">`
    : `<div class="no-photo">photo à venir</div>`;
}

function renderGrid(list) {
  const el = document.getElementById("grid-view");
  el.innerHTML = list.map(s => `
    <article class="card" tabindex="0" data-id="${s.id}">
      <span class="card-pin"></span>
      <div class="card-photos">
        ${photoOrPlaceholder(s.photo1, s.nom + " — face")}
        ${photoOrPlaceholder(s.photo2, s.nom + " — dos")}
      </div>
      <div class="card-body">
        <h3 class="card-name">${escapeHtml(s.nom)}</h3>
        <p class="card-meta">
          <span>${escapeHtml(s.origine || "—")}</span>
          ${s.taille ? `<span>${escapeHtml(s.taille)} mm</span>` : ""}
          ${s.qualite ? `<span class="tag-quality">${escapeHtml(s.qualite)}</span>` : ""}
        </p>
      </div>
    </article>
  `).join("");
}

function renderTable(list) {
  const el = document.getElementById("table-body");
  el.innerHTML = list.map(s => `
    <tr data-id="${s.id}">
      <td class="col-thumb">${s.photo1 ? `<img src="${escapeHtml(s.photo1)}" alt="" loading="lazy">` : ""}</td>
      <td class="col-name">${escapeHtml(s.nom)}</td>
      <td>${escapeHtml(s.origine || "—")}</td>
      <td class="col-num">${escapeHtml(s.taille || "—")}</td>
      <td>${escapeHtml(s.qualite || "—")}</td>
      <td>${escapeHtml(s.auteur || "—")}</td>
    </tr>
  `).join("");
}

function openModal(s) {
  document.getElementById("modal-photos").innerHTML =
    photoOrPlaceholder(s.photo1, s.nom + " — face") + photoOrPlaceholder(s.photo2, s.nom + " — dos");
  document.getElementById("modal-name").textContent = s.nom;
  document.getElementById("modal-origine").textContent = s.origine || "—";
  document.getElementById("modal-taille").textContent = s.taille ? s.taille + " mm" : "—";
  document.getElementById("modal-qualite").textContent = s.qualite || "—";
  document.getElementById("modal-auteur").textContent = s.auteur || "—";
  document.getElementById("modal").classList.add("open");
}
function closeModal() { document.getElementById("modal").classList.remove("open"); }

// ============================================================
// FILTRES / RECHERCHE / TRI
// ============================================================
function applyFilters() {
  const q = document.getElementById("search").value.trim().toLowerCase();
  const origin = document.getElementById("filter-origin").value;
  const quality = document.getElementById("filter-quality").value;

  let list = ALL_SPECIMENS.filter(s => {
    if (origin && s.origine !== origin) return false;
    if (quality && s.qualite !== quality) return false;
    if (q) {
      const hay = `${s.nom} ${s.origine} ${s.auteur}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (currentSort.key) {
    list = list.slice().sort((a, b) => {
      let av = a[currentSort.key], bv = b[currentSort.key];
      if (currentSort.key === "taille") {
        av = parseFloat((av || "0").replace(",", ".")) || 0;
        bv = parseFloat((bv || "0").replace(",", ".")) || 0;
        return (av - bv) * currentSort.dir;
      }
      return String(av || "").localeCompare(String(bv || "")) * currentSort.dir;
    });
  }

  document.getElementById("result-count").textContent =
    `${list.length} / ${ALL_SPECIMENS.length} spécimen${ALL_SPECIMENS.length > 1 ? "s" : ""}`;
  document.getElementById("empty-state").style.display = list.length ? "none" : "block";

  renderGrid(list);
  renderTable(list);
}

function populateFilterOptions() {
  const origins = [...new Set(ALL_SPECIMENS.map(s => s.origine).filter(Boolean))].sort();
  const qualities = [...new Set(ALL_SPECIMENS.map(s => s.qualite).filter(Boolean))].sort();
  const originSel = document.getElementById("filter-origin");
  const qualitySel = document.getElementById("filter-quality");
  origins.forEach(o => originSel.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`));
  qualities.forEach(q => qualitySel.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(q)}">${escapeHtml(q)}</option>`));
}

function updateStats() {
  document.getElementById("stat-total").textContent = ALL_SPECIMENS.length;
  document.getElementById("stat-species").textContent = new Set(ALL_SPECIMENS.map(s => s.nom.split(" f.")[0].split(" f ")[0])).size;
  document.getElementById("stat-origins").textContent = new Set(ALL_SPECIMENS.map(s => s.origine).filter(Boolean)).size;
}

// ============================================================
// VUES
// ============================================================
function setView(view) {
  const grid = document.getElementById("grid-view");
  const table = document.getElementById("table-view");
  const btnGrid = document.getElementById("btn-grid");
  const btnTable = document.getElementById("btn-table");
  if (view === "grid") {
    grid.classList.remove("hidden"); table.classList.add("hidden");
    btnGrid.classList.add("active"); btnTable.classList.remove("active");
    btnGrid.setAttribute("aria-pressed", "true"); btnTable.setAttribute("aria-pressed", "false");
  } else {
    table.classList.remove("hidden"); grid.classList.add("hidden");
    btnTable.classList.add("active"); btnGrid.classList.remove("active");
    btnTable.setAttribute("aria-pressed", "true"); btnGrid.setAttribute("aria-pressed", "false");
  }
  localStorage_safe_set("conus-view", view);
}
function localStorage_safe_set() { /* no-op: pas de stockage navigateur dans cet environnement */ }

// ============================================================
// INIT
// ============================================================
async function init() {
  try {
    ALL_SPECIMENS = await loadData();
  } catch (err) {
    document.getElementById("loading").innerHTML =
      `Impossible de charger le tableau. Vérifie que la Google Sheet est bien partagée en "lecture pour tous".<br><span style="opacity:.6">${escapeHtml(err.message)}</span>`;
    return;
  }
  document.getElementById("loading").classList.add("hidden");
  document.getElementById("grid-view").classList.remove("hidden");

  populateFilterOptions();
  updateStats();
  applyFilters();

  document.getElementById("last-updated").textContent =
    "Chargé le " + new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

  document.getElementById("search").addEventListener("input", applyFilters);
  document.getElementById("filter-origin").addEventListener("change", applyFilters);
  document.getElementById("filter-quality").addEventListener("change", applyFilters);

  document.getElementById("btn-grid").addEventListener("click", () => setView("grid"));
  document.getElementById("btn-table").addEventListener("click", () => setView("table"));

  document.querySelectorAll("thead th[data-sort]").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (!key) return;
      if (currentSort.key === key) currentSort.dir *= -1;
      else { currentSort.key = key; currentSort.dir = 1; }
      document.querySelectorAll("thead .arrow").forEach(a => a.textContent = "");
      th.querySelector(".arrow").textContent = currentSort.dir === 1 ? "▲" : "▼";
      applyFilters();
    });
  });

  document.body.addEventListener("click", e => {
    const card = e.target.closest(".card");
    const row = e.target.closest("tr[data-id]");
    const target = card || row;
    if (target) {
      const s = ALL_SPECIMENS.find(s => String(s.id) === target.dataset.id);
      if (s) openModal(s);
    }
  });
  document.body.addEventListener("keydown", e => {
    if (e.key === "Enter" && document.activeElement.classList.contains("card")) {
      document.activeElement.click();
    }
  });
  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("modal").addEventListener("click", e => {
    if (e.target.id === "modal") closeModal();
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
}

init();

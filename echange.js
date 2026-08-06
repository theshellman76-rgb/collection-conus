// ============================================================
// CONFIGURATION (même Google Sheet que la collection)
// ============================================================
const SHEET_ID = "1VOqCt19cDgk06bNNxXoUoeReC_I09Bgub6kkvyu8hcc";
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;
const PHOTOS_DIR = "photos/";
const PHOTO_EXTENSIONS = ["JPG", "jpg", "JPEG", "jpeg", "PNG", "png"];

// ============================================================
// CSV PARSING (identique au site principal)
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

function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function normalizeStatut(str) {
  return (str || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}
function isForTradeOrSale(statut) {
  const n = normalizeStatut(statut);
  return n.includes("echang") || n.includes("vendre") || n.includes("vente");
}

// Même calcul de nom de fichier photo que le site principal (voir script.js)
function buildPhotoIndex() {
  const cursors = {};
  return function nextPhotoFor(baseNameRaw) {
    const base = (baseNameRaw || "").trim();
    if (!base) return null;
    const key = base.toLowerCase();
    const occurrence = cursors[key] || 0;
    cursors[key] = occurrence + 1;
    const suffix = occurrence === 0 ? "" : ` ${occurrence}`;
    return `${base}${suffix}`;
  };
}

function photoOrPlaceholder(stem, label) {
  if (!stem) return `<div class="no-photo">photo à venir</div>`;
  const src = `${PHOTOS_DIR}${stem}.${PHOTO_EXTENSIONS[0]}`;
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(label)}" loading="lazy" data-stem="${escapeHtml(stem)}" data-try="0" onerror="handlePhotoError(this)">`;
}
function handlePhotoError(img) {
  const stem = img.dataset.stem;
  const tryIdx = parseInt(img.dataset.try || "0", 10) + 1;
  if (tryIdx < PHOTO_EXTENSIONS.length) {
    img.dataset.try = String(tryIdx);
    img.src = `${PHOTOS_DIR}${stem}.${PHOTO_EXTENSIONS[tryIdx]}`;
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "no-photo";
    placeholder.textContent = "photo à venir";
    img.replaceWith(placeholder);
  }
}
window.handlePhotoError = handlePhotoError;

// ============================================================
// CHARGEMENT — ne garde que Statut = "À échanger" ou "À vendre"
// ============================================================
let ITEMS = [];

async function loadData() {
  const res = await fetch(SHEET_CSV_URL);
  const csvText = await res.text();
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
    statut: header.indexOf("statut"),
    prixSouhaite: header.indexOf("prix souhaité") >= 0 ? header.indexOf("prix souhaité") : header.indexOf("prix souhaite"),
  };
  if (idx.statut < 0) return [];

  const nextPhoto = buildPhotoIndex();

  return rows.slice(1).map((r, i) => {
    const photo1Base = idx.photo1 >= 0 ? r[idx.photo1] : "";
    const photo2Base = idx.photo2 >= 0 ? r[idx.photo2] : "";
    const photo1 = nextPhoto(photo1Base);
    const photo2 = nextPhoto(photo2Base);
    const statut = (r[idx.statut] || "").trim();
    return {
      id: i,
      nom: (r[idx.nom] || "").trim(),
      origine: (r[idx.origine] || "").trim(),
      taille: (r[idx.taille] || "").trim(),
      qualite: (r[idx.qualite] || "").trim(),
      auteur: (r[idx.auteur] || "").trim(),
      photo1, photo2,
      statut,
      prixSouhaite: idx.prixSouhaite >= 0 ? parseFloat((r[idx.prixSouhaite] || "").replace(",", ".")) || null : null,
    };
  }).filter(s => s.nom && isForTradeOrSale(s.statut));
}

function renderGrid(list) {
  document.getElementById("echange-loading").classList.add("hidden");
  const grid = document.getElementById("echange-grid");
  const empty = document.getElementById("echange-empty");
  if (!list.length) {
    empty.classList.remove("hidden");
    grid.innerHTML = "";
    return;
  }
  empty.classList.add("hidden");
  grid.innerHTML = list.map(s => `
    <article class="card" tabindex="0" data-id="${s.id}">
      <span class="tag-statut card-statut-corner">${escapeHtml(s.statut)}</span>
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
          ${s.prixSouhaite ? `<span class="tag-quality">${escapeHtml(String(s.prixSouhaite))} €</span>` : ""}
        </p>
      </div>
    </article>
  `).join("");

  grid.querySelectorAll(".card").forEach(card => {
    card.addEventListener("click", () => {
      const s = list.find(x => String(x.id) === card.dataset.id);
      if (s) openModal(s);
    });
  });
}

function openModal(s) {
  document.getElementById("modal-photos").innerHTML =
    photoOrPlaceholder(s.photo1, s.nom + " — face") + photoOrPlaceholder(s.photo2, s.nom + " — dos");
  document.getElementById("modal-name").textContent = s.nom;
  document.getElementById("modal-origine").textContent = s.origine || "—";
  document.getElementById("modal-taille").textContent = s.taille ? s.taille + " mm" : "—";
  document.getElementById("modal-qualite").textContent = s.qualite || "—";
  document.getElementById("modal-auteur").textContent = s.auteur || "—";
  document.getElementById("modal-statut").textContent = s.statut;
  const prixWrap = document.getElementById("modal-prix-wrap");
  if (s.prixSouhaite) { prixWrap.classList.remove("hidden"); document.getElementById("modal-prix").textContent = s.prixSouhaite + " €"; }
  else prixWrap.classList.add("hidden");
  document.getElementById("modal").classList.add("open");
}
function closeModal() { document.getElementById("modal").classList.remove("open"); }

async function init() {
  ITEMS = await loadData().catch(() => []);
  renderGrid(ITEMS);
  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
}
init();

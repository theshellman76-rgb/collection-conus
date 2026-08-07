// ============================================================
// CONFIGURATION
// ============================================================
const SHEET_ID = "1VOqCt19cDgk06bNNxXoUoeReC_I09Bgub6kkvyu8hcc";
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;
const PHOTOS_DIR = "photos/";
const PHOTO_EXTENSIONS = ["JPG", "jpg", "JPEG", "jpeg", "PNG", "png"];
const MAX_PREVIEW = 9;
const FEATURED_SPECIES = [
  "gloriamaris", "bengalensis", "milneedwardsi", "sumbawaensis",
  "vicweei", "floccatus", "kolaceki", "scottjordani", "gauguini",
];
function normalizeName(str) {
  return (str || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

// ============================================================
// CSV PARSING (identique au reste du site)
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
    img.replaceWith(document.createTextNode(""));
  }
}
window.handlePhotoError = handlePhotoError;

// ============================================================
// APERÇU DES FAVORIS (lecture seule, aucune donnée sensible)
// ============================================================
async function loadFavoritesPreview() {
  const res = await fetch(SHEET_CSV_URL);
  const csvText = await res.text();
  const rows = parseCSV(csvText);
  const header = rows[0].map(h => h.trim().toLowerCase());
  const idx = {
    nom: header.indexOf("nom"),
    photo1: header.indexOf("photos1"),
  };

  const nextPhoto = buildPhotoIndex();
  const all = rows.slice(1).map(r => {
    const photo1 = nextPhoto(idx.photo1 >= 0 ? r[idx.photo1] : "");
    return { nom: (r[idx.nom] || "").trim(), photo1 };
  }).filter(s => s.nom);

  return FEATURED_SPECIES
    .map(target => all.find(s => normalizeName(s.nom).startsWith(normalizeName(target))))
    .filter(Boolean)
    .slice(0, MAX_PREVIEW);
}

function renderPreview(items) {
  document.getElementById("gate-preview-loading").remove();
  const grid = document.getElementById("gate-preview-grid");
  if (!items.length) {
    grid.innerHTML = `<p class="muted-note">Pas encore de favoris marqués.</p>`;
    return;
  }
  grid.innerHTML = items.map(s => `
    <div class="gate-preview-card">
      ${photoOrPlaceholder(s.photo1, s.nom)}
      <span class="gate-preview-name">${escapeHtml(s.nom)}</span>
    </div>
  `).join("");
}

// ============================================================
// FORMULAIRE DE CONNEXION
// ============================================================
function initGateForm() {
  const form = document.getElementById("gate-form");
  const input = document.getElementById("gate-passcode");
  const remember = document.getElementById("gate-remember");
  const error = document.getElementById("gate-error");

  form.addEventListener("submit", async e => {
    e.preventDefault();
    error.classList.add("hidden");
    const ok = await tryUnlock(input.value, remember.checked);
    if (ok) {
      location.href = "collection.html";
    } else {
      error.classList.remove("hidden");
      input.value = "";
      input.focus();
    }
  });
}

// ============================================================
// INIT
// ============================================================
initGateForm();
loadFavoritesPreview().then(renderPreview).catch(() => renderPreview([]));

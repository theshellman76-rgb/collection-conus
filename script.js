// ============================================================
// CONFIGURATION
// ============================================================
// Identifiant de la Google Sheet publique (lecture seule).
const SHEET_ID = "1VOqCt19cDgk06bNNxXoUoeReC_I09Bgub6kkvyu8hcc";
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;
const PHOTOS_DIR = "photos/";
const PHOTO_EXTENSIONS = ["JPG", "jpg", "JPEG", "jpeg", "PNG", "png"];

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
// NOM DE FICHIER ATTENDU (gère les doublons d'espèces)
// ============================================================
// Google Drive numérote les fichiers en double : "Nom.ext", "Nom 1.ext", "Nom 2.ext"...
// On calcule ce nom directement à partir de l'ordre d'apparition dans le tableau,
// sans dépendre d'une liste figée : un fichier renommé/ajouté est pris en compte
// dès le prochain chargement de la page.
function buildPhotoIndex() {
  const cursors = {}; // base (en minuscules) -> nombre de fois déjà vu
  return function nextPhotoFor(baseNameRaw) {
    const base = (baseNameRaw || "").trim();
    if (!base) return null;
    const key = base.toLowerCase();
    const occurrence = cursors[key] || 0;
    cursors[key] = occurrence + 1;
    const suffix = occurrence === 0 ? "" : ` ${occurrence}`;
    return `${base}${suffix}`; // sans dossier ni extension : géré à l'affichage
  };
}

// Extrait le pays depuis un champ "Origine" du type "Lieu, région - Pays"
function extractCountry(origine) {
  const raw = (origine || "").trim();
  if (!raw) return "";
  const parts = raw.split(" - ");
  return parts[parts.length - 1].trim();
}

// Réduit un champ "Auteur" à son seul nom, en retirant l'année
// ex. "Sowerby, 1784" et "Sowerby, 1785" -> "Sowerby"
function normalizeAuthor(auteur) {
  return (auteur || "")
    .replace(/[()]/g, "")
    .replace(/\b\d{4}[a-z]?\b/gi, "")
    .replace(/,\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Table de correspondance pays (normalisé, sans accents) -> continent
const COUNTRY_TO_CONTINENT = {
  "indonesie":"asie","inde":"asie","thailande":"asie","philippines":"asie","singapour":"asie",
  "vietnam":"asie","malaisie":"asie","japon":"asie","sri lanka":"asie","oman":"asie","yemen":"asie",
  "chine":"asie","taiwan":"asie","myanmar":"asie","birmanie":"asie","cambodge":"asie","emirats arabes unis":"asie",
  "arabie saoudite":"asie","qatar":"asie","koweit":"asie","bahrein":"asie","israel":"asie","pakistan":"asie",
  "bangladesh":"asie","coree du sud":"asie","hong kong":"asie",

  "madagascar":"afrique","senegal":"afrique","angola":"afrique","mayotte":"afrique","reunion":"afrique",
  "la reunion":"afrique","maurice":"afrique","ile maurice":"afrique","djibouti":"afrique",
  "afrique du sud":"afrique","kenya":"afrique","tanzanie":"afrique","zanzibar":"afrique","cap vert":"afrique",
  "comores":"afrique","egypte":"afrique","soudan":"afrique","mozambique":"afrique","somalie":"afrique",
  "erythree":"afrique","nigeria":"afrique","ghana":"afrique","gabon":"afrique","namibie":"afrique",
  "seychelles":"afrique","cote d'ivoire":"afrique","cote divoire":"afrique","maroc":"afrique","tunisie":"afrique",

  "nouvelle caledonie":"oceanie","nouvelle-caledonie":"oceanie","australie":"oceanie",
  "papouasie nouvelle guinee":"oceanie","papouasie-nouvelle-guinee":"oceanie","fidji":"oceanie",
  "vanuatu":"oceanie","polynesie francaise":"oceanie","polynesie":"oceanie","salomon":"oceanie",
  "iles salomon":"oceanie","tonga":"oceanie","samoa":"oceanie","micronesie":"oceanie","palau":"oceanie",
  "kiribati":"oceanie","wallis et futuna":"oceanie","niue":"oceanie","nouvelle zelande":"oceanie",

  "panama":"amerique","mexique":"amerique","etats unis":"amerique","etats-unis":"amerique","usa":"amerique",
  "floride":"amerique","bresil":"amerique","colombie":"amerique","equateur":"amerique","venezuela":"amerique",
  "costa rica":"amerique","perou":"amerique","antilles":"amerique","caraibes":"amerique","cuba":"amerique",
  "guadeloupe":"amerique","martinique":"amerique","canada":"amerique","chili":"amerique",

  "france":"europe","espagne":"europe","grece":"europe","italie":"europe","portugal":"europe",
  "croatie":"europe","malte":"europe","chypre":"europe","corse":"europe",
};

function countryToContinent(country) {
  const key = (country || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim();
  return COUNTRY_TO_CONTINENT[key] || null;
}


let ALL_SPECIMENS = [];
let currentSort = { key: null, dir: 1 };
let currentLetter = "";
let currentContinent = "";
let showFavoritesOnly = false;

function normalizeLetter(str) {
  return (str || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // retire les accents
    .trim().charAt(0).toUpperCase();
}

async function loadData() {
  const csvRes = await fetch(SHEET_CSV_URL);
  const csvText = await csvRes.text();
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
    favoris: header.indexOf("favoris"),
    prixAchat: header.indexOf("prix achat"),
    dateAcquisition: header.indexOf("date acquisition"),
    rarete: header.indexOf("rareté") >= 0 ? header.indexOf("rareté") : header.indexOf("rarete"),
    statut: header.indexOf("statut"),
    prixSouhaite: header.indexOf("prix souhaité") >= 0 ? header.indexOf("prix souhaité") : header.indexOf("prix souhaite"),
  };

  const nextPhoto = buildPhotoIndex();

  const specimens = rows.slice(1).map((r, i) => {
    const photo1Base = idx.photo1 >= 0 ? r[idx.photo1] : "";
    const photo2Base = idx.photo2 >= 0 ? r[idx.photo2] : "";
    return {
      id: i,
      nom: (r[idx.nom] || "").trim(),
      origine: (r[idx.origine] || "").trim(),
      pays: extractCountry(r[idx.origine]),
      taille: (r[idx.taille] || "").trim(),
      qualite: (r[idx.qualite] || "").trim(),
      auteur: (r[idx.auteur] || "").trim(),
      auteurCourt: normalizeAuthor(r[idx.auteur]),
      photo1: nextPhoto(photo1Base),
      photo2: nextPhoto(photo2Base),
      favori: idx.favoris >= 0 && (r[idx.favoris] || "").trim().toLowerCase() === "oui",
      prixAchat: idx.prixAchat >= 0 ? parseFloat((r[idx.prixAchat] || "").replace(",", ".")) || null : null,
      dateAcquisition: idx.dateAcquisition >= 0 ? (r[idx.dateAcquisition] || "").trim() : "",
      rarete: idx.rarete >= 0 ? (r[idx.rarete] || "").trim() : "",
      statut: idx.statut >= 0 ? ((r[idx.statut] || "").trim() || "Collection") : "Collection",
      prixSouhaite: idx.prixSouhaite >= 0 ? parseFloat((r[idx.prixSouhaite] || "").replace(",", ".")) || null : null,
    };
  }).filter(s => s.nom);

  return groupSameSpeciesBySize(specimens);
}

// Regroupe les lignes de même nom d'espèce ensemble (ordre de première apparition
// conservé) et les trie par taille décroissante à l'intérieur de chaque groupe.
function groupSameSpeciesBySize(specimens) {
  const order = [];
  const groups = {};
  specimens.forEach(s => {
    if (!groups[s.nom]) { groups[s.nom] = []; order.push(s.nom); }
    groups[s.nom].push(s);
  });
  const parseTaille = v => parseFloat((v || "0").replace(",", ".")) || 0;
  order.forEach(nom => groups[nom].sort((a, b) => parseTaille(b.taille) - parseTaille(a.taille)));
  return order.flatMap(nom => groups[nom]);
}

// ============================================================
// RENDU
// ============================================================
function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function photoOrPlaceholder(stem, label) {
  if (!stem) return `<div class="no-photo">photo à venir</div>`;
  const src = `${PHOTOS_DIR}${stem}.${PHOTO_EXTENSIONS[0]}`;
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(label)}" loading="lazy" data-stem="${escapeHtml(stem)}" data-try="0" onerror="handlePhotoError(this)">`;
}

// Si une extension échoue, on essaie la suivante ; si aucune ne fonctionne,
// l'image est remplacée par le même placeholder "photo à venir".
function handlePhotoError(img) {
  const stem = img.dataset.stem;
  const tryIdx = parseInt(img.dataset.try || "0", 10) + 1;
  if (tryIdx < PHOTO_EXTENSIONS.length) {
    img.dataset.try = String(tryIdx);
    img.src = `${PHOTOS_DIR}${stem}.${PHOTO_EXTENSIONS[tryIdx]}`;
  } else if (img.dataset.fallback === "hide") {
    img.remove(); // vignette de tableau : on n'affiche simplement rien
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "no-photo";
    placeholder.textContent = "photo à venir";
    img.replaceWith(placeholder);
  }
}
window.handlePhotoError = handlePhotoError;

function renderGrid(list) {
  const el = document.getElementById("grid-view");
  el.innerHTML = list.map(s => `
    <article class="card" tabindex="0" data-id="${s.id}">
      <span class="card-pin"></span>
      ${s.favori ? `<span class="card-fav"><svg viewBox="0 0 16 16"><path d="M8 1.5l1.9 4.3 4.6.4-3.5 3.1 1.1 4.6L8 11.6l-4.1 2.3 1.1-4.6-3.5-3.1 4.6-.4z"/></svg></span>` : ""}
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
          ${s.rarete ? `<span class="tag-rarete">${escapeHtml(s.rarete)}</span>` : ""}
          ${s.statut && s.statut !== "Collection" ? `<span class="tag-statut">${escapeHtml(s.statut)}</span>` : ""}
        </p>
      </div>
    </article>
  `).join("");
}

function renderTable(list) {
  const el = document.getElementById("table-body");
  el.innerHTML = list.map(s => `
    <tr data-id="${s.id}">
      <td class="col-thumb">${s.photo1 ? `<img src="${escapeHtml(PHOTOS_DIR + s.photo1 + '.' + PHOTO_EXTENSIONS[0])}" alt="" loading="lazy" data-stem="${escapeHtml(s.photo1)}" data-try="0" data-fallback="hide" onerror="handlePhotoError(this)">` : ""}</td>
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

  const rareteWrap = document.getElementById("modal-rarete-wrap");
  if (s.rarete) { rareteWrap.classList.remove("hidden"); document.getElementById("modal-rarete").textContent = s.rarete; }
  else rareteWrap.classList.add("hidden");

  const dateWrap = document.getElementById("modal-date-wrap");
  if (s.dateAcquisition) { dateWrap.classList.remove("hidden"); document.getElementById("modal-date").textContent = s.dateAcquisition; }
  else dateWrap.classList.add("hidden");

  const statutWrap = document.getElementById("modal-statut-wrap");
  if (s.statut && s.statut !== "Collection") {
    statutWrap.classList.remove("hidden");
    document.getElementById("modal-statut").textContent = s.statut + (s.prixSouhaite ? ` — ${s.prixSouhaite} €` : "");
  } else statutWrap.classList.add("hidden");

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
  const author = document.getElementById("filter-author").value;

  let list = ALL_SPECIMENS.filter(s => {
    if (origin && s.pays !== origin) return false;
    if (quality && s.qualite !== quality) return false;
    if (author && s.auteurCourt !== author) return false;
    if (currentLetter && normalizeLetter(s.nom) !== currentLetter) return false;
    if (currentContinent && countryToContinent(s.pays) !== currentContinent) return false;
    if (showFavoritesOnly && !s.favori) return false;
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

function populateAlphaBar() {
  const available = new Set(ALL_SPECIMENS.map(s => normalizeLetter(s.nom)));
  const bar = document.getElementById("alpha-bar");
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  bar.innerHTML = letters.map(l => {
    const has = available.has(l);
    return `<button class="alpha-btn" data-letter="${l}" ${has ? "" : "disabled"}>${l}</button>`;
  }).join("");
  bar.addEventListener("click", e => {
    const btn = e.target.closest(".alpha-btn");
    if (!btn || btn.disabled) return;
    const letter = btn.dataset.letter;
    currentLetter = currentLetter === letter ? "" : letter;
    bar.querySelectorAll(".alpha-btn").forEach(b => b.classList.toggle("active", b.dataset.letter === currentLetter));
    applyFilters();
  });
}

function populateFilterOptions() {
  const origins = [...new Set(ALL_SPECIMENS.map(s => s.pays).filter(Boolean))].sort();
  const qualities = [...new Set(ALL_SPECIMENS.map(s => s.qualite).filter(Boolean))].sort();
  const authors = [...new Set(ALL_SPECIMENS.map(s => s.auteurCourt).filter(Boolean))].sort();
  const originSel = document.getElementById("filter-origin");
  const qualitySel = document.getElementById("filter-quality");
  const authorSel = document.getElementById("filter-author");
  origins.forEach(o => originSel.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`));
  qualities.forEach(q => qualitySel.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(q)}">${escapeHtml(q)}</option>`));
  authors.forEach(a => authorSel.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`));
}

function updateWorldMap() {
  const counts = { amerique: 0, europe: 0, afrique: 0, asie: 0, oceanie: 0 };
  ALL_SPECIMENS.forEach(s => {
    const continent = countryToContinent(s.pays);
    if (continent && counts.hasOwnProperty(continent)) counts[continent]++;
  });
  Object.keys(counts).forEach(c => {
    const el = document.getElementById("count-" + c);
    if (el) el.textContent = counts[c];
  });
}

function wireWorldMapClicks() {
  document.querySelectorAll(".continent-badge").forEach(badge => {
    badge.style.cursor = "pointer";
    badge.addEventListener("click", () => {
      const continent = badge.dataset.continent;
      currentContinent = currentContinent === continent ? "" : continent;
      document.querySelectorAll(".continent-badge").forEach(b =>
        b.classList.toggle("active", b.dataset.continent === currentContinent)
      );
      applyFilters();
    });
  });
}

function updateStats() {
  document.getElementById("stat-total").textContent = ALL_SPECIMENS.length;
  document.getElementById("stat-species").textContent = new Set(ALL_SPECIMENS.map(s => s.nom.split(" f.")[0].split(" f ")[0])).size;
  document.getElementById("stat-origins").textContent = new Set(ALL_SPECIMENS.map(s => s.origine).filter(Boolean)).size;
  const total = ALL_SPECIMENS.reduce((sum, s) => sum + (s.prixAchat || 0), 0);
  const statValueEl = document.getElementById("stat-value");
  if (statValueEl) {
    statValueEl.textContent = total > 0 ? total.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " €" : "—";
  }
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
  populateAlphaBar();
  updateStats();
  updateWorldMap();
  wireWorldMapClicks();
  applyFilters();

  document.getElementById("last-updated").textContent =
    "Chargé le " + new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

  document.getElementById("search").addEventListener("input", applyFilters);
  document.getElementById("filter-origin").addEventListener("change", applyFilters);
  document.getElementById("filter-quality").addEventListener("change", applyFilters);
  document.getElementById("filter-author").addEventListener("change", applyFilters);

  document.getElementById("btn-grid").addEventListener("click", () => setView("grid"));
  document.getElementById("btn-table").addEventListener("click", () => setView("table"));

  document.getElementById("btn-favorites").addEventListener("click", () => {
    showFavoritesOnly = !showFavoritesOnly;
    const btn = document.getElementById("btn-favorites");
    btn.classList.toggle("active", showFavoritesOnly);
    btn.setAttribute("aria-pressed", String(showFavoritesOnly));
    applyFilters();
  });

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

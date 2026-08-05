// ============================================================
// CONFIGURATION
// ============================================================
const WISHLIST_SHEET_ID = "1BpqkgqTauBjtFxRBPprYVuNvamS9WVMAtymQh8iQSQA";
const WISHLIST_CSV_URL = `https://docs.google.com/spreadsheets/d/${WISHLIST_SHEET_ID}/gviz/tq?tqx=out:csv`;
const ALERTS_JSON_URL = "data/alerts.json";
const HISTORY_JSON_URL = "data/price-history.json";

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

// ============================================================
// HISTORIQUE DES PRIX
// ============================================================
function normalize(str) {
  return (str || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

async function loadHistory() {
  try {
    const res = await fetch(HISTORY_JSON_URL, { cache: "no-store" });
    if (!res.ok) return {};
    return await res.json();
  } catch (e) {
    return {};
  }
}

function historyHtmlFor(history, speciesName) {
  const entries = history[normalize(speciesName)];
  if (!entries || !entries.length) return "";
  const last = entries.slice(-5).reverse();
  const items = last.map(e => {
    const d = new Date(e.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
    return `<span class="history-point">${d} : ${escapeHtml(String(e.price))} ${escapeHtml(e.currency || "")}</span>`;
  }).join("");
  return `<div class="wish-history"><p class="wish-history-label">Derniers prix vus</p>${items}</div>`;
}

// ============================================================
// WISHLIST
// ============================================================
async function loadWishlist() {
  const res = await fetch(WISHLIST_CSV_URL);
  const csvText = await res.text();
  const rows = parseCSV(csvText);
  const header = rows[0].map(h => h.trim().toLowerCase());
  const idx = {
    nom: header.indexOf("conus") >= 0 ? header.indexOf("conus") : header.indexOf("nom"),
    prix: header.indexOf("prix"),
    notes: header.indexOf("notes"),
    tailleMin: header.indexOf("taille min"),
    qualiteMin: header.indexOf("qualité min") >= 0 ? header.indexOf("qualité min") : header.indexOf("qualite min"),
  };
  return rows.slice(1).map(r => ({
    nom: (r[idx.nom] || "").trim(),
    prix: idx.prix >= 0 ? (r[idx.prix] || "").trim() : "",
    notes: idx.notes >= 0 ? (r[idx.notes] || "").trim() : "",
    tailleMin: idx.tailleMin >= 0 ? (r[idx.tailleMin] || "").trim() : "",
    qualiteMin: idx.qualiteMin >= 0 ? (r[idx.qualiteMin] || "").trim() : "",
  })).filter(w => w.nom);
}

function renderWishlist(items, history) {
  const grid = document.getElementById("wishlist-grid");
  document.getElementById("wishlist-loading").classList.add("hidden");
  if (!items.length) {
    grid.innerHTML = `<p class="muted-note">La wishlist est vide pour le moment.</p>`;
    return;
  }
  grid.innerHTML = items.map(w => `
    <article class="wish-card">
      <h3 class="wish-name">Conus ${escapeHtml(w.nom)}</h3>
      ${w.prix ? `<p class="wish-limit">Prix limite : ${escapeHtml(w.prix)} €</p>` : ""}
      ${(w.tailleMin || w.qualiteMin) ? `<p class="wish-criteria">${w.tailleMin ? `≥ ${escapeHtml(w.tailleMin)} mm` : ""}${w.tailleMin && w.qualiteMin ? " · " : ""}${w.qualiteMin ? `qualité ≥ ${escapeHtml(w.qualiteMin)}` : ""}</p>` : ""}
      ${w.notes ? `<p class="wish-notes">${escapeHtml(w.notes)}</p>` : ""}
      ${historyHtmlFor(history, w.nom)}
    </article>
  `).join("");
}

// ============================================================
// ALERTES
// ============================================================
async function loadAlerts() {
  try {
    const res = await fetch(ALERTS_JSON_URL, { cache: "no-store" });
    if (!res.ok) return { checkedAt: null, matches: [] };
    return await res.json();
  } catch (e) {
    return { checkedAt: null, matches: [] };
  }
}

// ============================================================
// ANNONCES MASQUÉES (mémorisées dans ce navigateur)
// ============================================================
const DISMISSED_KEY = "conus-dismissed-alerts";

function getDismissedIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]"));
  } catch (e) {
    return new Set();
  }
}

function dismissAlert(id) {
  const set = getDismissedIds();
  set.add(id);
  localStorage.setItem(DISMISSED_KEY, JSON.stringify([...set]));
}

function renderAlerts(data) {
  document.getElementById("alerts-loading").classList.add("hidden");
  const list = document.getElementById("alerts-list");
  const empty = document.getElementById("alerts-empty");
  const dismissed = getDismissedIds();
  const matches = (data.matches || []).filter(m => !dismissed.has(m.id));

  if (!matches.length) {
    empty.classList.remove("hidden");
    list.innerHTML = "";
  } else {
    empty.classList.add("hidden");
    list.innerHTML = matches.map(m => `
      <div class="alert-card" data-id="${escapeHtml(m.id)}">
        <div class="alert-main">
          <span class="alert-species">Conus ${escapeHtml(m.species)}</span>
          <span class="alert-meta">
            <span class="alert-source">${escapeHtml(m.source)}</span>
            <span>${escapeHtml(m.title || "")}</span>
          </span>
        </div>
        <span class="alert-price">${escapeHtml(String(m.price))} ${escapeHtml(m.currency || "€")}</span>
        <a class="alert-link" href="${escapeHtml(m.url)}" target="_blank" rel="noopener">Voir l'annonce ↗</a>
        <button class="alert-dismiss" data-dismiss-id="${escapeHtml(m.id)}" aria-label="Supprimer cette annonce" title="Supprimer">✕</button>
      </div>
    `).join("");

    list.querySelectorAll("[data-dismiss-id]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.dismissId;
        dismissAlert(id);
        const card = list.querySelector(`.alert-card[data-id="${CSS.escape(id)}"]`);
        if (card) card.remove();
        if (!list.children.length) empty.classList.remove("hidden");
      });
    });
  }

  if (data.checkedAt) {
    const d = new Date(data.checkedAt);
    document.getElementById("last-check").textContent =
      "Dernière vérification : " + d.toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });
  }
}

// ============================================================
// INIT
// ============================================================
async function init() {
  const [wishlist, alerts, history] = await Promise.all([
    loadWishlist().catch(() => []),
    loadAlerts(),
    loadHistory(),
  ]);
  renderWishlist(wishlist, history);
  renderAlerts(alerts);
}

init();

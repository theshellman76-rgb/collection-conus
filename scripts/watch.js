// ============================================================
// Script de veille : Wishlist -> eBay + shellauction.net -> alertes
// Exécuté automatiquement par GitHub Actions (voir .github/workflows/watch.yml)
// ============================================================
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

const WISHLIST_SHEET_ID = "1BpqkgqTauBjtFxRBPprYVuNvamS9WVMAtymQh8iQSQA";
const WISHLIST_CSV_URL = `https://docs.google.com/spreadsheets/d/${WISHLIST_SHEET_ID}/gviz/tq?tqx=out:csv`;
const EBAY_MARKETPLACES = ["EBAY_US", "EBAY_FR", "EBAY_DE", "EBAY_GB"];
const DATA_DIR = path.join(__dirname, "..", "data");
const ALERTS_PATH = path.join(DATA_DIR, "alerts.json");
const SEEN_PATH = path.join(DATA_DIR, "seen.json");
const HISTORY_PATH = path.join(DATA_DIR, "price-history.json");
const MAX_HISTORY_PER_SPECIES = 200;
const MAX_SEEN = 500;
const MAX_ALERTS_DISPLAYED = 60;

const ALERT_TO = process.env.ALERT_TO_EMAIL || "theshellman76@gmail.com";

// ------------------------------------------------------------
// Utilitaires
// ------------------------------------------------------------
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

function readJsonSafe(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    return fallback;
  }
}

function normalize(str) {
  return (str || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim();
}

// ------------------------------------------------------------
// Wishlist
// ------------------------------------------------------------
async function loadWishlist() {
  const res = await fetch(WISHLIST_CSV_URL);
  if (!res.ok) throw new Error("Impossible de lire la Google Sheet Wishlist (" + res.status + ")");
  const csvText = await res.text();
  const rows = parseCSV(csvText);
  const header = rows[0].map(h => h.trim().toLowerCase());
  const idxNom = header.indexOf("conus") >= 0 ? header.indexOf("conus") : header.indexOf("nom");
  const idxPrix = header.indexOf("prix");
  const idxTailleMin = header.indexOf("taille min");
  const idxQualiteMin = header.indexOf("qualité min") >= 0 ? header.indexOf("qualité min") : header.indexOf("qualite min");
  return rows.slice(1).map(r => ({
    nom: (r[idxNom] || "").trim(),
    prixLimite: parseFloat((r[idxPrix] || "").replace(",", ".")) || null,
    tailleMin: idxTailleMin >= 0 ? (parseFloat((r[idxTailleMin] || "").replace(",", ".")) || null) : null,
    qualiteMin: idxQualiteMin >= 0 ? (r[idxQualiteMin] || "").trim() : "",
  })).filter(w => w.nom);
}

// Échelle de qualité utilisée par les collectionneurs de coquillages, du moins bon au meilleur.
const QUALITY_SCALE = ["F", "F+", "F++", "F+++", "GEM"];
function qualityRank(q) {
  const idx = QUALITY_SCALE.indexOf((q || "").trim().toUpperCase());
  return idx === -1 ? null : idx;
}

// Best effort : essaie d'extraire une taille (mm) et une qualité depuis le titre libre
// d'une annonce eBay/shellauction. Les vendeurs n'utilisent aucun format standard,
// donc ceci peut échouer à repérer l'info même quand elle est présente dans le titre.
function extractSizeFromTitle(title) {
  const m = (title || "").match(/(\d{1,3}(?:[.,]\d{1,2})?)\s*mm/i);
  return m ? parseFloat(m[1].replace(",", ".")) : null;
}
function extractQualityFromTitle(title) {
  const m = (title || "").match(/\bF\+{0,3}(?![+\w])|\bGEM\b/i);
  return m ? m[0].toUpperCase() : null;
}

// ------------------------------------------------------------
// eBay Browse API
// ------------------------------------------------------------
async function getEbayToken() {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("EBAY_CLIENT_ID / EBAY_CLIENT_SECRET manquants");

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${basic}`,
    },
    body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Échec authentification eBay (${res.status}): ${body}`);
  }
  const data = await res.json();
  return data.access_token;
}

async function searchEbay(token, speciesName) {
  const results = [];
  for (const marketplace of EBAY_MARKETPLACES) {
    try {
      const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
      url.searchParams.set("q", `Conus ${speciesName}`);
      url.searchParams.set("limit", "20");
      const res = await fetch(url, {
        headers: {
          "Authorization": `Bearer ${token}`,
          "X-EBAY-C-MARKETPLACE-ID": marketplace,
        },
      });
      if (!res.ok) continue;
      const data = await res.json();
      (data.itemSummaries || []).forEach(item => {
        const title = item.title || "";
        // Filtre de sécurité : le titre doit vraiment mentionner l'espèce recherchée
        if (!normalize(title).includes(normalize(speciesName))) return;
        results.push({
          source: "eBay",
          id: `ebay-${item.itemId}`,
          title,
          price: item.price ? parseFloat(item.price.value) : null,
          currency: item.price ? item.price.currency : "",
          url: item.itemWebUrl,
        });
      });
    } catch (e) {
      console.error(`Erreur eBay (${marketplace}, ${speciesName}):`, e.message);
    }
  }
  return results;
}

// ------------------------------------------------------------
// shellauction.net (pas d'API publique -> lecture de la page de résultats)
// ------------------------------------------------------------
async function searchShellauction(speciesName) {
  const url = `https://www.shellauction.net/auction_search.php?famiglia=Conidae&in_search=${encodeURIComponent(speciesName)}&set_page=1&shop=A`;
  let html;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; ConusWishlistWatch/1.0)" } });
    if (!res.ok) return [];
    html = await res.text();
  } catch (e) {
    console.error(`Erreur shellauction (${speciesName}):`, e.message);
    return [];
  }

  // Analyse par expression régulière : chaque item est un lien vers auction_shell.php?id=NNN
  // suivi du nom de l'espèce, puis plus loin d'un prix au format "12,34 €" (ou "$ 12.34").
  const results = [];
  const itemRe = /auction_shell\.php\?id=(\d+)[^"]*"[^>]*>([^<]+)<\/a>([\s\S]{0,300}?)(\d[\d.,]*)\s*(€|\$)/g;
  let m;
  while ((m = itemRe.exec(html)) !== null) {
    const [, id, title, , priceRaw, currencySymbol] = m;
    if (!normalize(title).includes(normalize(speciesName))) continue;
    const price = parseFloat(priceRaw.replace(/\./g, "").replace(",", "."));
    results.push({
      source: "shellauction.net",
      id: `shellauction-${id}`,
      title: title.trim(),
      price: isNaN(price) ? null : price,
      currency: currencySymbol === "€" ? "EUR" : "USD",
      url: `https://www.shellauction.net/auction_shell.php?id=${id}&pres=1`,
    });
  }
  return results;
}

// ------------------------------------------------------------
// Email
// ------------------------------------------------------------
async function sendAlertEmail(newMatches) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    console.warn("GMAIL_USER / GMAIL_APP_PASSWORD manquants : email non envoyé.");
    return;
  }
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });

  const lines = newMatches.map(m =>
    `- Conus ${m.species} — ${m.price ?? "?"} ${m.currency || ""} sur ${m.source}\n  ${m.title}\n  ${m.url}`
  ).join("\n\n");

  await transporter.sendMail({
    from: user,
    to: ALERT_TO,
    subject: `🐚 ${newMatches.length} nouvelle(s) trouvaille(s) sur ta Wishlist Conus`,
    text: `De nouvelles annonces correspondant à ta wishlist ont été trouvées :\n\n${lines}\n\nVoir toutes les alertes : (ton site) / wishlist.html`,
  });
  console.log(`Email envoyé à ${ALERT_TO} (${newMatches.length} nouvelle(s) correspondance(s)).`);
}

// ------------------------------------------------------------
// Programme principal
// ------------------------------------------------------------
async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const wishlist = await loadWishlist();
  console.log(`Wishlist chargée : ${wishlist.length} espèce(s).`);

  let ebayToken = null;
  try {
    ebayToken = await getEbayToken();
  } catch (e) {
    console.error("Impossible d'obtenir un token eBay :", e.message);
  }

  const allMatches = [];
  for (const item of wishlist) {
    let found = [];
    if (ebayToken) found = found.concat(await searchEbay(ebayToken, item.nom));
    found = found.concat(await searchShellauction(item.nom));

    // Ne garder que les annonces sous le prix limite (si un prix a pu être lu et une limite existe)
    found = found.filter(f => {
      if (item.prixLimite == null) return true;
      if (f.price == null) return true; // on préfère alerter par excès que rater une annonce
      return f.price <= item.prixLimite;
    });

    // Taille et qualité : extraction "best effort" depuis le titre (pas de champ structuré
    // chez ces vendeurs). En l'absence d'info repérable dans le titre, on laisse passer
    // l'annonce plutôt que de risquer de rater une bonne trouvaille.
    found = found.map(f => ({
      ...f,
      tailleVue: extractSizeFromTitle(f.title),
      qualiteVue: extractQualityFromTitle(f.title),
    }));
    found = found.filter(f => {
      if (item.tailleMin != null && f.tailleVue != null && f.tailleVue < item.tailleMin) return false;
      if (item.qualiteMin && f.qualiteVue) {
        const seuil = qualityRank(item.qualiteMin);
        const vue = qualityRank(f.qualiteVue);
        if (seuil != null && vue != null && vue < seuil) return false;
      }
      return true;
    });

    found.forEach(f => allMatches.push({ ...f, species: item.nom, limit: item.prixLimite }));
  }

  // Dédoublonnage : id exact, puis même (source + espèce + titre) pour éviter
  // qu'une même annonce trouvée via plusieurs marketplaces eBay n'apparaisse en double.
  const byId = new Map();
  allMatches.forEach(m => { if (!byId.has(m.id)) byId.set(m.id, m); });
  const byComposite = new Map();
  [...byId.values()].forEach(m => {
    const key = `${m.source}|${normalize(m.species)}|${normalize(m.title)}`;
    const existing = byComposite.get(key);
    if (!existing || (m.price != null && (existing.price == null || m.price < existing.price))) {
      byComposite.set(key, m);
    }
  });
  const dedupedMatches = [...byComposite.values()];

  // Anti-doublons : ne pas ré-alerter par email sur une annonce déjà vue
  const seen = readJsonSafe(SEEN_PATH, { seenIds: [] });
  const seenSet = new Set(seen.seenIds || []);
  const newMatches = dedupedMatches.filter(m => !seenSet.has(m.id));

  if (newMatches.length) {
    try {
      await sendAlertEmail(newMatches);
    } catch (e) {
      console.error("Échec de l'envoi de l'email :", e.message);
    }
  } else {
    console.log("Aucune nouvelle correspondance depuis la dernière vérification.");
  }

  // Mise à jour de la liste des IDs déjà vus (bornée en taille)
  const updatedSeenIds = [...new Set([...seenSet, ...dedupedMatches.map(m => m.id)])].slice(-MAX_SEEN);
  fs.writeFileSync(SEEN_PATH, JSON.stringify({ seenIds: updatedSeenIds }, null, 2));

  // Fichier consommé par le site (toutes les correspondances actives, les plus récentes en tête)
  const displayed = dedupedMatches.slice(0, MAX_ALERTS_DISPLAYED);
  fs.writeFileSync(ALERTS_PATH, JSON.stringify({
    checkedAt: new Date().toISOString(),
    matches: displayed,
  }, null, 2));

  // Historique des prix vus par espèce (pour le graphique sur la page Wishlist)
  const history = readJsonSafe(HISTORY_PATH, {});
  const checkedAt = new Date().toISOString();
  dedupedMatches.forEach(m => {
    if (m.price == null) return;
    const key = normalize(m.species);
    if (!history[key]) history[key] = [];
    history[key].push({ date: checkedAt, price: m.price, currency: m.currency, source: m.source });
    if (history[key].length > MAX_HISTORY_PER_SPECIES) {
      history[key] = history[key].slice(-MAX_HISTORY_PER_SPECIES);
    }
  });
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));

  console.log(`Terminé. ${dedupedMatches.length} correspondance(s) active(s), ${newMatches.length} nouvelle(s).`);
}

main().catch(err => {
  console.error("Erreur fatale :", err);
  process.exit(1);
});

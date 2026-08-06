// ============================================================
// Verrou léger côté client — PAS une sécurité réelle.
// Le code source de ce fichier est public ; n'importe qui déterminé
// peut le lire et contourner ce verrou. Il sert uniquement à
// décourager un visiteur non invité de naviguer sur le site.
// ============================================================
const AUTH_STORAGE_KEY = "conus-unlocked";
const AUTH_PASSCODE_OVERRIDE_KEY = "conus-passcode-hash-override";

// Hash SHA-256 du passcode par défaut (évite juste qu'il soit lisible en clair
// dans le code source — ça n'empêche pas quelqu'un de motivé de le casser).
const DEFAULT_PASSCODE_HASH = "3e5d1965fe90ca1a075bde3dc697ed735366271d2ebba9fa635f0b9d2a98ad6a";

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hashBuffer)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function getActivePasscodeHash() {
  return localStorage.getItem(AUTH_PASSCODE_OVERRIDE_KEY) || DEFAULT_PASSCODE_HASH;
}

function isUnlocked() {
  return sessionStorage.getItem(AUTH_STORAGE_KEY) === "1" || localStorage.getItem(AUTH_STORAGE_KEY) === "1";
}

async function tryUnlock(passcode, remember) {
  const hash = await sha256Hex((passcode || "").trim());
  if (hash === getActivePasscodeHash()) {
    sessionStorage.setItem(AUTH_STORAGE_KEY, "1");
    if (remember) localStorage.setItem(AUTH_STORAGE_KEY, "1");
    return true;
  }
  return false;
}

function lockOut() {
  sessionStorage.removeItem(AUTH_STORAGE_KEY);
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

// À appeler en haut des pages protégées : redirige vers l'accueil si verrouillé.
function requireAuth() {
  if (!isUnlocked()) {
    location.replace("index.html");
  }
}

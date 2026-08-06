// ============================================================
// Lien de partage
// ============================================================
(function () {
  const input = document.getElementById("share-link-input");
  if (!input) return;
  const shareUrl = location.origin + location.pathname.replace(/profil\.html$/, "partage.html");
  input.value = shareUrl;

  const copyBtn = document.getElementById("share-link-copy");
  const copiedNote = document.getElementById("share-link-copied");
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(input.value);
    } catch (e) {
      input.select();
      document.execCommand("copy");
    }
    copiedNote.hidden = false;
    setTimeout(() => { copiedNote.hidden = true; }, 2500);
  });
})();

// ============================================================
// Changement de mot de passe (mémorisé uniquement sur cet appareil)
// ============================================================
(function () {
  const form = document.getElementById("password-form");
  if (!form) return;
  const input = document.getElementById("new-passcode");
  const error = document.getElementById("password-error");
  const success = document.getElementById("password-success");

  form.addEventListener("submit", async e => {
    e.preventDefault();
    error.classList.add("hidden");
    success.classList.add("hidden");
    const value = input.value.trim();
    if (value.length < 4) {
      error.textContent = "Le mot de passe doit faire au moins 4 caractères.";
      error.classList.remove("hidden");
      return;
    }
    const hash = await sha256Hex(value);
    localStorage.setItem(AUTH_PASSCODE_OVERRIDE_KEY, hash);
    input.value = "";
    success.classList.remove("hidden");
  });
})();

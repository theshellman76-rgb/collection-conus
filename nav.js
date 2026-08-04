// ============================================================
// Menu hamburger partagé entre toutes les pages du site
// ============================================================
(function () {
  function init() {
    const btn = document.getElementById("hamburger-btn");
    const menu = document.getElementById("hamburger-menu");
    if (!btn || !menu) return;

    // Marque le lien de la page courante comme actif
    const current = (location.pathname.split("/").pop() || "index.html").replace(".html", "") || "index";
    menu.querySelectorAll("a[data-page]").forEach(a => {
      if (a.dataset.page === current) a.classList.add("active");
    });

    function open() {
      menu.classList.add("open");
      btn.setAttribute("aria-expanded", "true");
    }
    function close() {
      menu.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
    }

    btn.addEventListener("click", e => {
      e.stopPropagation();
      menu.classList.contains("open") ? close() : open();
    });
    document.addEventListener("click", e => {
      if (!menu.contains(e.target) && e.target !== btn) close();
    });
    document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

// ============================================================
// CONFIGURATION — mêmes réglages que le traitement fait manuellement
// ============================================================
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;

let QUEUE = []; // { id, file, name (sans extension), status, blob }
let nextId = 1;

// ============================================================
// LECTURE DE L'ORIENTATION EXIF (les photos de téléphone/appareil
// photo indiquent souvent une rotation à appliquer ; sans ça, le
// canvas dessine l'image "à plat", parfois de travers)
// ============================================================
function readExifOrientation(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const view = new DataView(e.target.result);
        if (view.getUint16(0, false) !== 0xFFD8) return resolve(1);
        let offset = 2;
        while (offset < view.byteLength) {
          const marker = view.getUint16(offset, false);
          offset += 2;
          if (marker === 0xFFE1) {
            if (view.getUint32(offset + 2, false) !== 0x45786966) return resolve(1);
            const tiffOffset = offset + 8;
            const little = view.getUint16(tiffOffset, false) === 0x4949;
            const firstIFD = tiffOffset + view.getUint32(tiffOffset + 4, little);
            const tags = view.getUint16(firstIFD, little);
            for (let i = 0; i < tags; i++) {
              const entry = firstIFD + 2 + i * 12;
              if (view.getUint16(entry, little) === 0x0112) {
                return resolve(view.getUint16(entry + 8, little));
              }
            }
            return resolve(1);
          } else if ((marker & 0xFF00) !== 0xFF00) {
            break;
          } else {
            offset += view.getUint16(offset, false);
          }
        }
      } catch (e) { /* pas grave, on part du principe qu'il n'y a pas de rotation */ }
      resolve(1);
    };
    reader.onerror = () => resolve(1);
    reader.readAsArrayBuffer(file.slice(0, 128 * 1024));
  });
}

function applyOrientation(ctx, orientation, w, h) {
  switch (orientation) {
    case 2: ctx.transform(-1, 0, 0, 1, w, 0); break;
    case 3: ctx.transform(-1, 0, 0, -1, w, h); break;
    case 4: ctx.transform(1, 0, 0, -1, 0, h); break;
    case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
    case 6: ctx.transform(0, 1, -1, 0, h, 0); break;
    case 7: ctx.transform(0, -1, -1, 0, h, w); break;
    case 8: ctx.transform(0, -1, 1, 0, 0, w); break;
    default: break;
  }
}

// ============================================================
// TRAITEMENT D'UNE PHOTO : orientation + redimensionnement + compression
// ============================================================
async function processPhoto(file) {
  const orientation = await readExifOrientation(file);
  const bitmap = await createImageBitmap(file).catch(() => null);
  const img = bitmap || await loadImageFallback(file);

  const srcW = bitmap ? bitmap.width : img.naturalWidth;
  const srcH = bitmap ? bitmap.height : img.naturalHeight;
  const swapDims = orientation >= 5 && orientation <= 8;

  const scale = Math.min(1, MAX_DIMENSION / Math.max(srcW, srcH));
  const drawW = Math.round(srcW * scale);
  const drawH = Math.round(srcH * scale);

  const canvas = document.createElement("canvas");
  canvas.width = swapDims ? drawH : drawW;
  canvas.height = swapDims ? drawW : drawH;
  const ctx = canvas.getContext("2d");
  applyOrientation(ctx, orientation, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, drawW, drawH);

  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  const previewUrl = canvas.toDataURL("image/jpeg", 0.5);
  return { blob, previewUrl, width: canvas.width, height: canvas.height };
}

function loadImageFallback(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// ============================================================
// FILE D'ATTENTE / INTERFACE
// ============================================================
function baseNameOf(filename) {
  return filename.replace(/\.[^.]+$/, "");
}

function addFiles(fileList) {
  const files = [...fileList].filter(f => f.type.startsWith("image/"));
  files.forEach(file => {
    QUEUE.push({
      id: nextId++,
      file,
      name: baseNameOf(file.name),
      status: "attente", // attente -> traitement -> pret -> erreur
      blob: null,
      previewUrl: null,
    });
  });
  document.getElementById("queue-section").classList.remove("hidden");
  renderQueue();
}

function renderQueue() {
  document.getElementById("queue-count").textContent = QUEUE.length;
  const grid = document.getElementById("photo-grid");
  grid.innerHTML = QUEUE.map(item => `
    <div class="photo-item" data-id="${item.id}">
      <div class="photo-item-thumb">
        ${item.previewUrl ? `<img src="${item.previewUrl}" alt="">` : `<div class="photo-item-placeholder">${item.status === "erreur" ? "Erreur" : "…"}</div>`}
      </div>
      <input type="text" class="photo-item-name" value="${item.name.replace(/"/g, "&quot;")}" data-id="${item.id}" spellcheck="false">
      <span class="photo-item-status status-${item.status}">${statusLabel(item.status)}</span>
      <button class="photo-item-remove" data-remove="${item.id}" aria-label="Retirer" title="Retirer">✕</button>
    </div>
  `).join("");

  grid.querySelectorAll(".photo-item-name").forEach(input => {
    input.addEventListener("input", () => {
      const item = QUEUE.find(q => q.id === Number(input.dataset.id));
      if (item) item.name = input.value;
    });
  });
  grid.querySelectorAll("[data-remove]").forEach(btn => {
    btn.addEventListener("click", () => {
      QUEUE = QUEUE.filter(q => q.id !== Number(btn.dataset.remove));
      renderQueue();
      if (!QUEUE.length) document.getElementById("queue-section").classList.add("hidden");
    });
  });
}

function statusLabel(status) {
  return {
    attente: "En attente",
    traitement: "Traitement…",
    pret: "Prêt",
    erreur: "Erreur",
  }[status] || status;
}

async function processAll() {
  const btn = document.getElementById("process-btn");
  btn.disabled = true;
  const statusEl = document.getElementById("queue-status");

  for (let i = 0; i < QUEUE.length; i++) {
    const item = QUEUE[i];
    item.status = "traitement";
    renderQueue();
    statusEl.textContent = `Traitement ${i + 1} / ${QUEUE.length}…`;
    try {
      const result = await processPhoto(item.file);
      item.blob = result.blob;
      item.previewUrl = result.previewUrl;
      item.status = "pret";
    } catch (e) {
      item.status = "erreur";
      console.error(e);
    }
    renderQueue();
  }

  statusEl.textContent = `Terminé — ${QUEUE.filter(q => q.status === "pret").length} / ${QUEUE.length} photo(s) prête(s).`;
  btn.disabled = false;
  if (QUEUE.some(q => q.status === "pret")) {
    document.getElementById("download-btn").classList.remove("hidden");
  }
}

async function downloadZip() {
  const zip = new JSZip();
  const usedNames = new Set();
  QUEUE.filter(q => q.status === "pret" && q.blob).forEach(item => {
    let filename = `${item.name || "photo"}.JPG`;
    let n = 1;
    while (usedNames.has(filename.toLowerCase())) {
      filename = `${item.name || "photo"} (${n}).JPG`;
      n++;
    }
    usedNames.add(filename.toLowerCase());
    zip.file(filename, item.blob);
  });
  const content = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(content);
  const a = document.createElement("a");
  a.href = url;
  a.download = "photos-pretes.zip";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ============================================================
// INIT
// ============================================================
function init() {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");

  dropzone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => { addFiles(fileInput.files); fileInput.value = ""; });

  ["dragenter", "dragover"].forEach(evt =>
    dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.add("drag-over"); })
  );
  ["dragleave", "drop"].forEach(evt =>
    dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.remove("drag-over"); })
  );
  dropzone.addEventListener("drop", e => addFiles(e.dataTransfer.files));

  document.getElementById("process-btn").addEventListener("click", processAll);
  document.getElementById("download-btn").addEventListener("click", downloadZip);
  document.getElementById("clear-btn").addEventListener("click", () => {
    QUEUE = [];
    renderQueue();
    document.getElementById("queue-section").classList.add("hidden");
    document.getElementById("download-btn").classList.add("hidden");
    document.getElementById("queue-status").textContent = "";
  });
}
init();

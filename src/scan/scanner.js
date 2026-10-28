// Scan workspace UI: add photos, drag the 4 corners, pick a filter, export PDF/images.
import { FILTERS, applyFilter } from "./filters.js";
import { defaultQuad, rotateCanvas, flipCanvas, detectQuad } from "./perspective.js";
import { buildScanPdf, buildScanImages, buildScanImageFiles, renderPageCanvas } from "./export.js";

const PREVIEW_MAX = 1000; // preview canvas longest side
const THUMB_MAX = 150;

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const uid = () => Math.random().toString(36).slice(2, 9);

function canvasToBlob(canvas, type = "image/png", quality = 0.9) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("canvas export failed"))), type, quality);
  });
}

async function fileToCanvas(file, maxSide = 2600) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas;
}

function scaleCanvas(source, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  if (scale === 1) return source;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Rotates normalized quad points so they still describe the same paper. */
function rotateQuad(quad, angle) {
  const map = (point) => {
    if (angle === 90) return { x: 1 - point.y, y: point.x };
    if (angle === -90 || angle === 270) return { x: point.y, y: 1 - point.x };
    if (angle === 180) return { x: 1 - point.x, y: 1 - point.y };
    return point;
  };
  const mapped = quad.map(map);
  return orderQuad(mapped);
}

function flipQuad(quad) {
  return orderQuad(quad.map((point) => ({ x: 1 - point.x, y: point.y })));
}

/** Sorts 4 points into TL, TR, BR, BL order. */
function orderQuad(points) {
  const byY = [...points].sort((a, b) => a.y - b.y);
  const top = byY.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = byY.slice(2).sort((a, b) => a.x - b.x);
  return [top[0], top[1], bottom[1], bottom[0]];
}

export function createScanner({ onToast = () => {}, onClose = () => {} } = {}) {
  const root = document.getElementById("scanner");
  const pagesList = document.getElementById("scanner-pages");
  const stage = document.getElementById("crop-canvas");
  const overlay = document.getElementById("crop-overlay");
  const wrap = document.getElementById("crop-wrap");
  const filtersStrip = document.getElementById("filters-strip");
  const input = document.getElementById("scanner-input");
  const countLabel = document.getElementById("scanner-count");
  const status = document.getElementById("scanner-status");
  const filterSelect = document.getElementById("scanner-filter-all");
  const cropFrame = document.getElementById("crop-frame");
  const cropWrap = document.getElementById("crop-wrap");
  const caption = document.getElementById("scanner-caption");
  const filesPanel = document.getElementById("scan-files");
  const filesList = document.getElementById("scan-files-list");
  const filesCount = document.getElementById("scan-files-count");
  const filesUrls = []; // object URLs kept alive while the result panel is open

  const state = {
    pages: [],
    activeId: null,
    busy: false,
    applyToAll: false,
  };

  const activePage = () => state.pages.find((page) => page.id === state.activeId) || null;

  function setStatus(text) {
    if (!status) return;
    status.textContent = text || "";
    status.hidden = !text;
  }

  /* ------------------------------- filtering ------------------------------- */

  filtersStrip.innerHTML = "";
  FILTERS.forEach((filter) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter-chip";
    button.dataset.filter = filter.id;
    button.innerHTML = `<span class="filter-thumb" data-thumb="${filter.id}"></span><span class="filter-name">${filter.label}</span><span class="filter-ar">${filter.arabic}</span>`;
    button.addEventListener("click", () => {
      const page = activePage();
      if (!page) return;
      if (state.applyToAll) {
        state.pages.forEach((item) => { item.filter = filter.id; });
      } else {
        page.filter = filter.id;
      }
      refreshFilters();
      renderPageList();
      drawStage();
    });
    filtersStrip.appendChild(button);
  });

  if (filterSelect) {
    filterSelect.addEventListener("change", () => {
      state.applyToAll = filterSelect.checked;
    });
  }

  function refreshFilters() {
    updateCaption();
    const page = activePage();
    [...filtersStrip.children].forEach((button) => {
      button.classList.toggle("active", Boolean(page) && button.dataset.filter === (page.filter || "original"));
    });
  }

  /** Small preview thumbnails for the filter buttons (computed once per active page). */
  function refreshFilterThumbs() {
    const page = activePage();
    if (!page) return;
    const small = scaleCanvas(page.canvas, 220);
    [...filtersStrip.children].forEach((button) => {
      const holder = button.querySelector(".filter-thumb");
      const filter = button.dataset.filter;
      const temp = document.createElement("canvas");
      temp.width = small.width;
      temp.height = small.height;
      const ctx = temp.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(small, 0, 0);
      const data = ctx.getImageData(0, 0, temp.width, temp.height);
      applyFilter(data, filter);
      ctx.putImageData(data, 0, 0);
      holder.innerHTML = "";
      const canvas = document.createElement("canvas");
      canvas.width = THUMB_MAX;
      canvas.height = Math.round((temp.height / temp.width) * THUMB_MAX);
      const thumbCtx = canvas.getContext("2d");
      thumbCtx.drawImage(temp, 0, 0, canvas.width, canvas.height);
      holder.appendChild(canvas);
    });
  }

  /* -------------------------------- pages --------------------------------- */

  async function addFiles(files) {
    const images = [...files].filter((file) => /^image\//.test(file.type));
    if (!images.length) {
      onToast("أضف صوراً (JPG/PNG/WebP) لمسحها ضوئياً");
      return;
    }
    setStatus(`جارٍ تجهيز ${images.length} صورة…`);
    for (const file of images) {
      try {
        const canvas = await fileToCanvas(file);
        const detected = detectQuad(canvas);
        const page = {
          id: uid(),
          name: file.name,
          canvas,
          quad: detected || defaultQuad(1, 1),
          autoDetected: Boolean(detected),
          filter: "original",
          perspective: true,
        };
        state.pages.push(page);
        state.activeId = page.id;
      } catch (error) {
        onToast(`تعذر قراءة ${file.name}`);
      }
    }
    setStatus("");
    renderPageList();
    refreshFilters();
    drawStage();
    refreshFilterThumbs();
    updateCount();
  }

  function updateCount() {
    if (countLabel) countLabel.textContent = `${state.pages.length} صفحة`;
    const empty = document.getElementById("scanner-empty");
    if (empty) empty.hidden = state.pages.length > 0;
    const hasPages = state.pages.length > 0;
    if (filtersStrip) filtersStrip.classList.toggle("empty", !hasPages);
    ["scanner-export-pdf", "scanner-export-images", "scanner-rotate-left", "scanner-rotate-right",
      "scanner-flip", "scanner-crop-all", "scanner-detect", "scanner-page-delete",
      "scanner-export-zip"].forEach((id) => {
      const node = document.getElementById(id);
      if (node) node.disabled = !hasPages;
    });
  }

  function renderPageList() {
    pagesList.innerHTML = "";
    state.pages.forEach((page, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `page-item${page.id === state.activeId ? " active" : ""}`;
      const thumb = document.createElement("canvas");
      const preview = scaleCanvas(page.canvas, 240);
      thumb.width = 120;
      thumb.height = Math.round((preview.height / preview.width) * 120) || 120;
      const ctx = thumb.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(preview, 0, 0, thumb.width, thumb.height);
      const data = ctx.getImageData(0, 0, thumb.width, thumb.height);
      applyFilter(data, page.filter || "original");
      ctx.putImageData(data, 0, 0);
      item.appendChild(thumb);
      const label = document.createElement("span");
      label.textContent = `${index + 1}`;
      item.appendChild(label);
      item.addEventListener("click", () => {
        state.activeId = page.id;
        renderPageList();
        refreshFilters();
        drawStage();
        refreshFilterThumbs();
      });
      pagesList.appendChild(item);
    });
  }

  /* ------------------------------ crop canvas ----------------------------- */

  let preview = { canvas: null, scale: 1, quadPx: [] };

  /** Sizes the canvas so it always fits the free space above the tools (no overlap). */
  function fitStage() {
    if (!cropFrame || !cropWrap || !stage.width) return;
    const rect = cropWrap.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return;
    const availableWidth = Math.max(80, rect.width - 10);
    const availableHeight = Math.max(80, rect.height - 10);
    const ratio = stage.width / stage.height || 1;
    let width = availableWidth;
    let height = width / ratio;
    if (height > availableHeight) {
      height = availableHeight;
      width = height * ratio;
    }
    cropFrame.style.width = `${Math.round(width)}px`;
    cropFrame.style.height = `${Math.round(height)}px`;
  }

  if (typeof ResizeObserver !== "undefined" && cropWrap) {
    new ResizeObserver(() => fitStage()).observe(cropWrap);
  }

  function drawStage() {
    const page = activePage();
    if (!page) {
      stage.width = 10;
      stage.height = 10;
      overlay.setAttribute("viewBox", "0 0 10 10");
      overlay.innerHTML = "";
      if (cropFrame) cropFrame.hidden = true;
      return;
    }
    if (cropFrame) cropFrame.hidden = false;
    const source = scaleCanvas(page.canvas, PREVIEW_MAX);
    const previewCanvas = document.createElement("canvas");
    previewCanvas.width = source.width;
    previewCanvas.height = source.height;
    const ctx = previewCanvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0);
    const data = ctx.getImageData(0, 0, previewCanvas.width, previewCanvas.height);
    applyFilter(data, page.filter || "original");
    ctx.putImageData(data, 0, 0);

    stage.width = previewCanvas.width;
    stage.height = previewCanvas.height;
    stage.getContext("2d").drawImage(previewCanvas, 0, 0);
    preview = {
      canvas: previewCanvas,
      scale: previewCanvas.width / stage.clientWidth || 1,
      quadPx: page.quad.map((point) => ({ x: point.x * previewCanvas.width, y: point.y * previewCanvas.height })),
    };
    fitStage();
    drawOverlay();
    updateCaption();
  }

  function updateCaption() {
    if (!caption) return;
    const page = activePage();
    if (!page) {
      caption.innerHTML = "";
      return;
    }
    const filter = FILTERS.find((item) => item.id === (page.filter || "original"));
    const index = state.pages.findIndex((item) => item.id === page.id) + 1;
    caption.innerHTML = `<span>صفحة ${index} من ${state.pages.length} · ${page.canvas.width}×${page.canvas.height}</span>`
      + `<span>${filter ? filter.label : "Original"} — ${filter ? filter.arabic : "الأصلية"}`
      + `${page.autoDetected === false ? " · قص يدوي" : " · اكتشاف تلقائي"}</span>`;
  }

  function drawOverlay() {
    const page = activePage();
    if (!page) return;
    const points = page.quad.map((point) => ({ x: point.x * stage.width, y: point.y * stage.height }));
    overlay.setAttribute("viewBox", `0 0 ${stage.width} ${stage.height}`);
    overlay.setAttribute("preserveAspectRatio", "none");
    overlay.innerHTML = "";
    const ns = "http://www.w3.org/2000/svg";

    const polygon = document.createElementNS(ns, "polygon");
    polygon.setAttribute("points", points.map((p) => `${p.x},${p.y}`).join(" "));
    polygon.setAttribute("class", "crop-shape");
    overlay.appendChild(polygon);

    const edges = [[0, 1], [1, 2], [2, 3], [3, 0]];
    edges.forEach(([a, b]) => {
      const line = document.createElementNS(ns, "line");
      line.setAttribute("x1", points[a].x);
      line.setAttribute("y1", points[a].y);
      line.setAttribute("x2", points[b].x);
      line.setAttribute("y2", points[b].y);
      line.setAttribute("class", "crop-edge");
      overlay.appendChild(line);
    });

    // handle radius in canvas units so it stays ~11 CSS pixels on screen at any zoom
    const cssWidth = cropFrame ? cropFrame.getBoundingClientRect().width : stage.width;
    const radius = Math.max(6, Math.min(26, (stage.width / Math.max(1, cssWidth)) * 11));
    points.forEach((point, index) => {
      const handle = document.createElementNS(ns, "circle");
      handle.setAttribute("cx", point.x);
      handle.setAttribute("cy", point.y);
      handle.setAttribute("r", radius);
      handle.setAttribute("class", "crop-handle");
      handle.dataset.index = String(index);
      overlay.appendChild(handle);
    });
  }

  let dragIndex = null;

  function pointerToImage(event) {
    const rect = overlay.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * stage.width;
    const y = ((event.clientY - rect.top) / rect.height) * stage.height;
    return {
      x: clamp01(x / stage.width),
      y: clamp01(y / stage.height),
    };
  }

  overlay.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (!target.dataset || target.dataset.index === undefined) return;
    dragIndex = Number(target.dataset.index);
    overlay.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  overlay.addEventListener("pointermove", (event) => {
    if (dragIndex === null) return;
    const page = activePage();
    if (!page) return;
    const point = pointerToImage(event);
    page.quad[dragIndex] = point;
    page.autoDetected = false;
    drawOverlay();
  });

  const endDrag = (event) => {
    if (dragIndex === null) return;
    dragIndex = null;
    try {
      overlay.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  };
  overlay.addEventListener("pointerup", endDrag);
  overlay.addEventListener("pointercancel", endDrag);

  /* -------------------------------- actions ------------------------------- */

  function rotate(angle) {
    const page = activePage();
    if (!page) return;
    page.canvas = rotateCanvas(page.canvas, angle);
    page.quad = rotateQuad(page.quad, angle);
    drawStage();
    renderPageList();
    refreshFilterThumbs();
  }

  function flip() {
    const page = activePage();
    if (!page) return;
    page.canvas = flipCanvas(page.canvas);
    page.quad = flipQuad(page.quad);
    drawStage();
    renderPageList();
    refreshFilterThumbs();
  }

  function cropAll() {
    const page = activePage();
    if (!page) return;
    page.quad = defaultQuad(1, 1);
    drawStage();
  }

  function autoDetect() {
    const page = activePage();
    if (!page) return;
    const quad = detectQuad(page.canvas);
    if (!quad) {
      onToast("لم أتمكن من اكتشاف حدود الورقة — اضبط الزوايا يدوياً");
      return;
    }
    page.quad = quad;
    page.autoDetected = true;
    drawStage();
    onToast("تم اكتشاف حدود الورقة — يمكنك تعديل الزوايا بالسحب");
  }

  function deletePage() {
    const index = state.pages.findIndex((page) => page.id === state.activeId);
    if (index === -1) return;
    state.pages.splice(index, 1);
    state.activeId = state.pages[Math.min(index, state.pages.length - 1)]?.id || null;
    renderPageList();
    refreshFilters();
    drawStage();
    refreshFilterThumbs();
    updateCount();
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
  }

  async function exportPdf() {
    if (!state.pages.length || state.busy) return;
    state.busy = true;
    setStatus("جارٍ إنشاء ملف PDF…");
    try {
      const blob = await buildScanPdf(state.pages, {
        quality: 0.88,
        onProgress: (percent) => setStatus(`جارٍ إنشاء ملف PDF… ${percent}%`),
      });
      download(blob, `scan-${Date.now()}.pdf`);
      setStatus("");
      onToast(`تم إنشاء PDF من ${state.pages.length} صفحة (${(blob.size / 1024 / 1024).toFixed(2)} ميجابايت)`);
    } catch (error) {
      setStatus("");
      onToast(`تعذر إنشاء PDF: ${error.message}`);
    } finally {
      state.busy = false;
    }
  }

  function openResultPanel(files) {
    if (!filesPanel || !filesList) return;
    clearResultPanel();
    filesCount.textContent = String(files.length);
    files.forEach((file) => {
      const url = URL.createObjectURL(file.blob);
      filesUrls.push(url);
      const item = document.createElement("li");
      item.className = "scan-file";
      const thumb = document.createElement("img");
      thumb.src = url;
      thumb.alt = file.name;
      const meta = document.createElement("div");
      meta.className = "scan-file-meta";
      const name = document.createElement("span");
      name.className = "scan-file-name";
      name.textContent = file.name;
      const size = document.createElement("span");
      size.className = "scan-file-size";
      size.textContent = `${file.width}×${file.height} · ${(file.blob.size / 1024).toFixed(0)} كيلوبايت`;
      meta.append(name, size);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      link.textContent = "تحميل";
      item.append(thumb, meta, link);
      filesList.appendChild(item);
    });
    filesPanel.hidden = false;
    filesPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function clearResultPanel() {
    if (filesList) filesList.innerHTML = "";
    while (filesUrls.length) URL.revokeObjectURL(filesUrls.pop());
    if (filesPanel) filesPanel.hidden = true;
  }

  /** Saves every cropped page as its own JPG file (no ZIP). */
  async function exportImages() {
    if (!state.pages.length || state.busy) return;
    state.busy = true;
    setStatus("جارٍ تجهيز الصور…");
    try {
      const files = await buildScanImageFiles(state.pages, {
        format: "jpg",
        quality: 0.9,
        onProgress: (percent) => setStatus(`جارٍ تجهيز الصور… ${percent}%`),
      });
      setStatus("");
      if (files.length === 1) {
        download(files[0].blob, files[0].name);
        onToast(`تم حفظ الصورة: ${files[0].name}`);
        return;
      }
      openResultPanel(files);
      onToast(`تم تجهيز ${files.length} صورة — اضغط «تحميل» أو «تحميل الكل»`);
    } catch (error) {
      setStatus("");
      onToast(`تعذر تجهيز الصور: ${error.message}`);
    } finally {
      state.busy = false;
    }
  }

  /** Triggers the download of every prepared page image, one after another. */
  async function downloadAllFiles() {
    if (!filesList) return;
    const links = [...filesList.querySelectorAll("a[download]")];
    for (let index = 0; index < links.length; index += 1) {
      links[index].click();
      await new Promise((resolve) => setTimeout(resolve, 450));
    }
    onToast(`جارٍ حفظ ${links.length} صورة في مجلد التنزيلات`);
  }

  async function exportZip() {
    if (!state.pages.length || state.busy) return;
    state.busy = true;
    setStatus("جارٍ تجهيز ملف ZIP…");
    try {
      const blob = await buildScanImages(state.pages, {
        format: "jpg",
        quality: 0.9,
        onProgress: (percent) => setStatus(`جارٍ تجهيز ZIP… ${percent}%`),
      });
      download(blob, `scan-images-${Date.now()}.zip`);
      setStatus("");
      onToast(`تم تجهيز ${state.pages.length} صورة داخل ملف ZIP`);
    } catch (error) {
      setStatus("");
      onToast(`تعذر تجهيز ZIP: ${error.message}`);
    } finally {
      state.busy = false;
    }
  }

  /** Live preview of a single page (used by the tests and the "preview" button). */
  async function previewActivePage() {
    const page = activePage();
    if (!page) return null;
    const canvas = renderPageCanvas(page, { maxSize: 1400 });
    return canvasToBlob(canvas, "image/jpeg", 0.9);
  }

  function open() {
    root.hidden = false;
    document.body.classList.add("scanner-open");
    drawStage();
    requestAnimationFrame(fitStage);
    refreshFilters();
    updateCount();
    if (state.pages.length) {
      renderPageList();
      refreshFilterThumbs();
    }
  }

  function close() {
    root.hidden = true;
    document.body.classList.remove("scanner-open");
    onClose();
  }

  /* -------------------------------- wiring -------------------------------- */

  document.getElementById("scanner-add").addEventListener("click", () => input.click());
  const dropZone = document.getElementById("scanner-drop");
  if (dropZone) {
    dropZone.addEventListener("click", () => input.click());
    dropZone.addEventListener("dragover", (event) => {
      event.preventDefault();
      dropZone.classList.add("dragging");
    });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragging"));
    dropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      dropZone.classList.remove("dragging");
      addFiles(event.dataTransfer.files);
    });
  }
  input.addEventListener("change", () => {
    addFiles(input.files);
    input.value = "";
  });

  document.getElementById("scanner-close").addEventListener("click", close);
  document.getElementById("scanner-rotate-left").addEventListener("click", () => rotate(-90));
  document.getElementById("scanner-rotate-right").addEventListener("click", () => rotate(90));
  document.getElementById("scanner-flip").addEventListener("click", flip);
  document.getElementById("scanner-crop-all").addEventListener("click", cropAll);
  document.getElementById("scanner-detect").addEventListener("click", autoDetect);
  document.getElementById("scanner-page-delete").addEventListener("click", deletePage);
  document.getElementById("scanner-export-pdf").addEventListener("click", exportPdf);
  document.getElementById("scanner-export-images").addEventListener("click", exportImages);
  document.getElementById("scanner-export-zip").addEventListener("click", exportZip);
  const filesAll = document.getElementById("scan-files-all");
  if (filesAll) filesAll.addEventListener("click", downloadAllFiles);
  const filesClose = document.getElementById("scan-files-close");
  if (filesClose) filesClose.addEventListener("click", clearResultPanel);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !root.hidden) close();
  });
  window.addEventListener("resize", () => {
    if (root.hidden) return;
    fitStage();
    drawOverlay();
    updateCaption();
  });

  function updateCaption() {
    if (!caption) return;
    const page = activePage();
    if (!page) {
      caption.innerHTML = "";
      return;
    }
    const filter = FILTERS.find((item) => item.id === (page.filter || "original"));
    const index = state.pages.findIndex((item) => item.id === page.id) + 1;
    caption.innerHTML = `<span>صفحة ${index} من ${state.pages.length} · ${page.canvas.width}×${page.canvas.height}</span>`
      + `<span>${filter ? filter.label : "Original"} — ${filter ? filter.arabic : "الأصلية"}`
      + `${page.autoDetected === false ? " · قص يدوي" : " · اكتشاف تلقائي"}</span>`;
  }

  return {
    open,
    close,
    addFiles,
    state,
    previewActivePage,
    exportPdf,
    exportImages,
    exportZip,
    downloadAllFiles,
    clearResultPanel,
    rotate,
    flip,
    cropAll,
    autoDetect,
    deletePage,
    selectPage: (id) => {
      state.activeId = id;
      renderPageList();
      refreshFilters();
      drawStage();
      refreshFilterThumbs();
    },
    setFilter: (id) => {
      const page = activePage();
      if (!page) return;
      page.filter = id;
      refreshFilters();
      renderPageList();
      drawStage();
    },
  };
}

// Scan workspace UI: add photos, drag the 4 corners, pick a filter, export PDF/images.
import { FILTERS, applyFilter } from "./filters.js";
import { defaultQuad, rotateCanvas, flipCanvas, detectQuadDetailed } from "./perspective.js";
import { buildScanPdf, buildScanImages, buildScanImageFiles, renderPageCanvas, applyAdjust } from "./export.js";

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
  let preparedFiles = []; // [{ name, blob, url, width, height }] for the viewer
  let viewerIndex = 0;
  const viewer = document.getElementById("scan-viewer");
  const viewerImg = document.getElementById("scan-viewer-img");
  const viewerName = document.getElementById("scan-viewer-name");
  const viewerMeta = document.getElementById("scan-viewer-meta");
  const viewerDownload = document.getElementById("scan-viewer-download");
  const brightnessInput = document.getElementById("scanner-brightness");
  const contrastInput = document.getElementById("scanner-contrast");
  const brightnessValue = document.getElementById("scanner-brightness-value");
  const contrastValue = document.getElementById("scanner-contrast-value");
  const history = []; // undo stack (canvas + quad + filter + adjust snapshots)

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
      snapshot(`فلتر ${filter.label}`);
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
        const detection = detectQuadDetailed(canvas);
        const page = {
          id: uid(),
          name: file.name,
          canvas,
          quad: detection.quad || defaultQuad(1, 1),
          autoDetected: Boolean(detection.quad),
          confidence: detection.confidence || 0,
          filter: "original",
          adjust: { brightness: 0, contrast: 0 },
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
      "scanner-export-zip", "scanner-detect-all", "scanner-rotate-all", "scanner-adjust-reset"].forEach((id) => {
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
      label.className = "page-item-index";
      label.textContent = `${index + 1}`;
      item.appendChild(label);
      const tools = document.createElement("span");
      tools.className = "page-item-tools";
      const back = document.createElement("button");
      back.type = "button";
      back.className = "page-move";
      back.textContent = "›";
      back.title = "تحريك لليمين";
      back.disabled = index === state.pages.length - 1;
      back.addEventListener("click", (event) => {
        event.stopPropagation();
        movePage(index, index + 1);
      });
      const forward = document.createElement("button");
      forward.type = "button";
      forward.className = "page-move";
      forward.textContent = "‹";
      forward.title = "تحريك لليسار";
      forward.disabled = index === 0;
      forward.addEventListener("click", (event) => {
        event.stopPropagation();
        movePage(index, index - 1);
      });
      tools.append(back, forward);
      item.appendChild(tools);
      item.addEventListener("click", () => {
        state.activeId = page.id;
        renderPageList();
        refreshFilters();
        drawStage();
        refreshFilterThumbs();
        syncAdjustControls();
      });
      pagesList.appendChild(item);
    });
  }

  /* -------------------------------- history ------------------------------- */

  function snapshot(label) {
    history.push({
      label,
      pages: state.pages.map((page) => ({
        id: page.id,
        quad: page.quad.map((point) => ({ ...point })),
        filter: page.filter,
        adjust: { ...(page.adjust || {}) },
        canvas: page.canvas,
        autoDetected: page.autoDetected,
        confidence: page.confidence,
      })),
      activeId: state.activeId,
    });
    if (history.length > 25) history.shift();
    const undoButton = document.getElementById("scanner-undo");
    if (undoButton) undoButton.disabled = false;
  }

  function undo() {
    const entry = history.pop();
    if (!entry) return;
    state.pages = entry.pages.map((snapshotPage) => {
      let current = state.pages.find((page) => page.id === snapshotPage.id);
      if (!current) {
        current = { id: snapshotPage.id, name: "page", canvas: snapshotPage.canvas, perspective: true };
        state.pages.push(current);
      }
      current.quad = snapshotPage.quad.map((point) => ({ ...point }));
      current.filter = snapshotPage.filter;
      current.adjust = { ...snapshotPage.adjust };
      current.canvas = snapshotPage.canvas;
      current.autoDetected = snapshotPage.autoDetected;
      current.confidence = snapshotPage.confidence;
      return current;
    });
    state.activeId = entry.activeId;
    const undoButton = document.getElementById("scanner-undo");
    if (undoButton) undoButton.disabled = history.length === 0;
    renderPageList();
    refreshFilters();
    drawStage();
    refreshFilterThumbs();
    updateCount();
    syncAdjustControls();
    onToast(`تم التراجع عن: ${entry.label}`);
  }

  /* --------------------------- batch operations --------------------------- */

  function setBusy(busy, label) {
    state.busy = busy;
    if (label) setStatus(label);
    if (!busy) setStatus("");
  }

  async function detectAll() {
    if (!state.pages.length || state.busy) return;
    snapshot("اكتشاف تلقائي للكل");
    state.busy = true;
    let worked = 0;
    for (let index = 0; index < state.pages.length; index += 1) {
      const page = state.pages[index];
      setStatus(`اكتشاف حدود الورقة… صفحة ${index + 1} من ${state.pages.length}`);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const detection = detectQuadDetailed(page.canvas);
      if (detection.quad) {
        page.quad = detection.quad;
        page.autoDetected = true;
        page.confidence = detection.confidence;
        worked += 1;
      }
    }
    state.busy = false;
    setStatus("");
    drawStage();
    renderPageList();
    refreshFilters();
    onToast(worked === state.pages.length
      ? `تم اكتشاف حدود ${worked} صفحة`
      : `تم اكتشاف ${worked} من ${state.pages.length} صفحة — راجع الباقي يدوياً`);
  }

  function rotateAll() {
    if (!state.pages.length || state.busy) return;
    snapshot("تدوير كل الصفحات");
    state.pages.forEach((page) => {
      page.canvas = rotateCanvas(page.canvas, 90);
      page.quad = rotateQuad(page.quad, 90);
    });
    drawStage();
    renderPageList();
    refreshFilterThumbs();
    onToast(`تم تدوير ${state.pages.length} صفحة`);
  }

  function movePage(fromIndex, toIndex) {
    if (toIndex < 0 || toIndex >= state.pages.length || fromIndex === toIndex) return;
    snapshot("ترتيب الصفحات");
    const [page] = state.pages.splice(fromIndex, 1);
    state.pages.splice(toIndex, 0, page);
    renderPageList();
    updateCount();
  }

  /* ------------------------------- adjust UI ------------------------------ */

  function syncAdjustControls() {
    const page = activePage();
    const adjust = (page && page.adjust) || { brightness: 0, contrast: 0 };
    if (brightnessInput) brightnessInput.value = String(adjust.brightness || 0);
    if (contrastInput) contrastInput.value = String(adjust.contrast || 0);
    if (brightnessValue) brightnessValue.textContent = String(adjust.brightness || 0);
    if (contrastValue) contrastValue.textContent = String(adjust.contrast || 0);
  }

  function setAdjust(key, value) {
    const page = activePage();
    if (!page) return;
    const targets = state.applyToAll ? state.pages : [page];
    targets.forEach((item) => {
      item.adjust = { brightness: 0, contrast: 0, ...(item.adjust || {}), [key]: Number(value) };
    });
    if (brightnessValue) brightnessValue.textContent = String(page.adjust.brightness || 0);
    if (contrastValue) contrastValue.textContent = String(page.adjust.contrast || 0);
    drawStage();
    renderPageList();
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
    applyAdjust(data, page.adjust);
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
    snapshot(angle === 90 ? "تدوير يمين" : "تدوير يسار");
    page.canvas = rotateCanvas(page.canvas, angle);
    page.quad = rotateQuad(page.quad, angle);
    drawStage();
    renderPageList();
    refreshFilterThumbs();
  }

  function flip() {
    const page = activePage();
    if (!page) return;
    snapshot("قلب الصفحة");
    page.canvas = flipCanvas(page.canvas);
    page.quad = flipQuad(page.quad);
    drawStage();
    renderPageList();
    refreshFilterThumbs();
  }

  function cropAll() {
    const page = activePage();
    if (!page) return;
    snapshot("تحديد كل الورقة");
    page.quad = defaultQuad(1, 1);
    drawStage();
  }

  function autoDetect() {
    const page = activePage();
    if (!page) return;
    setStatus("جارٍ تحليل حدود الورقة…");
    // let the status text paint before the CPU-heavy detection runs
    setTimeout(() => {
      const detection = detectQuadDetailed(page.canvas);
      setStatus("");
      if (!detection.quad) {
        onToast("لم أتمكن من اكتشاف حدود الورقة — اسحب الزوايا الأربع يدوياً");
        return;
      }
      page.quad = detection.quad;
      page.autoDetected = true;
      page.confidence = detection.confidence;
      drawStage();
      const percent = Math.round(detection.confidence * 100);
      onToast(detection.confidence >= 0.6
        ? `تم اكتشاف حدود الورقة (ثقة ${percent}%) — يمكنك تعديل الزوايا بالسحب`
        : `اكتشاف بثقة منخفضة (${percent}%) — راجع الزوايا واسحبها إن لزم`);
    }, 30);
  }

  function deletePage() {
    const index = state.pages.findIndex((page) => page.id === state.activeId);
    if (index === -1) return;
    snapshot("حذف صفحة");
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

  const EYE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.8"/></svg>';

  function openResultPanel(files) {
    if (!filesPanel || !filesList) return;
    clearResultPanel();
    preparedFiles = files.map((file) => ({ ...file }));
    filesCount.textContent = String(preparedFiles.length);
    preparedFiles.forEach((file, index) => {
      const url = URL.createObjectURL(file.blob);
      file.url = url;
      filesUrls.push(url);
      const item = document.createElement("li");
      item.className = "scan-file";
      const thumb = document.createElement("img");
      thumb.src = url;
      thumb.alt = file.name;
      thumb.title = "اضغط لعرض الصورة بالحجم الكامل";
      const meta = document.createElement("div");
      meta.className = "scan-file-meta";
      const name = document.createElement("span");
      name.className = "scan-file-name";
      name.textContent = file.name;
      const size = document.createElement("span");
      size.className = "scan-file-size";
      size.textContent = `${file.width}×${file.height} · ${(file.blob.size / 1024).toFixed(0)} كيلوبايت`;
      meta.append(name, size);

      const actions = document.createElement("div");
      actions.className = "scan-file-actions";
      const view = document.createElement("button");
      view.type = "button";
      view.className = "scan-file-view";
      view.title = `عرض ${file.name}`;
      view.setAttribute("aria-label", `عرض ${file.name}`);
      view.innerHTML = EYE_ICON;
      view.addEventListener("click", () => openViewer(index));
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      link.textContent = "تحميل";
      actions.append(view, link);
      thumb.addEventListener("click", () => openViewer(index));

      item.append(thumb, meta, actions);
      filesList.appendChild(item);
    });
    filesPanel.hidden = false;
    filesPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /* ------------------------------ image viewer ----------------------------- */

  function openViewer(index) {
    if (!viewer || !preparedFiles.length) return;
    viewerIndex = Math.max(0, Math.min(preparedFiles.length - 1, index));
    const file = preparedFiles[viewerIndex];
    viewerImg.src = file.url;
    viewerImg.alt = file.name;
    viewerName.textContent = file.name;
    viewerMeta.textContent = `${file.width}×${file.height} بكسل · ${(file.blob.size / 1024).toFixed(0)} كيلوبايت`
      + ` · ${viewerIndex + 1} من ${preparedFiles.length}`;
    viewerDownload.href = file.url;
    viewerDownload.download = file.name;
    const many = preparedFiles.length > 1;
    document.getElementById("scan-viewer-prev").disabled = !many;
    document.getElementById("scan-viewer-next").disabled = !many;
    viewer.hidden = false;
  }

  function closeViewer() {
    if (!viewer) return;
    viewer.hidden = true;
  }

  function stepViewer(delta) {
    if (viewer.hidden || preparedFiles.length < 2) return;
    const next = (viewerIndex + delta + preparedFiles.length) % preparedFiles.length;
    openViewer(next);
  }

  function clearResultPanel() {
    closeViewer();
    if (filesList) filesList.innerHTML = "";
    while (filesUrls.length) URL.revokeObjectURL(filesUrls.pop());
    preparedFiles = [];
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
    syncAdjustControls();
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
  document.getElementById("scanner-detect-all").addEventListener("click", detectAll);
  document.getElementById("scanner-rotate-all").addEventListener("click", rotateAll);
  document.getElementById("scanner-undo").addEventListener("click", undo);
  if (brightnessInput) brightnessInput.addEventListener("input", (event) => setAdjust("brightness", event.target.value));
  if (contrastInput) contrastInput.addEventListener("input", (event) => setAdjust("contrast", event.target.value));
  const adjustReset = document.getElementById("scanner-adjust-reset");
  if (adjustReset) {
    adjustReset.addEventListener("click", () => {
      snapshot("إعادة ضبط السطوع والتباين");
      state.pages.forEach((item) => { item.adjust = { brightness: 0, contrast: 0 }; });
      syncAdjustControls();
      drawStage();
      renderPageList();
    });
  }
  document.getElementById("scanner-page-delete").addEventListener("click", deletePage);
  document.getElementById("scanner-export-pdf").addEventListener("click", exportPdf);
  document.getElementById("scanner-export-images").addEventListener("click", exportImages);
  document.getElementById("scanner-export-zip").addEventListener("click", exportZip);
  const filesAll = document.getElementById("scan-files-all");
  if (filesAll) filesAll.addEventListener("click", downloadAllFiles);
  const filesClose = document.getElementById("scan-files-close");
  if (filesClose) filesClose.addEventListener("click", clearResultPanel);
  if (viewer) {
    document.getElementById("scan-viewer-close").addEventListener("click", closeViewer);
    document.getElementById("scan-viewer-prev").addEventListener("click", () => stepViewer(-1));
    document.getElementById("scan-viewer-next").addEventListener("click", () => stepViewer(1));
    document.getElementById("scan-viewer-body").addEventListener("click", (event) => {
      if (event.target.id === "scan-viewer-body") closeViewer();
    });
    document.addEventListener("keydown", (event) => {
      if (viewer.hidden) return;
      if (event.key === "ArrowLeft") stepViewer(-1);
      if (event.key === "ArrowRight") stepViewer(1);
      if (event.key === "ArrowLeft") stepViewer(-1);
    });
  }
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !root.hidden) {
      event.preventDefault();
      undo();
    }
  });

  // one Escape handler decides: close the preview first, the workspace second
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (viewer && !viewer.hidden) {
      closeViewer();
      return;
    }
    if (!root.hidden) close();
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
      + (page.autoDetected === false
        ? " · قص يدوي"
        : ` · اكتشاف تلقائي ${Math.round((page.confidence || 0) * 100)}%${(page.confidence || 0) < 0.6 ? " ⚠ راجع الزوايا" : ""}`)
      + "</span>";
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
    openViewer,
    closeViewer,
    stepViewer,
    getPreparedFiles: () => preparedFiles,
    rotate,
    flip,
    cropAll,
    pageOrder: () => state.pages.map((page) => page.id),
    pageState: (id) => {
      const page = state.pages.find((item) => item.id === id);
      return page ? { filter: page.filter, adjust: { ...page.adjust }, quad: page.quad } : null;
    },
    historyDepth: () => history.length,
    autoDetect,
    detectAll,
    rotateAll,
    undo,
    movePage,
    setAdjust,
    syncAdjustControls,
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

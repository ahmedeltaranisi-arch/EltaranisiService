const stroke = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';

const ICONS = {
  merge: `<svg viewBox="0 0 24 24" ${stroke}><path d="M7 4v5a4 4 0 0 0 4 4h6"/><path d="m14 10 3 3-3 3"/><path d="M7 20v-3"/><path d="M4 7h3M4 20h3"/></svg>`,
  split: `<svg viewBox="0 0 24 24" ${stroke}><circle cx="6" cy="7" r="2"/><circle cx="6" cy="17" r="2"/><path d="M8 8.5 20 15M8 15.5 20 9"/></svg>`,
  compress: `<svg viewBox="0 0 24 24" ${stroke}><path d="M4 9h16M4 15h16"/><path d="m9 5 3 3 3-3M9 19l3-3 3 3"/></svg>`,
  word: `<svg viewBox="0 0 24 24" ${stroke}><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="m8 12 1.4 5 1.6-3 1.6 3L14 12"/></svg>`,
  excel: `<svg viewBox="0 0 24 24" ${stroke}><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="m9 12 6 5M15 12l-6 5"/></svg>`,
  ppt: `<svg viewBox="0 0 24 24" ${stroke}><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8 20h8"/><path d="M9 8h4a2.5 2.5 0 0 1 0 5H9V8"/></svg>`,
  image: `<svg viewBox="0 0 24 24" ${stroke}><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 18 5-5 4 4 3-3 4 4"/></svg>`,
  pdf: `<svg viewBox="0 0 24 24" ${stroke}><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 17v-5h2a1.8 1.8 0 0 1 0 3.6H9"/></svg>`,
  text: `<svg viewBox="0 0 24 24" ${stroke}><path d="M5 6h14M5 11h9M5 16h12M5 21h6"/></svg>`,
  watermark: `<svg viewBox="0 0 24 24" ${stroke}><path d="M12 3s5 5.5 5 9a5 5 0 0 1-10 0c0-3.5 5-9 5-9Z"/><path d="M9 13a3 3 0 0 0 3 3"/></svg>`,
  numbers: `<svg viewBox="0 0 24 24" ${stroke}><path d="M8 4 6 20M17 4l-2 16M4 9h16M3 15h16"/></svg>`,
  rotate: `<svg viewBox="0 0 24 24" ${stroke}><path d="M20 11a8 8 0 1 0-2.5 6"/><path d="M20 5v6h-6"/></svg>`,
  order: `<svg viewBox="0 0 24 24" ${stroke}><rect x="4" y="4" width="6" height="6" rx="1.4"/><rect x="14" y="4" width="6" height="6" rx="1.4"/><rect x="4" y="14" width="6" height="6" rx="1.4"/><path d="M14 17h6M17 14v6"/></svg>`,
  csv: `<svg viewBox="0 0 24 24" ${stroke}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11M15 9v11"/></svg>`,
  scan: `<svg viewBox="0 0 24 24" ${stroke}><path d="M4 8V6a2 2 0 0 1 2-2h2M20 8V6a2 2 0 0 0-2-2h-2M4 16v2a2 2 0 0 0 2 2h2M20 16v2a2 2 0 0 1-2 2h-2"/><path d="M4 12h16"/></svg>`,
  file: `<svg viewBox="0 0 24 24" ${stroke}><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg>`,
};

const TOOLS = [
  {
    id: "pdf:merge", cat: "pdf", icon: "merge", title: "دمج PDF",
    desc: "اجمع عدة ملفات PDF في ملف واحد بالترتيب الذي تريده.",
    accept: ".pdf", multiple: true, minFiles: 2,
  },
  {
    id: "pdf:split", cat: "pdf", icon: "split", title: "تقسيم PDF",
    desc: "استخرج صفحات محددة أو قسّم الملف إلى ملفات منفصلة.",
    accept: ".pdf", options: [
      { key: "mode", label: "طريقة التقسيم", type: "select", values: [["ranges", "نطاق صفحات (مثال: 1-3,5)"], ["each", "كل صفحة في ملف"], ["chunks", "كل عدد صفحات"]] },
      { key: "ranges", label: "النطاق أو عدد الصفحات بكل ملف", type: "text", placeholder: "1-3,5 أو 2", hint: "يُستخدم مع النطاق أو التقسيم كل عدد صفحات" },
    ],
  },
  {
    id: "pdf:compress", cat: "pdf", icon: "compress", title: "ضغط PDF",
    desc: "تقليل حجم الملف مع الحفاظ على قابلية القراءة.",
    accept: ".pdf", options: [
      { key: "level", label: "مستوى الضغط", type: "select", values: [["light", "خفيف (إزالة البيانات الوصفية)"], ["medium", "متوسط (موصى به)"], ["strong", "قوي (أقصى تصغير)"]] },
    ],
  },
  {
    id: "pdf:to-docx", cat: "convert", icon: "word", title: "PDF ← Word",
    desc: "تحويل PDF إلى DOCX قابل للتعديل مع الحفاظ على العربية.",
    accept: ".pdf",
  },
  {
    id: "pdf:to-xlsx", cat: "convert", icon: "excel", title: "PDF ← Excel",
    desc: "استخراج الجداول والنصوص إلى ملف XLSX.",
    accept: ".pdf",
  },
  {
    id: "pdf:to-pptx", cat: "convert", icon: "ppt", title: "PDF ← PowerPoint",
    desc: "كل صفحة PDF تصبح شريحة عرض في ملف PPTX.",
    accept: ".pdf", options: [
      { key: "dpi", label: "جودة الصور (DPI)", type: "number", value: 150, min: 96, max: 220 },
    ],
  },
  {
    id: "pdf:to-jpg", cat: "convert", icon: "image", title: "PDF ← JPG",
    desc: "تحويل كل صفحة إلى صورة JPG عالية الجودة.",
    accept: ".pdf", options: [
      { key: "dpi", label: "الدقة (DPI)", type: "number", value: 150, min: 72, max: 300 },
    ],
  },
  {
    id: "pdf:to-png", cat: "convert", icon: "image", title: "PDF ← PNG",
    desc: "صور PNG شفافة الحواف لكل صفحة.",
    accept: ".pdf", options: [
      { key: "dpi", label: "الدقة (DPI)", type: "number", value: 150, min: 72, max: 300 },
    ],
  },
  {
    id: "pdf:to-txt", cat: "convert", icon: "text", title: "PDF ← نص",
    desc: "استخراج النص الكامل من ملف PDF.",
    accept: ".pdf",
  },
  {
    id: "img:to-pdf", cat: "image", icon: "pdf", title: "صور ← PDF",
    desc: "حوّل صور JPG/PNG/WebP إلى ملف PDF واحد.",
    accept: "image/*", multiple: true, options: [
      { key: "pageSize", label: "مقاس الصفحة", type: "select", values: [["fit", "بحجم الصورة"], ["A4", "A4"], ["A3", "A3"], ["Letter", "Letter"]] },
      { key: "margin", label: "الهامش (نقاط)", type: "number", value: 0, min: 0, max: 120 },
    ],
  },
  {
    id: "to-pdf", cat: "convert", icon: "pdf", title: "تحويل إلى PDF",
    desc: "Word وExcel وPowerPoint والنصوص وHTML والصور ← PDF.",
    accept: ".docx,.xlsx,.pptx,.txt,.csv,.html,.htm,.jpg,.jpeg,.png,.webp", multiple: true,
  },
  {
    id: "docx:to-pdf", cat: "office", icon: "word", title: "Word ← PDF",
    desc: "تحويل مستند DOCX إلى PDF بتنسيق عربي دقيق.",
    accept: ".docx",
  },
  {
    id: "xlsx:to-pdf", cat: "office", icon: "excel", title: "Excel ← PDF",
    desc: "تحويل جداول XLSX إلى PDF بمقاس عرضي.",
    accept: ".xlsx,.xls,.csv",
  },
  {
    id: "pptx:to-pdf", cat: "office", icon: "ppt", title: "PowerPoint ← PDF",
    desc: "تحويل العرض التقديمي PPTX إلى PDF بمقاس الشرائح.",
    accept: ".pptx",
  },
  {
    id: "pdf:watermark", cat: "pdf", icon: "watermark", title: "علامة مائية",
    desc: "أضف نصاً عربياً أو إنجليزياً كعلامة مائية.",
    accept: ".pdf", options: [
      { key: "text", label: "نص العلامة", type: "text", value: "سري للغاية" },
      { key: "opacity", label: "الشفافية (0.05 – 1)", type: "number", value: 0.16, min: 0.05, max: 1, step: 0.01 },
      { key: "layout", label: "الوضع", type: "select", values: [["diagonal", "مائل"], ["center", "في المنتصف"], ["single", "عريض أعلى الصفحة"]] },
    ],
  },
  {
    id: "pdf:numbers", cat: "pdf", icon: "numbers", title: "ترقيم الصفحات",
    desc: "أضف أرقام الصفحات بصيغة تختارها.",
    accept: ".pdf", options: [
      { key: "format", label: "الصيغة", type: "text", value: "{n} / {total}", hint: "استخدم {n} لرقم الصفحة و{total} للإجمالي — يمكنك كتابة نص عربي" },
      { key: "position", label: "الموضع", type: "select", values: [["bottom-center", "أسفل الوسط"], ["bottom-right", "أسفل اليمين"], ["bottom-left", "أسفل اليسار"], ["top-center", "أعلى الوسط"], ["top-right", "أعلى اليمين"]] },
      { key: "fontSize", label: "حجم الخط", type: "number", value: 11, min: 6, max: 36 },
    ],
  },
  {
    id: "pdf:rotate", cat: "pdf", icon: "rotate", title: "تدوير PDF",
    desc: "دوّر كل الصفحات أو صفحات محددة.",
    accept: ".pdf", options: [
      { key: "angle", label: "زاوية الدوران", type: "select", values: [["90", "90° يمين"], ["180", "180°"], ["270", "90° يسار"]] },
      { key: "pages", label: "الصفحات (اتركه فارغاً للكل)", type: "text", placeholder: "1-3,7" },
    ],
  },
  {
    id: "pdf:organize", cat: "pdf", icon: "order", title: "ترتيب/حذف الصفحات",
    desc: "أعد ترتيب الصفحات أو احذف صفحات بكتابة التسلسل.",
    accept: ".pdf", options: [
      { key: "order", label: "ترتيب الصفحات", type: "text", value: "1", hint: "مثال: 3,1,2 لعرض الصفحة الثالثة أولاً — الصفحات غير المذكورة تُحذف" },
    ],
  },
  {
    id: "img:convert", cat: "image", icon: "image", title: "تحويل الصور",
    desc: "JPG ← PNG أو PNG ← JPG بجودة قابلة للضبط.",
    accept: "image/*", multiple: true, options: [
      { key: "target", label: "الصيغة الناتجة", type: "select", values: [["png", "PNG"], ["jpg", "JPG"]] },
      { key: "quality", label: "جودة JPG (0.5 – 1)", type: "number", value: 0.92, min: 0.5, max: 1, step: 0.01 },
    ],
  },
  {
    id: "csv:to-xlsx", cat: "office", icon: "excel", title: "CSV ← Excel",
    desc: "تحويل ملفات CSV إلى XLSX منظم.",
    accept: ".csv",
  },
  {
    id: "xlsx:to-csv", cat: "office", icon: "csv", title: "Excel ← CSV",
    desc: "تصدير أوراق Excel إلى نص CSV.",
    accept: ".xlsx,.xls",
  },
  {
    id: "docx:to-txt", cat: "office", icon: "text", title: "Word ← نص",
    desc: "استخراج النص من مستند DOCX.",
    accept: ".docx",
  },
  {
    id: "pptx:to-jpg", cat: "office", icon: "image", title: "PowerPoint ← JPG",
    desc: "تحويل الشرائح إلى صور JPG.",
    accept: ".pptx",
  },
];

const state = {
  tool: null,
  files: [],
  busy: false,
};

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

function humanSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { node.hidden = true; }, 3200);
}

/* ------------------------------ tool grid ------------------------------ */

function renderTools(filter = "all") {
  const grid = $("#tools-grid");
  grid.innerHTML = "";
  TOOLS.filter((tool) => filter === "all" || tool.cat === filter).forEach((tool) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "tool-card";
    card.innerHTML = `
      <span class="tool-ico">${ICONS[tool.icon] || ICONS.file}</span>
      <h3>${tool.title}</h3>
      <p>${tool.desc}</p>
      <span class="tool-tag">${tool.multiple ? "ملفات متعددة" : "ملف واحد"}</span>`;
    card.addEventListener("click", () => openWorkspace(tool));
    grid.appendChild(card);
  });
}

/* ----------------------------- workspace ------------------------------ */

function openWorkspace(tool) {
  state.tool = tool;
  state.files = [];
  $("#workspace").hidden = false;
  $("#ws-title").textContent = tool.title;
  $("#ws-desc").textContent = tool.desc;
  $("#ws-icon").innerHTML = ICONS[tool.icon] || ICONS.file;
  $("#ws-accept-hint").textContent = `الصيغ المقبولة: ${tool.accept}`;
  $("#ws-input").accept = tool.accept;
  $("#ws-input").multiple = Boolean(tool.multiple);
  $("#ws-input").value = "";
  $("#ws-error").hidden = true;
  $("#ws-result").hidden = true;
  $("#ws-result").innerHTML = "";
  $("#ws-progress").hidden = true;
  renderOptions(tool);
  renderFiles();
}

function closeWorkspace() {
  $("#workspace").hidden = true;
  state.files = [];
  state.tool = null;
}

function renderOptions(tool) {
  const box = $("#ws-options");
  box.innerHTML = "";
  (tool.options || []).forEach((option) => {
    const row = document.createElement("div");
    row.className = "opt-row";
    const label = document.createElement("label");
    label.textContent = option.label;
    label.htmlFor = `opt-${option.key}`;
    row.appendChild(label);
    let input;
    if (option.type === "select") {
      input = document.createElement("select");
      option.values.forEach(([value, text]) => {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = text;
        input.appendChild(opt);
      });
      if (option.value) input.value = option.value;
    } else {
      input = document.createElement("input");
      input.type = option.type === "number" ? "number" : "text";
      if (option.value !== undefined) input.value = option.value;
      if (option.placeholder) input.placeholder = option.placeholder;
      if (option.min !== undefined) input.min = option.min;
      if (option.max !== undefined) input.max = option.max;
      if (option.step !== undefined) input.step = option.step;
    }
    input.id = `opt-${option.key}`;
    input.dataset.key = option.key;
    input.dataset.kind = option.type;
    row.appendChild(input);
    if (option.hint) {
      const hint = document.createElement("span");
      hint.className = "opt-hint";
      hint.textContent = option.hint;
      row.appendChild(hint);
    }
    box.appendChild(row);
  });
}

function collectOptions() {
  const options = {};
  $$("#ws-options [data-key]").forEach((input) => {
    const key = input.dataset.key;
    const raw = input.value;
    if (raw === "") return;
    if (input.dataset.kind === "number") options[key] = Number(raw);
    else options[key] = raw;
  });
  return options;
}

function addFiles(fileList) {
  const tool = state.tool;
  if (!tool) return;
  const incoming = [...fileList];
  for (const file of incoming) {
    if (file.size > 22 * 1024 * 1024) {
      toast(`الملف ${file.name} أكبر من 22 ميجابايت`);
      continue;
    }
    state.files.push(file);
  }
  if (!tool.multiple && state.files.length > 1) state.files = [state.files[state.files.length - 1]];
  if (tool.id === "pdf:merge" && state.files.length > 12) state.files = state.files.slice(0, 12);
  renderFiles();
}

function renderFiles() {
  const list = $("#ws-files");
  list.innerHTML = "";
  state.files.forEach((file, index) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <span>${ICONS.file}</span>
      <span class="fname">${file.name}</span>
      <span class="fsize">${humanSize(file.size)}</span>
      <button type="button" title="إزالة" data-index="${index}">✕</button>`;
    li.querySelector("button").addEventListener("click", () => {
      state.files.splice(index, 1);
      renderFiles();
    });
    list.appendChild(li);
  });
}

/* -------------------------------- run --------------------------------- */

async function runTool() {
  const tool = state.tool;
  if (!tool || state.busy) return;
  const errorBox = $("#ws-error");
  errorBox.hidden = true;

  if (!state.files.length) {
    errorBox.textContent = "أضف ملفاً واحداً على الأقل أولاً.";
    errorBox.hidden = false;
    return;
  }
  if (tool.minFiles && state.files.length < tool.minFiles) {
    errorBox.textContent = `هذه الأداة تحتاج ${tool.minFiles} ملفات على الأقل.`;
    errorBox.hidden = false;
    return;
  }

  const options = collectOptions();
  if (tool.id === "pdf:split" && options.mode === "ranges" && !options.ranges) {
    errorBox.textContent = "اكتب نطاق الصفحات، مثال: 1-3,5";
    errorBox.hidden = false;
    return;
  }
  if (tool.id === "pdf:organize" && !options.order) {
    errorBox.textContent = "اكتب ترتيب الصفحات، مثال: 2,1,3";
    errorBox.hidden = false;
    return;
  }

  state.busy = true;
  const runBtn = $("#ws-run");
  runBtn.disabled = true;
  runBtn.textContent = "جارٍ التنفيذ…";
  $("#ws-progress").hidden = false;
  $("#ws-bar").style.width = "12%";
  $("#ws-result").hidden = true;

  const started = performance.now();
  try {
    const form = new FormData();
    form.append("op", tool.id);
    form.append("options", JSON.stringify(options));
    state.files.forEach((file) => form.append("file", file, file.name));

    const response = await fetch("/api/convert", { method: "POST", body: form });
    $("#ws-bar").style.width = "70%";

    if (!response.ok && response.headers.get("content-type")?.includes("application/json")) {
      const payload = await response.json();
      throw new Error(payload.error || `فشل الطلب (${response.status})`);
    }
    if (!response.ok) throw new Error(`فشل الطلب (${response.status})`);

    const blob = await response.blob();
    const name = decodeURIComponent(response.headers.get("x-output-name") || "output");
    const infoHeader = response.headers.get("x-result-info");
    const info = infoHeader ? JSON.parse(decodeURIComponent(infoHeader)) : {};
    $("#ws-bar").style.width = "100%";
    showResult({ blob, name, info, ms: Math.round(performance.now() - started) });
  } catch (error) {
    errorBox.textContent = error.message || "حدث خطأ غير متوقع";
    errorBox.hidden = false;
    $("#ws-progress").hidden = true;
  } finally {
    state.busy = false;
    runBtn.disabled = false;
    runBtn.textContent = "تشغيل الأداة";
  }
}

function showResult({ blob, name, info, ms }) {
  const box = $("#ws-result");
  box.innerHTML = "";
  box.hidden = false;

  const ext = name.split(".").pop().toLowerCase();
  const title = document.createElement("h4");
  title.textContent = "تم إنشاء الملف بنجاح ✅";
  box.appendChild(title);

  const meta = document.createElement("p");
  meta.className = "meta";
  const bits = [`الحجم: ${humanSize(blob.size)}`, `الزمن: ${ms} مللي ثانية`];
  if (info.pages) bits.push(`الصفحات: ${info.pages}`);
  if (info.slides) bits.push(`الشرائح: ${info.slides}`);
  if (info.savedPercent !== undefined && info.savedPercent > 0) {
    bits.push(`تم توفير ${info.savedPercent}% (${humanSize(info.before)} ← ${humanSize(info.after)})`);
  }
  meta.textContent = bits.join(" · ");
  box.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "result-actions";

  const url = URL.createObjectURL(blob);
  const download = document.createElement("a");
  download.href = url;
  download.download = name;
  download.className = "primary-btn small";
  download.textContent = `تحميل ${name}`;
  actions.appendChild(download);

  const open = document.createElement("a");
  open.href = url;
  open.target = "_blank";
  open.rel = "noopener";
  open.className = "ghost-btn";
  open.textContent = "فتح في تبويب جديد";
  actions.appendChild(open);

  box.appendChild(actions);

  if (ext === "pdf") {
    const frame = document.createElement("iframe");
    frame.className = "preview-frame";
    frame.src = url;
    frame.title = "معاينة الناتج";
    box.appendChild(frame);
  } else if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) {
    const img = document.createElement("img");
    img.className = "preview-img";
    img.src = url;
    img.alt = "معاينة الناتج";
    box.appendChild(img);
  } else {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = "هذه الصيغة تُحمَّل مباشرة (لا يمكن معاينتها داخل الصفحة).";
    box.appendChild(note);
  }
}

/* ------------------------------ self test ----------------------------- */

async function loadStatus() {
  const summary = $("#status-summary");
  const grid = $("#status-grid");
  try {
    const response = await fetch("/api/health");
    const data = await response.json();
    summary.textContent = `الخادم يعمل — ${data.count} أداة متاحة على ${location.host}`;
    grid.innerHTML = "";
    const labels = Object.fromEntries(TOOLS.map((tool) => [tool.id, tool.title]));
    (data.ops || []).forEach((op) => {
      const item = document.createElement("div");
      item.className = "status-item";
      item.innerHTML = `<span class="dot live"></span> ${labels[op] || op}`;
      grid.appendChild(item);
    });
  } catch {
    summary.textContent = "تعذر الوصول إلى واجهة البرمجة (API).";
    grid.innerHTML = "";
  }
}

async function selfTest() {
  const button = $("#self-test-btn");
  button.disabled = true;
  const original = button.innerHTML;
  button.innerHTML = `<span class="dot"></span> جارٍ الفحص…`;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 700;
    canvas.height = 320;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#14162b";
    ctx.font = "bold 46px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("اختبار الأداة Eltaranisi 2026", canvas.width / 2, 120);
    ctx.font = "28px sans-serif";
    ctx.fillStyle = "#667085";
    ctx.fillText("فحص شامل: صور ← PDF ← تقسيم ← دمج", canvas.width / 2, 190);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));

    const form = new FormData();
    form.append("op", "img:to-pdf");
    form.append("options", "{}");
    form.append("file", blob, "self-test.png");
    const pdfResponse = await fetch("/api/convert", { method: "POST", body: form });
    if (!pdfResponse.ok) throw new Error("فشل تحويل الصورة إلى PDF");
    const pdfBlob = await pdfResponse.blob();
    const head = await pdfBlob.slice(0, 4).text();
    if (head !== "%PDF") throw new Error("الناتج ليس ملف PDF صالح");

    const splitForm = new FormData();
    splitForm.append("op", "pdf:split");
    splitForm.append("options", JSON.stringify({ mode: "each" }));
    splitForm.append("file", pdfBlob, "self-test.pdf");
    const splitResponse = await fetch("/api/convert", { method: "POST", body: splitForm });
    if (!splitResponse.ok) throw new Error("فشل تقسيم الملف الناتج");

    const jpgForm = new FormData();
    jpgForm.append("op", "pdf:to-jpg");
    jpgForm.append("options", JSON.stringify({ dpi: 100 }));
    jpgForm.append("file", pdfBlob, "self-test.pdf");
    const jpgResponse = await fetch("/api/convert", { method: "POST", body: jpgForm });
    if (!jpgResponse.ok) throw new Error("فشل تحويل PDF إلى صورة");
    const imageBytes = new Uint8Array(await (await jpgResponse.blob()).slice(0, 2).arrayBuffer());
    if (!(imageBytes[0] === 0xff && imageBytes[1] === 0xd8)) throw new Error("صورة الناتج غير صالحة");

    const mergeForm = new FormData();
    mergeForm.append("op", "pdf:merge");
    mergeForm.append("options", "{}");
    mergeForm.append("file", pdfBlob, "a.pdf");
    mergeForm.append("file", pdfBlob, "b.pdf");
    const mergeResponse = await fetch("/api/convert", { method: "POST", body: mergeForm });
    if (!mergeResponse.ok) throw new Error("فشل دمج الملفين");

    toast("✅ الفحص نجح: صور ← PDF ← تقسيم ← JPG ← دمج");
  } catch (error) {
    toast(`❌ فحص الأدوات: ${error.message}`);
  } finally {
    button.disabled = false;
    button.innerHTML = original;
    loadStatus();
  }
}

/* -------------------------------- wiring ------------------------------ */

function wire() {
  renderTools();

  $("#tool-filter").addEventListener("change", (event) => renderTools(event.target.value));
  $("#hero-upload-btn").addEventListener("click", () => {
    $("#quick-input").click();
  });

  const quickDrop = $("#quick-drop");
  quickDrop.addEventListener("click", () => $("#quick-input").click());
  quickDrop.addEventListener("dragover", (event) => { event.preventDefault(); quickDrop.classList.add("dragging"); });
  quickDrop.addEventListener("dragleave", () => quickDrop.classList.remove("dragging"));
  quickDrop.addEventListener("drop", (event) => {
    event.preventDefault();
    quickDrop.classList.remove("dragging");
    handleQuick([...event.dataTransfer.files]);
  });
  $("#quick-input").addEventListener("change", (event) => handleQuick([...event.target.files]));

  function handleQuick(files) {
    if (!files.length) return;
    const ext = files[0].name.split(".").pop().toLowerCase();
    let tool;
    if (files.length > 1 && files.every((f) => f.name.toLowerCase().endsWith(".pdf"))) {
      tool = TOOLS.find((t) => t.id === "pdf:merge");
    } else if (ext === "pdf") {
      tool = TOOLS.find((t) => t.id === "pdf:to-docx");
    } else if (["jpg", "jpeg", "png", "webp", "gif", "bmp", "svg"].includes(ext)) {
      tool = TOOLS.find((t) => t.id === "img:to-pdf");
    } else {
      tool = TOOLS.find((t) => t.id === "to-pdf");
    }
    openWorkspace(tool);
    state.files = [];
    addFiles(files);
  }

  $$("#quick-routes .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const tool = TOOLS.find((t) => t.id === chip.dataset.route);
      if (tool) openWorkspace(tool);
    });
  });

  $("#ws-close").addEventListener("click", closeWorkspace);
  $("#workspace").addEventListener("click", (event) => {
    if (event.target.id === "workspace") closeWorkspace();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#workspace").hidden) closeWorkspace();
  });

  const wsDrop = $("#ws-drop");
  wsDrop.addEventListener("click", () => $("#ws-input").click());
  wsDrop.addEventListener("dragover", (event) => { event.preventDefault(); wsDrop.classList.add("dragging"); });
  wsDrop.addEventListener("dragleave", () => wsDrop.classList.remove("dragging"));
  wsDrop.addEventListener("drop", (event) => {
    event.preventDefault();
    wsDrop.classList.remove("dragging");
    addFiles(event.dataTransfer.files);
  });
  $("#ws-input").addEventListener("change", (event) => addFiles(event.target.files));
  $("#ws-run").addEventListener("click", runTool);
  $("#ws-reset").addEventListener("click", () => {
    state.files = [];
    renderFiles();
    $("#ws-result").hidden = true;
    $("#ws-error").hidden = true;
    $("#ws-progress").hidden = true;
  });

  $("#self-test-btn").addEventListener("click", selfTest);
  $("#refresh-status").addEventListener("click", loadStatus);

  loadStatus();
}

wire();

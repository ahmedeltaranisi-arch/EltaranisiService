(() => {
  "use strict";

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const root = document.documentElement;
  const currentYear = $("#current-year");
  const languageToggle = $("#language-toggle");
  const themeToggle = $("#theme-toggle");
  const fileInput = $("#file-input");
  const dropZone = $("#drop-zone");
  const uploadSection = $("#upload");
  const uploadResults = $("#upload-results");
  const toolDialog = $("#tool-dialog");
  const commandDialog = $("#command-dialog");
  const toast = $("#toast");
  let language = safeGet("eltaranisi-language") || "ar";
  let toastTimer;
  const selectedFiles = [];
  const localUrls = new WeakMap();
  let renderRevision = 0;

  const copy = {
    ar: {
      chooseFile: "اختيار ملف للمعاينة",
      clear: "إزالة الكل",
      selected: "الملفات المختارة",
      localPreview: "معاينة محلية",
      noPreview: "تم التعرف على الاسم والنوع والحجم محليًا فقط. محتوى هذا النوع لا يُعرض في المعاينة.",
      textPreview: "مقتطف نصي محلي — للعرض فقط",
      imagePreview: "معاينة الصورة على جهازك",
      suggestions: "اقتراحات حسب نوع الملف — ليست مدعومة بمحرك معالجة بعد:",
      fileType: "النوع",
      fileSize: "الحجم",
      unknown: "غير معروف",
      download: "تنزيل النسخة الأصلية",
      remove: "إزالة الملف",
      multi: "اختير {n} ملفات. تتم معاينتها محليًا فقط ولا تُرسل إلى أي خادم.",
      tooMany: "يمكن معاينة 10 ملفات كحد أقصى في كل مرة.",
      toolNotice: "هذه نافذة معاينة للواجهة. محرك المعالجة أو خدمة الذكاء الاصطناعي غير متصلين؛ لن يتم تنفيذ العملية ولن يتم إرسال ملفك.",
      noFile: "لم يتم اختيار ملف بعد. يمكنك اختيار ملف لعرض اسمه ونوعه محليًا.",
      selectToTry: "اختر ملفًا للمعاينة",
      toastThemeDark: "تم تفعيل المظهر الداكن",
      toastThemeLight: "تم تفعيل المظهر الفاتح",
      toastLanguage: "تم تغيير لغة الواجهة",
      toastLocalOnly: "هذه الخطوة توضيحية فقط — الملف لم يُرفع ولم تتم معالجته.",
      toastRemoved: "تمت إزالة الملفات من المعاينة المحلية.",
      uploadWarning: "تعذر قراءة هذا الملف محليًا، لكن لم يتم رفعه.",
      typeSuggestions: {
        pdf: ["استخراج النص", "تلخيص المستند", "أدوات PDF"],
        office: ["تحويل الصيغة", "استخراج المحتوى", "مساعد المستندات"],
        image: ["استخراج النص", "صورة إلى PDF", "الماسح الذكي"],
        sheet: ["استخراج الجداول", "تحويل الصيغة", "مساعد المستندات"],
        text: ["مساعد المستندات", "تحويل الصيغة", "استخراج النص"],
        other: ["مساعد المستندات", "استكشف الأدوات"]
      },
      tools: {
        convert: { title: "تحويل الملفات", description: "واجهة لاختيار صيغة الإدخال والإخراج ومراجعة الخيارات قبل التحويل.", note: "التحويل الفعلي غير متصل في هذه المعاينة. لا يتم إنشاء ملف ناتج." },
        ocr: { title: "استخراج النص OCR", description: "تصوّر لمسار استخراج النصوص من المستندات والصور، مع دعم واجهة عربية وإنجليزية.", note: "لم يتم توصيل محرك OCR بعد؛ لن يُقرأ محتوى ملفك أو يُنشأ نص مستخرج." },
        assistant: { title: "مساعد المستندات", description: "واجهة مقترحة لطرح الأسئلة وتنظيم الإجابات حول مستنداتك.", note: "خدمة الذكاء الاصطناعي غير متصلة. لن نولّد إجابات أو ملخصات مزيفة في هذا العرض." },
        pdf: { title: "أدوات PDF", description: "مساحة تجمع تصوّر أدوات الدمج والتقسيم والضغط والتحويل.", note: "عمليات PDF غير مفعّلة حتى يتم ربط محرك معالجة آمن." },
        scanner: { title: "الماسح الذكي", description: "مسار تصميمي لالتقاط صور المستندات وتحسينها وتجهيزها للمراجعة.", note: "لا يتم فتح الكاميرا أو تطبيق قصّ/تحسين في هذه المعاينة." },
        batch: { title: "معالجة الدُفعات", description: "تصوّر لطريقة تجميع عدة ملفات في قائمة واحدة ومتابعة حالتها.", note: "لا توجد طوابير أو مهام خلفية متصلة؛ الملفات تبقى في متصفحك." },
        free: { title: "الخطة المجانية", description: "تصوّر مبدئي لمساحة شخصية بأدوات أساسية.", note: "الحسابات والاشتراكات غير متصلة. لا يوجد تسجيل أو دفع في هذه المعاينة." },
        pro: { title: "خطة Pro", description: "تصوّر مبدئي لمساحة احترافية بميزات مستندات أوسع.", note: "تفاصيل الأسعار والمزايا النهائية قيد الإعداد؛ لا يوجد اشتراك فعلي." },
        business: { title: "خطة Business", description: "تصوّر مبدئي لمساحة مشتركة للفرق وإدارة المستندات.", note: "مساحات الفرق وواجهات API والصلاحيات غير مفعّلة في هذه المعاينة." }
      }
    },
    en: {
      chooseFile: "Choose a file to preview",
      clear: "Remove all",
      selected: "Selected files",
      localPreview: "Local preview",
      noPreview: "Filename, type, and size were detected locally only. This file type's contents are not rendered in the preview.",
      textPreview: "Local text excerpt — for display only",
      imagePreview: "Image preview on your device",
      suggestions: "Suggestions by file type — not connected to a processing engine:",
      fileType: "Type",
      fileSize: "Size",
      unknown: "Unknown",
      download: "Download original",
      remove: "Remove file",
      multi: "{n} files selected. They are previewed locally only and are not sent to a server.",
      tooMany: "You can preview up to 10 files at a time.",
      toolNotice: "This is an interface preview. Processing and AI services are not connected; nothing will run and your file will not be sent.",
      noFile: "No file selected yet. Choose one to show its name and type locally.",
      selectToTry: "Choose a file to preview",
      toastThemeDark: "Dark mode is on",
      toastThemeLight: "Light mode is on",
      toastLanguage: "Interface language changed",
      toastLocalOnly: "This step is illustrative only — the file was not uploaded or processed.",
      toastRemoved: "Files were removed from the local preview.",
      uploadWarning: "This file could not be read locally, but it was not uploaded.",
      typeSuggestions: {
        pdf: ["Extract text", "Summarize document", "PDF tools"],
        office: ["Convert format", "Extract content", "Document assistant"],
        image: ["Extract text", "Image to PDF", "Smart scanner"],
        sheet: ["Extract tables", "Convert format", "Document assistant"],
        text: ["Document assistant", "Convert format", "Extract text"],
        other: ["Document assistant", "Explore tools"]
      },
      tools: {
        convert: { title: "File converter", description: "An interface for selecting input and output formats and reviewing options before conversion.", note: "Actual conversion is not connected in this preview. No output file is created." },
        ocr: { title: "OCR text extraction", description: "A preview of a flow for extracting text from documents and images, with Arabic and English UI support.", note: "An OCR engine is not connected yet; your file is not read and no extracted text is created." },
        assistant: { title: "Document assistant", description: "A proposed interface for asking questions and organizing answers about your documents.", note: "The AI service is not connected. This preview will not generate fabricated answers or summaries." },
        pdf: { title: "PDF tools", description: "A workspace concept for merge, split, compress, and convert actions.", note: "PDF operations are not enabled until a secure processing engine is connected." },
        scanner: { title: "Smart scanner", description: "A design flow for capturing document photos, enhancing them, and preparing them for review.", note: "This preview does not open the camera or apply crop/enhancement." },
        batch: { title: "Batch processing", description: "A concept for collecting several files in one queue and tracking their status.", note: "No background jobs or queues are connected; files remain in your browser." },
        free: { title: "Free plan", description: "An initial concept for a personal workspace with essential tools.", note: "Accounts and subscriptions are not connected. There is no sign-in or checkout in this preview." },
        pro: { title: "Pro plan", description: "An initial concept for a professional workspace with broader document features.", note: "Final pricing and plan details are still being prepared; there is no active subscription." },
        business: { title: "Business plan", description: "An initial concept for shared team workspaces and document administration.", note: "Team spaces, API access, and roles are not enabled in this preview." }
      }
    }
  };

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* Private browsing can disable storage. */ }
  }
  function currentCopy() { return copy[language] || copy.ar; }

  function applyLanguage(nextLanguage) {
    language = nextLanguage === "en" ? "en" : "ar";
    root.lang = language;
    root.dir = language === "ar" ? "rtl" : "ltr";
    safeSet("eltaranisi-language", language);
    $$('[data-ar][data-en]').forEach((element) => {
      // Translate only leaf nodes. Parent controls can contain icons or other UI that must be preserved.
      if (element.children.length === 0) element.textContent = element.dataset[language];
    });
    $$('[data-placeholder-ar][data-placeholder-en]').forEach((element) => {
      element.placeholder = element.dataset[`placeholder${language === "ar" ? "Ar" : "En"}`];
    });
    const langLabel = language === "ar" ? "EN" : "عربي";
    languageToggle.textContent = langLabel;
    languageToggle.setAttribute("aria-label", language === "ar" ? "Switch language to English" : "تغيير اللغة إلى العربية");
    $("#theme-toggle").setAttribute("aria-label", language === "ar" ? "تغيير المظهر" : "Toggle theme");
    $("#menu-toggle").setAttribute("aria-label", language === "ar" ? "فتح القائمة" : "Open navigation menu");
    dropZone.setAttribute("aria-label", language === "ar" ? "اختيار ملف للمعاينة" : "Choose a file to preview");
    document.title = language === "ar" ? "Eltaranisi Service+ — حوّل مستنداتك لأي شيء" : "Eltaranisi Service+ — Turn your documents into anything";
    const metaDescription = $('meta[name="description"]');
    if (metaDescription) metaDescription.content = language === "ar"
      ? "Eltaranisi Service+ — مساحة عمل ذكية لمسح المستندات وتحويلها وفهمها."
      : "Eltaranisi Service+ — an intelligent workspace to scan, convert, and understand documents.";
    if (selectedFiles.length) renderFiles();
  }

  function applyTheme(theme, announce = false) {
    const nextTheme = theme === "dark" ? "dark" : "light";
    root.dataset.theme = nextTheme;
    safeSet("eltaranisi-theme", nextTheme);
    if (announce) showToast(currentCopy()[nextTheme === "dark" ? "toastThemeDark" : "toastThemeLight"]);
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2900);
  }

  function openUpload() {
    uploadSection.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => fileInput.click(), 240);
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
  }

  function getExtension(file) {
    const name = String(file.name || "");
    const dot = name.lastIndexOf(".");
    return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  }

  function getCategory(file) {
    const ext = getExtension(file);
    if (ext === "pdf") return "pdf";
    if (["doc", "docx", "ppt", "pptx"].includes(ext)) return "office";
    if (["xls", "xlsx", "csv"].includes(ext)) return "sheet";
    if (["jpg", "jpeg", "png", "webp", "svg", "tif", "tiff", "bmp"].includes(ext) || (file.type || "").startsWith("image/")) return "image";
    if (["txt", "md", "html"].includes(ext) || (file.type || "").startsWith("text/")) return "text";
    return "other";
  }

  function getExtensionLabel(file) {
    const ext = getExtension(file);
    return ext ? ext.toUpperCase().slice(0, 6) : (file.type ? file.type.split("/").pop().toUpperCase().slice(0, 6) : "FILE");
  }

  function humanSize(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function getLocalUrl(file) {
    if (!localUrls.has(file)) localUrls.set(file, URL.createObjectURL(file));
    return localUrls.get(file);
  }

  function addFiles(fileList) {
    const incoming = [...fileList].filter((file) => file instanceof File);
    if (!incoming.length) return;
    let added = 0;
    for (const file of incoming) {
      const duplicate = selectedFiles.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified);
      if (!duplicate && selectedFiles.length < 10) {
        selectedFiles.push(file);
        getLocalUrl(file);
        added++;
      }
    }
    if (selectedFiles.length >= 10 && incoming.length > added) showToast(currentCopy().tooMany);
    if (added === 0 && selectedFiles.length === 0) return;
    renderFiles();
    if (added) uploadResults.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function createFileRows() {
    const t = currentCopy();
    return selectedFiles.map((file, index) => {
      const url = getLocalUrl(file);
      return `<div class="file-row" data-file-index="${index}">
        <span class="file-type-tile" aria-hidden="true">${escapeHTML(getExtensionLabel(file))}</span>
        <div class="file-meta"><strong title="${escapeHTML(file.name)}">${escapeHTML(file.name)}</strong><span>${escapeHTML(t.fileType)}: ${escapeHTML(file.type || t.unknown)} &nbsp;·&nbsp; ${escapeHTML(humanSize(file.size))}</span></div>
        <div class="file-row-actions">
          <a href="${url}" download="${escapeHTML(file.name)}" aria-label="${escapeHTML(t.download)}" title="${escapeHTML(t.download)}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v9m0 0 3-3m-3 3L7 9m-3 5v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2"/></svg></a>
          <button type="button" data-remove-file="${index}" aria-label="${escapeHTML(t.remove)}" title="${escapeHTML(t.remove)}">×</button>
        </div>
      </div>`;
    }).join("");
  }

  async function createLocalPreview() {
    if (!selectedFiles.length) return "";
    const file = selectedFiles[0];
    const category = getCategory(file);
    const t = currentCopy();
    let media = "";
    if (category === "image" && (file.type || "").startsWith("image/")) {
      media = `<img class="local-preview-image" src="${getLocalUrl(file)}" alt="${escapeHTML(t.imagePreview)}">`;
    } else if (category === "text" && file.size <= 3 * 1024 * 1024) {
      try {
        const excerpt = await file.slice(0, 5000).text();
        media = `<code>${escapeHTML(excerpt || (language === "ar" ? "الملف النصي فارغ." : "The text file is empty."))}</code>`;
      } catch {
        media = `<p>${escapeHTML(t.uploadWarning)}</p>`;
      }
    }
    const previewTitle = category === "image" && (file.type || "").startsWith("image/") ? t.imagePreview : (category === "text" ? t.textPreview : t.localPreview);
    const previewBody = media || `<p>${escapeHTML(t.noPreview)}</p>`;
    const suggestions = t.typeSuggestions[category] || t.typeSuggestions.other;
    const mapTool = (label) => {
      const lower = label.toLowerCase();
      if (lower.includes("ocr") || lower.includes("text") || lower.includes("استخراج")) return "ocr";
      if (lower.includes("pdf") || lower.includes("جدول") || lower.includes("table")) return "pdf";
      if (lower.includes("scan") || lower.includes("ماسح") || lower.includes("صورة")) return "scanner";
      if (lower.includes("assistant") || lower.includes("مساعد") || lower.includes("summarize") || lower.includes("تلخيص")) return "assistant";
      return "convert";
    };
    return `<div class="local-preview-box">
      <div class="local-preview-copy"><strong>${escapeHTML(previewTitle)}</strong>${previewBody}</div>
      ${media.startsWith("<img") ? "" : `<div class="local-preview-copy"><strong>${escapeHTML(language === "ar" ? "ماذا يمكنك أن تفعل؟" : "What can you do next?")}</strong><p>${escapeHTML(t.noPreview)}</p></div>`}
    </div>
    <div class="suggestion-row"><span>${escapeHTML(t.suggestions)}</span>${suggestions.map((label) => `<button type="button" class="suggestion-chip" data-suggest-tool="${mapTool(label)}">${escapeHTML(label)}</button>`).join("")}</div>
    ${selectedFiles.length > 1 ? `<div class="multiple-files-note">${escapeHTML(t.multi.replace("{n}", String(selectedFiles.length)))}</div>` : ""}`;
  }

  async function renderFiles() {
    const thisRender = ++renderRevision;
    if (!selectedFiles.length) {
      uploadResults.hidden = true;
      uploadResults.innerHTML = "";
      return;
    }
    uploadResults.hidden = false;
    const t = currentCopy();
    const rows = createFileRows();
    const count = selectedFiles.length;
    const preview = await createLocalPreview();
    // Ignore an older async text read if the selected list or language changed while reading.
    if (thisRender !== renderRevision || !selectedFiles.length) return;
    uploadResults.innerHTML = `<div class="results-header"><div class="results-heading"><i>✓</i><span>${escapeHTML(t.selected)} (${count})</span></div><button class="clear-files" id="clear-files" type="button">${escapeHTML(t.clear)}</button></div><div class="file-list">${rows}</div>${preview}`;
  }

  function removeFile(index) {
    const file = selectedFiles[index];
    if (file && localUrls.has(file)) {
      URL.revokeObjectURL(localUrls.get(file));
      localUrls.delete(file);
    }
    selectedFiles.splice(index, 1);
    fileInput.value = "";
    if (!selectedFiles.length) showToast(currentCopy().toastRemoved);
    renderFiles();
  }

  const toolDialogTitle = $("#tool-dialog-title");
  const toolDialogDescription = $("#tool-dialog-description");
  const toolDialogNote = $("#tool-dialog-note");
  const toolDialogFile = $("#tool-dialog-file");

  function openToolDialog(toolKey) {
    const tool = currentCopy().tools[toolKey] || currentCopy().tools.convert;
    toolDialogTitle.textContent = tool.title;
    toolDialogDescription.textContent = tool.description;
    toolDialogNote.textContent = tool.note;
    const selected = selectedFiles[0];
    if (selected) {
      toolDialogFile.hidden = false;
      toolDialogFile.innerHTML = `<span class="file-type-tile">${escapeHTML(getExtensionLabel(selected))}</span><span>${escapeHTML(selected.name)} · ${escapeHTML(humanSize(selected.size))}</span>`;
    } else {
      toolDialogFile.hidden = false;
      toolDialogFile.textContent = currentCopy().noFile;
    }
    if (typeof toolDialog.showModal === "function") toolDialog.showModal();
    else toolDialog.setAttribute("open", "");
  }

  function closeDialog(dialog) {
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else dialog.removeAttribute("open");
  }

  function openCommandDialog() {
    const search = $("#command-search");
    search.value = "";
    $$("[data-command]", commandDialog).forEach((button) => { button.hidden = false; });
    if (typeof commandDialog.showModal === "function") commandDialog.showModal();
    else commandDialog.setAttribute("open", "");
    window.setTimeout(() => search.focus(), 25);
  }

  // Language and theme controls.
  languageToggle.addEventListener("click", () => {
    applyLanguage(language === "ar" ? "en" : "ar");
    showToast(currentCopy().toastLanguage);
  });
  applyLanguage(language);
  applyTheme(safeGet("eltaranisi-theme") || "light");
  themeToggle.addEventListener("click", () => applyTheme(root.dataset.theme === "dark" ? "light" : "dark", true));
  if (currentYear) currentYear.textContent = String(new Date().getFullYear());

  // Header elevation after scrolling.
  const siteHeader = $("#site-header");
  const updateHeader = () => siteHeader.classList.toggle("is-scrolled", window.scrollY > 8);
  window.addEventListener("scroll", updateHeader, { passive: true });
  updateHeader();

  // Mobile navigation.
  const menuToggle = $("#menu-toggle");
  const mobileNav = $("#mobile-nav");
  menuToggle.addEventListener("click", () => {
    const isOpen = !mobileNav.hidden;
    mobileNav.hidden = isOpen;
    menuToggle.setAttribute("aria-expanded", String(!isOpen));
    menuToggle.setAttribute("aria-label", language === "ar" ? (isOpen ? "فتح القائمة" : "إغلاق القائمة") : (isOpen ? "Open navigation menu" : "Close navigation menu"));
  });
  $$("#mobile-nav a").forEach((link) => link.addEventListener("click", () => {
    mobileNav.hidden = true;
    menuToggle.setAttribute("aria-expanded", "false");
  }));

  // Local-only file picker and drop handling. No file content is transmitted.
  ["#hero-upload", "#final-upload", "#dialog-upload"].forEach((selector) => {
    $(selector).addEventListener("click", () => {
      if (selector === "#dialog-upload") closeDialog(toolDialog);
      openUpload();
    });
  });
  $("#choose-file").addEventListener("click", (event) => {
    event.stopPropagation();
    fileInput.click();
  });
  dropZone.addEventListener("click", (event) => {
    if (!event.target.closest("button")) fileInput.click();
  });
  dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener("change", () => {
    addFiles(fileInput.files || []);
    fileInput.value = "";
  });
  ["dragenter", "dragover"].forEach((name) => dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    dropZone.classList.add("is-dragging");
  }));
  ["dragleave", "drop"].forEach((name) => dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragging");
  }));
  dropZone.addEventListener("drop", (event) => addFiles(event.dataTransfer?.files || []));
  document.addEventListener("paste", (event) => {
    const pastedFiles = [...(event.clipboardData?.items || [])].filter((item) => item.kind === "file").map((item) => item.getAsFile()).filter(Boolean);
    if (pastedFiles.length) addFiles(pastedFiles);
  });
  uploadResults.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-file]");
    if (removeButton) {
      removeFile(Number(removeButton.dataset.removeFile));
      return;
    }
    const clearButton = event.target.closest("#clear-files");
    if (clearButton) {
      selectedFiles.forEach((file) => { if (localUrls.has(file)) URL.revokeObjectURL(localUrls.get(file)); });
      selectedFiles.splice(0, selectedFiles.length);
      fileInput.value = "";
      renderFiles();
      showToast(currentCopy().toastRemoved);
      return;
    }
    const suggestion = event.target.closest("[data-suggest-tool]");
    if (suggestion) openToolDialog(suggestion.dataset.suggestTool);
  });

  // Tool cards and plan cards open honest, explanatory preview panels.
  $$('[data-tool]').forEach((button) => button.addEventListener("click", () => openToolDialog(button.dataset.tool)));
  $$('[data-plan]').forEach((button) => button.addEventListener("click", () => openToolDialog(button.dataset.plan)));
  $$('[data-demo-action="assistant"]').forEach((button) => button.addEventListener("click", () => openToolDialog("assistant")));
  $$('[data-close-dialog]').forEach((button) => button.addEventListener("click", () => closeDialog(toolDialog)));
  toolDialog.addEventListener("click", (event) => { if (event.target === toolDialog) closeDialog(toolDialog); });
  commandDialog.addEventListener("click", (event) => { if (event.target === commandDialog) closeDialog(commandDialog); });

  // Command center: Ctrl/Cmd+K.
  $("#command-open").addEventListener("click", openCommandDialog);
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openCommandDialog();
    }
  });
  const commandSearch = $("#command-search");
  commandSearch.addEventListener("input", () => {
    const query = commandSearch.value.trim().toLocaleLowerCase(language);
    $$("[data-command]", commandDialog).forEach((button) => {
      button.hidden = query !== "" && !button.textContent.toLocaleLowerCase(language).includes(query);
    });
  });
  commandSearch.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      const firstVisible = $("[data-command]:not([hidden])", commandDialog);
      if (firstVisible) firstVisible.click();
    }
  });
  $$("[data-command]", commandDialog).forEach((button) => button.addEventListener("click", () => {
    const command = button.dataset.command;
    closeDialog(commandDialog);
    if (command === "upload") openUpload();
    if (command === "tools") $("#tools").scrollIntoView({ behavior: "smooth" });
    if (command === "assistant") openToolDialog("assistant");
    if (command === "theme") applyTheme(root.dataset.theme === "dark" ? "light" : "dark", true);
  }));

  // Dismiss mobile navigation with Escape when it is open.
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !mobileNav.hidden) {
      mobileNav.hidden = true;
      menuToggle.setAttribute("aria-expanded", "false");
    }
  });
})();

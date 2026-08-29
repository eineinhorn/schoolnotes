// Schulnotizen — Ordner > Notizbücher > Seiten, mit mehreren Stift-Typen.
// Alles läuft lokal im Browser (localStorage), kein Server nötig.

(function () {
  'use strict';

  const STORAGE_KEY = 'schulnotizen.v2';

  // ---------- Stift-Voreinstellungen ----------
  // width = Standardbreite in "logischen" CSS-Pixeln (unabhängig von Retina/dpr).
  const TOOL_DEFAULTS = {
    fountain:  { label: 'Füller',         opacity: 1,    composite: 'source-over', color: '#1c2b4a', width: 2.6, min: 1,  max: 7,  variableWidth: true  },
    ballpoint: { label: 'Kugelschreiber', opacity: 1,    composite: 'source-over', color: '#111111', width: 1.6, min: 1,  max: 4,  variableWidth: false },
    pencil:    { label: 'Bleistift',      opacity: 0.55, composite: 'source-over', color: '#555555', width: 2.2, min: 1,  max: 6,  variableWidth: false, textured: true },
    marker:    { label: 'Marker',         opacity: 0.38, composite: 'multiply',    color: '#ffd93b', width: 14,  min: 6,  max: 30, variableWidth: false },
    eraser:    { label: 'Radiergummi',    opacity: 1,    composite: 'destination-out', color: '#000000', width: 26, min: 10, max: 60, variableWidth: false }
  };
  const QUICK_COLORS = ['#1c2b4a', '#111111', '#c62828', '#e2711d', '#f4c430', '#2e7d32', '#1565c0', '#6a3fa0'];

  // ---------- Kleine Helfer ----------
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function hash01(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    h = (h ^ (h >>> 15)) >>> 0;
    return h / 4294967295;
  }

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* Speicher kaputt -> neu anfangen */ }
    return { folders: [], notebooks: [], pages: {}, ui: { activeNotebookId: null, activePageId: null, collapsedFolders: [], pencilOnly: true } };
  }

  let saveTimer = null;
  function saveData() {
    setStatus('speichere…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        setStatus('gespeichert ✓');
      } catch (e) {
        setStatus('Speichern fehlgeschlagen (Speicher voll?)');
      }
    }, 200);
  }

  function newPage() { return { strokes: [], background: null, thumb: null }; }

  function newNotebook(name, folderId) {
    const pageId = uid();
    data.pages[pageId] = newPage();
    const nb = { id: uid(), name: name || 'Neues Notizbuch', folderId: folderId || null, pageIds: [pageId], background: 'lined' };
    data.notebooks.push(nb);
    return nb;
  }

  function ensureDefaultData() {
    if (data.ui.pencilOnly === undefined) data.ui.pencilOnly = true;
    if (!data.notebooks.length) {
      const nb = newNotebook('Erstes Notizbuch', null);
      data.ui.activeNotebookId = nb.id;
      data.ui.activePageId = nb.pageIds[0];
      saveData();
    }
    if (!data.ui.activeNotebookId || !findNotebook(data.ui.activeNotebookId)) {
      data.ui.activeNotebookId = data.notebooks[0].id;
      data.ui.activePageId = data.notebooks[0].pageIds[0];
    }
  }

  function findNotebook(id) { return data.notebooks.find(n => n.id === id); }
  function findFolder(id) { return data.folders.find(f => f.id === id); }

  // ---------- DOM ----------
  const canvas = document.getElementById('board');           // Tinten-Ebene (transparent)
  const ctx = canvas.getContext('2d');
  const bgCanvas = document.getElementById('bgBoard');        // Seitenmuster-Ebene (darunter, vom Radiergummi unberührt)
  const bgCtx = bgCanvas.getContext('2d');
  const overlayCanvas = document.getElementById('overlayBoard'); // nur Auswahl-Rahmen/Griff, nie gespeichert/exportiert
  const overlayCtx = overlayCanvas.getContext('2d');
  const status = document.getElementById('status');
  const emptyState = document.getElementById('emptyState');
  const notebookTitle = document.getElementById('notebookTitle');
  const bgSelect = document.getElementById('bgSelect');
  const colorPicker = document.getElementById('colorPicker');
  const quickColorsWrap = document.getElementById('quickColors');
  const widthSlider = document.getElementById('widthSlider');
  const toolButtons = document.querySelectorAll('.tool-btn');
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  const clearBtn = document.getElementById('clearBtn');
  const exportBtn = document.getElementById('exportBtn');
  const pageThumbs = document.getElementById('pageThumbs');
  const prevPageBtn = document.getElementById('prevPageBtn');
  const nextPageBtn = document.getElementById('nextPageBtn');
  const addPageBtn = document.getElementById('addPageBtn');
  const delPageBtn = document.getElementById('delPageBtn');
  const menuBtn = document.getElementById('menuBtn');
  const closeSidebarBtn = document.getElementById('closeSidebarBtn');
  const sidebar = document.getElementById('sidebar');
  const sidebarBackdrop = document.getElementById('sidebarBackdrop');
  const folderTree = document.getElementById('folderTree');
  const newFolderBtn = document.getElementById('newFolderBtn');
  const newNotebookBtn = document.getElementById('newNotebookBtn');
  const pencilOnlyBtn = document.getElementById('pencilOnlyBtn');
  const imageBtn = document.getElementById('imageBtn');
  const imageInput = document.getElementById('imageInput');
  const deleteImageBtn = document.getElementById('deleteImageBtn');
  const canvasWrap = document.getElementById('canvasWrap');
  const zoomWrap = document.getElementById('zoomWrap');
  const resetZoomBtn = document.getElementById('resetZoomBtn');

  function setStatus(text) { status.textContent = text; }

  // ---------- Datenmodell laden / anlegen (erst NACH den DOM-Refs, da setStatus DOM braucht) ----------
  let data = loadData();
  ensureDefaultData();

  // ---------- Canvas-Größe (logische CSS-Pixel, unabhängig von Retina) ----------
  let logicalWidth = 0, logicalHeight = 0;

  function fitCanvasResolution() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width * ratio));
    const h = Math.max(1, Math.round(rect.height * ratio));
    canvas.width = w; canvas.height = h;
    bgCanvas.width = w; bgCanvas.height = h;
    overlayCanvas.width = w; overlayCanvas.height = h;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    bgCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
    overlayCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
    logicalWidth = rect.width;
    logicalHeight = rect.height;
  }

  // ---------- Zeichnen (Vektor-Striche -> Pixel) ----------
  // Punkte werden als Bruchteil (0..1) der Seitenbreite/-höhe gespeichert, damit
  // sich alles beim Drehen/Skalieren des iPads sauber neu einpasst.
  function px(pt) { return { x: pt.x * logicalWidth, y: pt.y * logicalHeight, w: pt.w }; }
  function midpoint(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

  // Jedes Segment wird als quadratische Kurve durch die Mittelpunkte der
  // Nachbarpunkte gezeichnet (statt gerader Linien) -> glatte Linien statt
  // kantiger Vielecke. Anfang/Ende jeder Kurve knüpfen nahtlos an die
  // Nachbarsegmente an, weil sie denselben Mittelpunkt teilen.
  function drawSegment(g, stroke, i) {
    const pts = stroke.points;
    const P = (j) => px(pts[j]);
    const control = P(i - 1);
    const start = i >= 2 ? midpoint(P(i - 2), control) : control;
    const end = i <= pts.length - 2 ? midpoint(control, P(i)) : P(i);
    const w = P(i).w || stroke.width;

    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = stroke.color;

    if (stroke.tool === 'pencil') {
      const dx = end.x - start.x, dy = end.y - start.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const layers = 3;
      for (let L = 0; L < layers; L++) {
        const seed = hash01(stroke.id + ':' + i + ':' + L);
        const jitter = (seed - 0.5) * 1.4;
        g.globalAlpha = (stroke.opacity || 0.55) * 0.45;
        g.lineWidth = w * (0.55 + seed * 0.6);
        g.beginPath();
        g.moveTo(start.x + nx * jitter, start.y + ny * jitter);
        g.quadraticCurveTo(control.x + nx * jitter, control.y + ny * jitter, end.x + nx * jitter, end.y + ny * jitter);
        g.stroke();
      }
    } else {
      g.globalAlpha = stroke.opacity == null ? 1 : stroke.opacity;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(start.x, start.y);
      g.quadraticCurveTo(control.x, control.y, end.x, end.y);
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  // Bilder (Foto/Scan-Import) werden im selben strokes-Array wie Tinte
  // gespeichert, damit Reihenfolge/Undo/Redo einheitlich funktionieren.
  const imageCache = new Map(); // stroke.id -> HTMLImageElement

  function drawImageStroke(g, stroke) {
    let img = imageCache.get(stroke.id);
    if (!img) {
      img = new Image();
      img.onload = () => redrawCurrentPage();
      img.src = stroke.src;
      imageCache.set(stroke.id, img);
    }
    if (img.complete && img.naturalWidth) {
      g.drawImage(img, stroke.x * logicalWidth, stroke.y * logicalHeight, stroke.w * logicalWidth, stroke.h * logicalHeight);
    }
  }

  function renderStroke(g, stroke) {
    if (stroke.tool === 'image') { drawImageStroke(g, stroke); return; }
    const pts = stroke.points;
    if (!pts.length) return;
    g.save();
    g.globalCompositeOperation = stroke.composite || 'source-over';
    if (pts.length === 1) {
      const p = px(pts[0]);
      g.globalAlpha = stroke.opacity == null ? 1 : stroke.opacity;
      g.fillStyle = stroke.color;
      g.beginPath();
      g.arc(p.x, p.y, (p.w || stroke.width) / 2, 0, Math.PI * 2);
      g.fill();
    } else {
      for (let i = 1; i < pts.length; i++) drawSegment(g, stroke, i);
    }
    g.restore();
  }

  function drawBackground(g, style) {
    g.save();
    g.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    g.fillStyle = '#fffdf7';
    g.fillRect(0, 0, logicalWidth, logicalHeight);
    if (style && style !== 'blank') {
      if (style === 'lined') {
        const gap = 32;
        g.strokeStyle = 'rgba(70,110,180,0.28)';
        g.lineWidth = 1;
        for (let y = gap; y < logicalHeight; y += gap) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(logicalWidth, y + 0.5); g.stroke(); }
        g.strokeStyle = 'rgba(210,90,90,0.35)';
        const marginX = Math.min(46, logicalWidth * 0.12);
        g.beginPath(); g.moveTo(marginX, 0); g.lineTo(marginX, logicalHeight); g.stroke();
      } else if (style === 'grid') {
        const gap = 26;
        g.strokeStyle = 'rgba(70,110,180,0.25)';
        g.lineWidth = 1;
        for (let x = gap; x < logicalWidth; x += gap) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, logicalHeight); g.stroke(); }
        for (let y = gap; y < logicalHeight; y += gap) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(logicalWidth, y + 0.5); g.stroke(); }
      } else if (style === 'dot') {
        const gap = 26;
        g.fillStyle = 'rgba(70,110,180,0.35)';
        for (let x = gap; x < logicalWidth; x += gap) {
          for (let y = gap; y < logicalHeight; y += gap) { g.beginPath(); g.arc(x, y, 1.2, 0, Math.PI * 2); g.fill(); }
        }
      }
    }
    g.restore();
  }

  function currentPage() {
    const nb = findNotebook(data.ui.activeNotebookId);
    if (!nb) return null;
    return data.pages[data.ui.activePageId] || null;
  }

  function redrawCurrentPage() {
    const nb = findNotebook(data.ui.activeNotebookId);
    const page = currentPage();
    fitCanvasResolution();
    if (!nb || !page) { emptyState.hidden = false; return; }
    emptyState.hidden = true;
    drawBackground(bgCtx, nb.background);
    ctx.clearRect(0, 0, logicalWidth, logicalHeight);
    for (const stroke of page.strokes) renderStroke(ctx, stroke);
    redrawOverlay();
  }

  // Für Thumbnail/Export müssen Seitenmuster-Ebene und Tinten-Ebene
  // zusammen auf eine Offscreen-Canvas gezeichnet werden.
  function compositeToCanvas(w, h) {
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const octx = off.getContext('2d');
    octx.drawImage(bgCanvas, 0, 0, w, h);
    octx.drawImage(canvas, 0, 0, w, h);
    return off;
  }

  function regenerateThumb() {
    const page = currentPage();
    if (!page) return;
    const w = 96, h = Math.max(1, Math.round(96 * (logicalHeight / logicalWidth || 1.3)));
    page.thumb = compositeToCanvas(w, h).toDataURL('image/png');
  }

  // ---------- Werkzeug-Status ----------
  let activeTool = 'fountain';
  let redoStack = [];

  function applyToolUI() {
    toolButtons.forEach(b => b.classList.toggle('active', b.dataset.tool === activeTool));
    document.body.classList.toggle('tool-is-eraser', activeTool === 'eraser');
    document.body.classList.toggle('tool-is-select', activeTool === 'select');
    const cfg = TOOL_DEFAULTS[activeTool];
    if (!cfg) return; // 'select' ist kein Zeichenwerkzeug, hat keine Farbe/Stärke
    widthSlider.min = cfg.min; widthSlider.max = cfg.max;
    widthSlider.value = data.tools ? data.tools[activeTool].width : cfg.width;
    colorPicker.value = data.tools[activeTool].color;
    document.querySelectorAll('#quickColors .swatch').forEach(s => {
      s.classList.toggle('active', s.dataset.color.toLowerCase() === data.tools[activeTool].color.toLowerCase());
    });
  }

  function ensureToolMemory() {
    if (!data.tools) {
      data.tools = {};
      for (const key in TOOL_DEFAULTS) data.tools[key] = { color: TOOL_DEFAULTS[key].color, width: TOOL_DEFAULTS[key].width };
    }
  }
  ensureToolMemory();

  // ---------- Zeichnen per Zeiger (Maus/Touch/Pencil) ----------
  let currentStroke = null;
  let lastMoveTime = 0;

  function getFraction(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
    };
  }

  function widthForSpeed(speedFracPerMs, baseWidth) {
    // schnell -> dünner, langsam -> dicker (Füllfeder-Gefühl)
    const speedPx = speedFracPerMs * logicalWidth;
    const s = Math.min(Math.max(speedPx, 0), 2.2);
    const factor = 1.45 - (s / 2.2) * 0.85;
    return baseWidth * factor;
  }

  function isAllowedPointer(e) {
    if (!data.ui.pencilOnly) return true;
    return e.pointerType === 'pen';
  }

  // ---------- Bilder auswählen, verschieben & skalieren ----------
  // Bewusst NICHT durch "Nur Pencil" eingeschränkt: Bilder zurechtrücken ist
  // keine Schreibhandlung, das macht man auf einem iPad typischerweise mit
  // dem Finger, so wie in anderen Notiz-Apps auch.
  let selectedImageId = null;
  let dragMode = null; // null | 'move' | 'resize'
  let dragStart = null;
  const RESIZE_HANDLE_PX = 22;

  function imagesOnPage() {
    const page = currentPage();
    return page ? page.strokes.filter(s => s.tool === 'image') : [];
  }
  function selectedImage() {
    if (!selectedImageId) return null;
    return imagesOnPage().find(im => im.id === selectedImageId) || null;
  }
  function hitTestImage(fx, fy) {
    const imgs = imagesOnPage();
    for (let i = imgs.length - 1; i >= 0; i--) {
      const im = imgs[i];
      if (fx >= im.x && fx <= im.x + im.w && fy >= im.y && fy <= im.y + im.h) return im;
    }
    return null;
  }
  function handleHit(im, fx, fy) {
    if (!im) return false;
    const hx = (im.x + im.w) * logicalWidth, hy = (im.y + im.h) * logicalHeight;
    return Math.hypot(fx * logicalWidth - hx, fy * logicalHeight - hy) <= RESIZE_HANDLE_PX;
  }
  function clampImage(im) {
    const minVisible = 40; // logische px, die mindestens sichtbar bleiben müssen
    im.x = Math.min(1 - minVisible / logicalWidth, Math.max(-im.w + minVisible / logicalWidth, im.x));
    im.y = Math.min(1 - minVisible / logicalHeight, Math.max(-im.h + minVisible / logicalHeight, im.y));
  }
  function deselectImage() {
    selectedImageId = null;
    dragMode = null;
    updateImageSelectionUI();
  }
  function updateImageSelectionUI() { deleteImageBtn.hidden = !selectedImageId; }

  function drawSelectionOverlay() {
    const im = selectedImage();
    if (!im) return;
    const x = im.x * logicalWidth, y = im.y * logicalHeight, w = im.w * logicalWidth, h = im.h * logicalHeight;
    overlayCtx.save();
    overlayCtx.strokeStyle = '#2f6fed';
    overlayCtx.lineWidth = 1.5;
    overlayCtx.setLineDash([6, 4]);
    overlayCtx.strokeRect(x, y, w, h);
    overlayCtx.setLineDash([]);
    overlayCtx.beginPath();
    overlayCtx.arc(x + w, y + h, 9, 0, Math.PI * 2);
    overlayCtx.fillStyle = '#2f6fed';
    overlayCtx.fill();
    overlayCtx.lineWidth = 2;
    overlayCtx.strokeStyle = '#fff';
    overlayCtx.stroke();
    overlayCtx.restore();
  }
  function redrawOverlay() {
    overlayCtx.clearRect(0, 0, logicalWidth, logicalHeight);
    drawSelectionOverlay();
  }

  function selectPointerDown(e) {
    e.preventDefault();
    const f = getFraction(e);
    const cur = selectedImage();
    if (cur && handleHit(cur, f.x, f.y)) {
      dragMode = 'resize';
      dragStart = { fx: f.x, fy: f.y, img: { x: cur.x, y: cur.y, w: cur.w, h: cur.h } };
      return;
    }
    const hit = hitTestImage(f.x, f.y);
    if (hit) {
      selectedImageId = hit.id;
      dragMode = 'move';
      dragStart = { fx: f.x, fy: f.y, img: { x: hit.x, y: hit.y, w: hit.w, h: hit.h } };
    } else {
      deselectImage();
    }
    updateImageSelectionUI();
    redrawOverlay();
  }
  function selectPointerMove(e) {
    if (!dragMode) return;
    e.preventDefault();
    const f = getFraction(e);
    const im = selectedImage();
    if (!im) return;
    const dx = f.x - dragStart.fx, dy = f.y - dragStart.fy;
    if (dragMode === 'move') {
      im.x = dragStart.img.x + dx;
      im.y = dragStart.img.y + dy;
      clampImage(im);
    } else if (dragMode === 'resize') {
      const minFrac = 0.05;
      const aspect = (dragStart.img.w * logicalWidth) / (dragStart.img.h * logicalHeight);
      let newW = Math.max(minFrac, dragStart.img.w + dx);
      let newH = (newW * logicalWidth) / aspect / logicalHeight;
      if (newH < minFrac) { newH = minFrac; newW = (newH * logicalHeight * aspect) / logicalWidth; }
      im.w = newW; im.h = newH;
    }
    redrawCurrentPage();
  }
  function selectPointerUp() {
    if (!dragMode) return;
    dragMode = null;
    regenerateThumb();
    renderPageStrip();
    saveData();
  }

  deleteImageBtn.addEventListener('click', () => {
    const page = currentPage();
    const im = selectedImage();
    if (!page || !im) return;
    if (!confirm('Bild wirklich löschen?')) return;
    page.strokes = page.strokes.filter(s => s.id !== im.id);
    deselectImage();
    redoStack = [];
    updateUndoRedoButtons();
    redrawCurrentPage();
    regenerateThumb();
    renderPageStrip();
    saveData();
  });

  function pointerDown(e) {
    if (activeTool === 'select') { selectPointerDown(e); return; }
    if (!currentPage() || !isAllowedPointer(e)) return;
    e.preventDefault();
    canvas.setPointerCapture && e.pointerId != null && canvas.setPointerCapture(e.pointerId);
    const cfg = TOOL_DEFAULTS[activeTool];
    const tcfg = data.tools[activeTool];
    currentStroke = {
      id: uid(),
      tool: activeTool,
      color: activeTool === 'eraser' ? '#000000' : tcfg.color,
      width: tcfg.width,
      opacity: cfg.opacity,
      composite: cfg.composite,
      points: []
    };
    const f = getFraction(e);
    lastMoveTime = performance.now();
    currentStroke.points.push({ x: f.x, y: f.y, w: currentStroke.width });
    ctx.globalCompositeOperation = currentStroke.composite || 'source-over';
    renderStroke(ctx, { ...currentStroke, points: [currentStroke.points[0]] });
  }

  function pointerMove(e) {
    if (activeTool === 'select') { selectPointerMove(e); return; }
    if (!currentStroke || !isAllowedPointer(e)) return;
    e.preventDefault();
    const f = getFraction(e);
    const now = performance.now();
    const dt = Math.max(now - lastMoveTime, 1);
    const prev = currentStroke.points[currentStroke.points.length - 1];
    const dist = Math.hypot(f.x - prev.x, f.y - prev.y);
    if (dist < 1 / Math.max(logicalWidth, 200)) return; // Mini-Zittern ignorieren
    const speed = dist / dt;
    const w = TOOL_DEFAULTS[currentStroke.tool].variableWidth ? widthForSpeed(speed, currentStroke.width) : currentStroke.width;
    currentStroke.points.push({ x: f.x, y: f.y, w });
    lastMoveTime = now;
    ctx.globalCompositeOperation = currentStroke.composite || 'source-over';
    drawSegment(ctx, currentStroke, currentStroke.points.length - 1);
  }

  function pointerUp(e) {
    if (dragMode) { selectPointerUp(); return; }
    if (!currentStroke) return;
    const page = currentPage();
    if (page && currentStroke.points.length) {
      page.strokes.push(currentStroke);
      redoStack = [];
      updateUndoRedoButtons();
      regenerateThumb();
      renderPageStrip();
      saveData();
    }
    ctx.globalCompositeOperation = 'source-over';
    // Volles Neuzeichnen stellt sicher, dass die Live-Vorschau exakt dem
    // gespeicherten Vektor-Stroke entspricht (z.B. beim Radiergummi).
    redrawCurrentPage();
    currentStroke = null;
  }

  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  window.addEventListener('pointerup', pointerUp);
  window.addEventListener('pointercancel', pointerUp);

  // ---------- Werkzeugleiste ----------
  toolButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      activeTool = btn.dataset.tool;
      if (activeTool !== 'select') deselectImage();
      applyToolUI();
      redrawOverlay();
    });
  });
  colorPicker.addEventListener('input', () => {
    data.tools[activeTool].color = colorPicker.value;
    document.querySelectorAll('#quickColors .swatch').forEach(s => s.classList.remove('active'));
    saveData();
  });
  quickColorsWrap.addEventListener('click', (e) => {
    const btn = e.target.closest('.swatch');
    if (!btn) return;
    data.tools[activeTool].color = btn.dataset.color;
    applyToolUI();
    saveData();
  });
  widthSlider.addEventListener('input', () => {
    data.tools[activeTool].width = Number(widthSlider.value);
    saveData();
  });

  function updateUndoRedoButtons() {
    const page = currentPage();
    undoBtn.disabled = !page || !page.strokes.length;
    redoBtn.disabled = !redoStack.length;
  }

  undoBtn.addEventListener('click', () => {
    const page = currentPage();
    if (!page || !page.strokes.length) return;
    redoStack.push(page.strokes.pop());
    redrawCurrentPage();
    regenerateThumb();
    renderPageStrip();
    updateUndoRedoButtons();
    saveData();
  });
  redoBtn.addEventListener('click', () => {
    const page = currentPage();
    if (!page || !redoStack.length) return;
    page.strokes.push(redoStack.pop());
    redrawCurrentPage();
    regenerateThumb();
    renderPageStrip();
    updateUndoRedoButtons();
    saveData();
  });
  clearBtn.addEventListener('click', () => {
    const page = currentPage();
    if (!page || !page.strokes.length) return;
    if (!confirm('Diese Seite wirklich leeren?')) return;
    page.strokes = [];
    redoStack = [];
    redrawCurrentPage();
    regenerateThumb();
    renderPageStrip();
    updateUndoRedoButtons();
    saveData();
  });
  exportBtn.addEventListener('click', () => {
    compositeToCanvas(canvas.width, canvas.height).toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const nb = findNotebook(data.ui.activeNotebookId);
      const idx = nb ? nb.pageIds.indexOf(data.ui.activePageId) + 1 : 1;
      a.href = url;
      a.download = (nb ? nb.name.replace(/\s+/g, '_') : 'seite') + '_seite' + idx + '.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, 'image/png');
  });

  bgSelect.addEventListener('change', () => {
    const nb = findNotebook(data.ui.activeNotebookId);
    if (!nb) return;
    nb.background = bgSelect.value;
    redrawCurrentPage();
    regenerateThumb();
    saveData();
  });

  // ---------- Seiten-Navigation ----------
  function renderPageStrip() {
    const nb = findNotebook(data.ui.activeNotebookId);
    pageThumbs.innerHTML = '';
    if (!nb) return;
    nb.pageIds.forEach((pid, idx) => {
      const page = data.pages[pid];
      const b = document.createElement('button');
      b.className = 'page-thumb' + (pid === data.ui.activePageId ? ' active' : '');
      if (page && page.thumb) b.style.backgroundImage = `url(${page.thumb})`;
      b.innerHTML = `<span>${idx + 1}</span>`;
      b.addEventListener('click', () => openPage(pid));
      pageThumbs.appendChild(b);
    });
    delPageBtn.disabled = nb.pageIds.length <= 1;
  }

  function openPage(pageId) {
    if (!data.pages[pageId]) return;
    data.ui.activePageId = pageId;
    redoStack = [];
    deselectImage();
    resetZoom();
    redrawCurrentPage();
    renderPageStrip();
    updateUndoRedoButtons();
    saveData();
  }

  prevPageBtn.addEventListener('click', () => {
    const nb = findNotebook(data.ui.activeNotebookId);
    if (!nb) return;
    const i = nb.pageIds.indexOf(data.ui.activePageId);
    if (i > 0) openPage(nb.pageIds[i - 1]);
  });
  nextPageBtn.addEventListener('click', () => {
    const nb = findNotebook(data.ui.activeNotebookId);
    if (!nb) return;
    const i = nb.pageIds.indexOf(data.ui.activePageId);
    if (i < nb.pageIds.length - 1) openPage(nb.pageIds[i + 1]);
  });
  addPageBtn.addEventListener('click', () => {
    const nb = findNotebook(data.ui.activeNotebookId);
    if (!nb) return;
    const pid = uid();
    data.pages[pid] = newPage();
    nb.pageIds.push(pid);
    openPage(pid);
  });
  delPageBtn.addEventListener('click', () => {
    const nb = findNotebook(data.ui.activeNotebookId);
    if (!nb || nb.pageIds.length <= 1) return;
    if (!confirm('Diese Seite wirklich löschen?')) return;
    const i = nb.pageIds.indexOf(data.ui.activePageId);
    delete data.pages[data.ui.activePageId];
    nb.pageIds.splice(i, 1);
    openPage(nb.pageIds[Math.max(0, i - 1)]);
  });

  // ---------- Notizbuch öffnen ----------
  function openNotebook(id) {
    const nb = findNotebook(id);
    if (!nb) return;
    data.ui.activeNotebookId = id;
    data.ui.activePageId = nb.pageIds[0];
    redoStack = [];
    deselectImage();
    resetZoom();
    bgSelect.value = nb.background;
    const folder = nb.folderId ? findFolder(nb.folderId) : null;
    notebookTitle.innerHTML = (folder ? `<small>${escapeHtml(folder.name)}</small>` : '') + escapeHtml(nb.name);
    redrawCurrentPage();
    renderPageStrip();
    updateUndoRedoButtons();
    renderSidebar();
    closeSidebar();
    saveData();
  }

  // ---------- Sidebar: Ordner & Notizbücher ----------
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function notebooksIn(folderId) { return data.notebooks.filter(n => (n.folderId || null) === (folderId || null)); }

  function renderSidebar() {
    let html = '';
    html += renderFolderSection(null, 'Unsortiert', false);
    for (const folder of data.folders) html += renderFolderSection(folder.id, folder.name, true);
    folderTree.innerHTML = html;
  }

  function renderFolderSection(folderId, name, deletable) {
    const collapsed = data.ui.collapsedFolders.includes(folderId || 'root');
    const nbs = notebooksIn(folderId);
    let rows = nbs.map(nb => `
      <div class="notebook-row${nb.id === data.ui.activeNotebookId ? ' active' : ''}" data-open-notebook="${nb.id}">
        <span class="name">📓 ${escapeHtml(nb.name)}</span>
        <span class="count">${nb.pageIds.length}</span>
        <button class="row-btn" data-rename-notebook="${nb.id}" title="Umbenennen">✎</button>
        <button class="row-btn" data-delete-notebook="${nb.id}" title="Löschen">🗑</button>
      </div>`).join('');
    if (!nbs.length) rows = `<div class="empty-hint">keine Notizbücher</div>`;
    return `
      <div class="folder-block">
        <div class="folder-row${collapsed ? ' collapsed' : ''}" data-toggle-folder="${folderId || 'root'}">
          <span class="chevron">▾</span>
          <span class="name" style="flex:1">📁 ${escapeHtml(name)}</span>
          ${deletable ? `<button class="row-btn" data-rename-folder="${folderId}" title="Umbenennen">✎</button>
                          <button class="row-btn" data-delete-folder="${folderId}" title="Löschen">🗑</button>` : ''}
        </div>
        <div class="notebook-list" ${collapsed ? 'hidden' : ''}>${rows}</div>
      </div>`;
  }

  folderTree.addEventListener('click', (e) => {
    const t = e.target;
    const openId = t.closest('[data-open-notebook]');
    const toggleId = t.closest('[data-toggle-folder]');
    const renameNb = t.closest('[data-rename-notebook]');
    const deleteNb = t.closest('[data-delete-notebook]');
    const renameFolder = t.closest('[data-rename-folder]');
    const deleteFolder = t.closest('[data-delete-folder]');

    if (renameNb) { e.stopPropagation();
      const nb = findNotebook(renameNb.dataset.renameNotebook);
      const name = prompt('Neuer Name:', nb.name);
      if (name) { nb.name = name; renderSidebar(); if (nb.id === data.ui.activeNotebookId) openNotebook(nb.id); saveData(); }
      return;
    }
    if (deleteNb) { e.stopPropagation();
      const nb = findNotebook(deleteNb.dataset.deleteNotebook);
      if (!confirm(`Notizbuch "${nb.name}" mit allen Seiten wirklich löschen?`)) return;
      nb.pageIds.forEach(pid => delete data.pages[pid]);
      data.notebooks = data.notebooks.filter(n => n.id !== nb.id);
      ensureDefaultData();
      renderSidebar();
      openNotebook(data.ui.activeNotebookId);
      saveData();
      return;
    }
    if (renameFolder) { e.stopPropagation();
      const folder = findFolder(renameFolder.dataset.renameFolder);
      const name = prompt('Neuer Name:', folder.name);
      if (name) { folder.name = name; renderSidebar(); saveData(); }
      return;
    }
    if (deleteFolder) { e.stopPropagation();
      const folder = findFolder(deleteFolder.dataset.deleteFolder);
      if (!confirm(`Ordner "${folder.name}" löschen? Die Notizbücher darin werden nach "Unsortiert" verschoben.`)) return;
      data.notebooks.forEach(nb => { if (nb.folderId === folder.id) nb.folderId = null; });
      data.folders = data.folders.filter(f => f.id !== folder.id);
      renderSidebar();
      saveData();
      return;
    }
    if (openId) { openNotebook(openId.dataset.openNotebook); return; }
    if (toggleId) {
      const key = toggleId.dataset.toggleFolder;
      const i = data.ui.collapsedFolders.indexOf(key);
      if (i === -1) data.ui.collapsedFolders.push(key); else data.ui.collapsedFolders.splice(i, 1);
      renderSidebar();
      saveData();
    }
  });

  newFolderBtn.addEventListener('click', () => {
    const name = prompt('Name des Ordners:');
    if (!name) return;
    data.folders.push({ id: uid(), name });
    renderSidebar();
    saveData();
  });

  newNotebookBtn.addEventListener('click', () => {
    let folderId = null;
    if (data.folders.length) {
      const list = data.folders.map((f, i) => `${i + 1}: ${f.name}`).join('\n');
      const answer = prompt(`In welchen Ordner? (Zahl eingeben, leer = Unsortiert)\n${list}`, '');
      const n = answer ? parseInt(answer, 10) : NaN;
      if (!isNaN(n) && data.folders[n - 1]) folderId = data.folders[n - 1].id;
    }
    const name = prompt('Name des Notizbuchs:', 'Neues Notizbuch');
    if (!name) return;
    const nb = newNotebook(name, folderId);
    renderSidebar();
    openNotebook(nb.id);
    saveData();
  });

  // ---------- Nur-Apple-Pencil-Umschalter ----------
  function applyPencilOnlyUI() {
    pencilOnlyBtn.classList.toggle('active', !!data.ui.pencilOnly);
  }
  pencilOnlyBtn.addEventListener('click', () => {
    data.ui.pencilOnly = !data.ui.pencilOnly;
    applyPencilOnlyUI();
    saveData();
  });

  // ---------- Bild-/Scan-Import ----------
  // Ein normaler <input type=file accept="image/*"> reicht: iPadOS bietet in
  // seinem Auswahldialog von sich aus "Fotomediathek", "Foto aufnehmen" UND
  // "Dokumente scannen" an, keine gesonderte API nötig.
  imageBtn.addEventListener('click', () => {
    if (!currentPage()) return;
    imageInput.value = '';
    imageInput.click();
  });
  imageInput.addEventListener('change', () => {
    const file = imageInput.files && imageInput.files[0];
    const page = currentPage();
    if (!file || !page) return;
    const reader = new FileReader();
    reader.onload = () => {
      const probe = new Image();
      probe.onload = () => {
        const maxFracW = 0.85, maxFracH = 0.85;
        const imgAspect = probe.naturalWidth / probe.naturalHeight;
        const pageAspect = logicalWidth / logicalHeight;
        let wFrac, hFrac;
        if (imgAspect > pageAspect) { wFrac = maxFracW; hFrac = (wFrac * logicalWidth) / imgAspect / logicalHeight; }
        else { hFrac = maxFracH; wFrac = (hFrac * logicalHeight) * imgAspect / logicalWidth; }
        const stroke = {
          id: uid(), tool: 'image', src: reader.result,
          x: (1 - wFrac) / 2, y: (1 - hFrac) / 2, w: wFrac, h: hFrac
        };
        page.strokes.push(stroke);
        redoStack = [];
        updateUndoRedoButtons();
        // direkt zum Verschieben/Skalieren-Werkzeug wechseln und das neue
        // Bild auswählen, damit die Griffe sofort sichtbar sind
        activeTool = 'select';
        applyToolUI();
        selectedImageId = stroke.id;
        updateImageSelectionUI();
        redrawCurrentPage();
        regenerateThumb();
        renderPageStrip();
        saveData();
      };
      probe.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  // ---------- Zwei-Finger-Pinch-Zoom auf der Zeichenfläche ----------
  // Rein visuell (CSS-Transform auf einer Wrapper-Ebene um die Canvases),
  // rührt die gespeicherten Vektordaten nicht an. Funktioniert unabhängig
  // von "Nur Pencil", weil Zoomen kein Schreiben ist. Wirkt sich auf
  // getBoundingClientRect() der Canvases aus, wodurch Zeichnen/Auswählen
  // beim gezoomten Zustand automatisch weiter an der richtigen Stelle
  // landet, ganz ohne Änderungen an der Zeichen-Logik.
  let zoomScale = 1, zoomX = 0, zoomY = 0;
  let pinch = null; // { startDist, startScale, startMidX, startMidY, startZoomX, startZoomY }

  function touchDist(a, b) { return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }
  function touchMid(a, b, rect) {
    return { x: (a.clientX + b.clientX) / 2 - rect.left, y: (a.clientY + b.clientY) / 2 - rect.top };
  }

  function applyZoomTransform() {
    zoomWrap.style.transform = `translate(${zoomX}px, ${zoomY}px) scale(${zoomScale})`;
    resetZoomBtn.hidden = zoomScale <= 1.001;
  }

  function clampZoomPan() {
    zoomScale = Math.min(4, Math.max(1, zoomScale));
    const minX = logicalWidth * (1 - zoomScale), minY = logicalHeight * (1 - zoomScale);
    zoomX = Math.min(0, Math.max(minX, zoomX));
    zoomY = Math.min(0, Math.max(minY, zoomY));
  }

  function resetZoom() {
    zoomScale = 1; zoomX = 0; zoomY = 0;
    applyZoomTransform();
  }
  resetZoomBtn.addEventListener('click', resetZoom);

  canvasWrap.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      // Ein evtl. laufender Ein-Finger/Pencil-Strich oder Bild-Drag wird abgebrochen
      currentStroke = null;
      dragMode = null;
      const rect = canvasWrap.getBoundingClientRect();
      const [a, b] = e.touches;
      pinch = {
        startDist: touchDist(a, b),
        startScale: zoomScale,
        startMid: touchMid(a, b, rect),
        startZoomX: zoomX, startZoomY: zoomY
      };
    }
  }, { passive: true });

  canvasWrap.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && pinch) {
      e.preventDefault();
      const rect = canvasWrap.getBoundingClientRect();
      const [a, b] = e.touches;
      const newDist = touchDist(a, b);
      const newMid = touchMid(a, b, rect);
      const rawScale = pinch.startScale * (newDist / Math.max(pinch.startDist, 1));
      zoomScale = Math.min(4, Math.max(1, rawScale));
      const factor = zoomScale / pinch.startScale;
      zoomX = newMid.x - factor * (pinch.startMid.x - pinch.startZoomX);
      zoomY = newMid.y - factor * (pinch.startMid.y - pinch.startZoomY);
      clampZoomPan();
      applyZoomTransform();
    }
  }, { passive: false });

  canvasWrap.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) pinch = null;
  });
  canvasWrap.addEventListener('touchcancel', () => { pinch = null; });

  // ---------- Sidebar öffnen/schließen ----------
  function openSidebar() { sidebar.hidden = false; sidebarBackdrop.hidden = false; renderSidebar(); }
  function closeSidebar() { sidebar.hidden = true; sidebarBackdrop.hidden = true; }
  menuBtn.addEventListener('click', openSidebar);
  closeSidebarBtn.addEventListener('click', closeSidebar);
  sidebarBackdrop.addEventListener('click', closeSidebar);

  // ---------- Größe & Start ----------
  window.addEventListener('resize', () => { redrawCurrentPage(); });

  applyToolUI();
  applyPencilOnlyUI();
  openNotebook(data.ui.activeNotebookId);
})();

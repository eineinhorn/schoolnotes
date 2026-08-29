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
    return { folders: [], notebooks: [], pages: {}, ui: { activeNotebookId: null, activePageId: null, collapsedFolders: [] } };
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
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
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

  function setStatus(text) { status.textContent = text; }

  // ---------- Datenmodell laden / anlegen (erst NACH den DOM-Refs, da setStatus DOM braucht) ----------
  let data = loadData();
  ensureDefaultData();

  // ---------- Canvas-Größe (logische CSS-Pixel, unabhängig von Retina) ----------
  let logicalWidth = 0, logicalHeight = 0;

  function fitCanvasResolution() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    logicalWidth = rect.width;
    logicalHeight = rect.height;
  }

  // ---------- Zeichnen (Vektor-Striche -> Pixel) ----------
  // Punkte werden als Bruchteil (0..1) der Seitenbreite/-höhe gespeichert, damit
  // sich alles beim Drehen/Skalieren des iPads sauber neu einpasst.
  function px(pt) { return { x: pt.x * logicalWidth, y: pt.y * logicalHeight, w: pt.w }; }

  function drawSegment(g, stroke, i) {
    const p0 = px(stroke.points[i - 1]), p1 = px(stroke.points[i]);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = stroke.color;

    if (stroke.tool === 'pencil') {
      const layers = 3;
      for (let L = 0; L < layers; L++) {
        const seed = hash01(stroke.id + ':' + i + ':' + L);
        const jitter = (seed - 0.5) * 1.4;
        const dx = p1.x - p0.x, dy = p1.y - p0.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len;
        g.globalAlpha = (stroke.opacity || 0.55) * 0.45;
        g.lineWidth = (p1.w || stroke.width) * (0.55 + seed * 0.6);
        g.beginPath();
        g.moveTo(p0.x + nx * jitter, p0.y + ny * jitter);
        g.lineTo(p1.x + nx * jitter, p1.y + ny * jitter);
        g.stroke();
      }
    } else {
      g.globalAlpha = stroke.opacity == null ? 1 : stroke.opacity;
      g.lineWidth = p1.w || stroke.width;
      g.beginPath();
      g.moveTo(p0.x, p0.y);
      g.lineTo(p1.x, p1.y);
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  function renderStroke(g, stroke) {
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
    drawBackground(ctx, nb.background);
    for (const stroke of page.strokes) renderStroke(ctx, stroke);
  }

  function regenerateThumb() {
    const page = currentPage();
    if (!page) return;
    const off = document.createElement('canvas');
    const w = 96, h = Math.max(1, Math.round(96 * (logicalHeight / logicalWidth || 1.3)));
    off.width = w; off.height = h;
    off.getContext('2d').drawImage(canvas, 0, 0, w, h);
    page.thumb = off.toDataURL('image/png');
  }

  // ---------- Werkzeug-Status ----------
  let activeTool = 'fountain';
  let redoStack = [];

  function applyToolUI() {
    const cfg = TOOL_DEFAULTS[activeTool];
    toolButtons.forEach(b => b.classList.toggle('active', b.dataset.tool === activeTool));
    document.body.classList.toggle('tool-is-eraser', activeTool === 'eraser');
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

  function pointerDown(e) {
    if (!currentPage()) return;
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
    if (!currentStroke) return;
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
    btn.addEventListener('click', () => { activeTool = btn.dataset.tool; applyToolUI(); });
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
    canvas.toBlob((blob) => {
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

  // ---------- Sidebar öffnen/schließen ----------
  function openSidebar() { sidebar.hidden = false; sidebarBackdrop.hidden = false; renderSidebar(); }
  function closeSidebar() { sidebar.hidden = true; sidebarBackdrop.hidden = true; }
  menuBtn.addEventListener('click', openSidebar);
  closeSidebarBtn.addEventListener('click', closeSidebar);
  sidebarBackdrop.addEventListener('click', closeSidebar);

  // ---------- Größe & Start ----------
  window.addEventListener('resize', () => { redrawCurrentPage(); });

  applyToolUI();
  openNotebook(data.ui.activeNotebookId);
})();

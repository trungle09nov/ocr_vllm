'use strict';

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  /** @type {FileItem[]} */
  files: [],
  activeFileId: null,
  /** 'split' | 'markdown' | 'raw' */
  view: 'split',
  searchQuery: '',
  processing: false,
  config: loadConfig(),
};

// FileItem shape:
// { id, file, name, size, pageCount, thumbnail, status, pages, error }
// PageResult shape:
// { pageNum, markdown, imageDataUrl, selected }

// ─── Config ───────────────────────────────────────────────────────────────────

function loadConfig() {
  return {
    apiUrl: localStorage.getItem('ocr_api_url') || 'http://localhost:9000',
    temperature: parseFloat(localStorage.getItem('ocr_temperature') || '0.2'),
    maxTokens: parseInt(localStorage.getItem('ocr_max_tokens') || '2048'),
  };
}

function saveConfig() {
  localStorage.setItem('ocr_api_url', state.config.apiUrl);
  localStorage.setItem('ocr_temperature', String(state.config.temperature));
  localStorage.setItem('ocr_max_tokens', String(state.config.maxTokens));
}

// ─── File management ──────────────────────────────────────────────────────────

const ACCEPTED_TYPES = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/tiff',
]);

function isAccepted(file) {
  return ACCEPTED_TYPES.has(file.type) || file.name.toLowerCase().endsWith('.pdf');
}

function makeFileItem(file) {
  return {
    id: crypto.randomUUID(),
    file,
    name: file.name,
    size: file.size,
    pageCount: null,
    thumbnail: null,
    status: 'pending',
    pages: [],
    error: null,
  };
}

async function addFiles(fileList) {
  const added = [];
  for (const file of fileList) {
    if (!isAccepted(file)) continue;
    const item = makeFileItem(file);
    state.files.push(item);
    added.push(item);
    appendQueueCard(item); // show card immediately
  }

  showQueueSection();
  updateStartButton();

  // Populate thumbnails + page count in background
  for (const item of added) {
    getFileInfo(item.file)
      .then((info) => {
        item.thumbnail = info.thumbnail;
        item.pageCount = info.pageCount;
        refreshQueueCard(item);
      })
      .catch(() => {});
  }
}

function removeFile(id) {
  const idx = state.files.findIndex((f) => f.id === id);
  if (idx === -1) return;
  state.files.splice(idx, 1);
  document.getElementById(`qcard-${id}`)?.remove();

  if (state.activeFileId === id) {
    const next = state.files.find((f) => f.pages.length > 0);
    state.activeFileId = next?.id ?? null;
  }

  showQueueSection();
  updateStartButton();
  renderTabs();
  renderPages();

  if (!state.files.some((f) => f.pages.length > 0 || f.status === 'processing')) {
    document.getElementById('results-section').classList.add('hidden');
  }
}

// ─── Processing ───────────────────────────────────────────────────────────────

async function startProcessing() {
  if (state.processing) return;
  state.processing = true;
  document.getElementById('btn-start').classList.add('hidden');

  const pending = state.files.filter((f) => f.status === 'pending');
  for (const item of pending) {
    await processFile(item);
  }

  state.processing = false;
  updateStartButton();
}

async function processFile(item) {
  item.status = 'processing';
  refreshQueueCard(item);
  setStatusBar(`Dang xu ly: ${item.name}`);

  let pdfDoc = null;
  try {
    if (isPdfFile(item.file)) {
      pdfDoc = await loadPdfDoc(item.file);
      if (item.pageCount === null) item.pageCount = pdfDoc.numPages;
      refreshQueueCard(item);
    }

    for await (const data of streamOCR(item.file, state.config)) {
      if (data.status === 'processing') continue;

      if (data.status === 'done') {
        item.status = 'done';
        refreshQueueCard(item);
        break;
      }

      if (data.page !== undefined) {
        let imageDataUrl = null;
        if (pdfDoc) {
          imageDataUrl = await renderPdfPage(pdfDoc, data.page).catch(() => null);
        } else if (data.page === 1) {
          imageDataUrl = await readFileAsDataUrl(item.file).catch(() => null);
        }

        const markdown = data.result ? extractMarkdown(data.result) : '';
        const pageResult = {
          pageNum: data.page,
          markdown: data.error ? `> Loi trang ${data.page}: ${data.error}` : markdown,
          imageDataUrl,
          selected: !data.error,
        };
        item.pages.push(pageResult);

        // Auto-activate this file on first page
        if (item.pages.length === 1 && state.activeFileId === null) {
          state.activeFileId = item.id;
          document.getElementById('results-section').classList.remove('hidden');
        }

        renderTabs();
        if (state.activeFileId === item.id) renderPage(pageResult, item.id);
      }
    }
  } catch (err) {
    item.status = 'error';
    item.error = err.message;
    refreshQueueCard(item);
    showToast(`Loi: ${err.message}`, 'error');
  }

  if (pdfDoc) pdfDoc.destroy();
  renderTabs();
  setStatusBar('');
}

function isPdfFile(file) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

// ─── Queue UI ─────────────────────────────────────────────────────────────────

function showQueueSection() {
  const section = document.getElementById('file-queue');
  const count = document.getElementById('queue-count');
  if (state.files.length === 0) {
    section.classList.add('hidden');
  } else {
    section.classList.remove('hidden');
    count.textContent = state.files.length;
  }
}

function appendQueueCard(item) {
  const card = buildQueueCard(item);
  document.getElementById('queue-list').appendChild(card);
}

function refreshQueueCard(item) {
  const existing = document.getElementById(`qcard-${item.id}`);
  if (!existing) return;
  const fresh = buildQueueCard(item);
  existing.replaceWith(fresh);
}

function buildQueueCard(item) {
  const statusClass = {
    pending: '',
    processing: 'status-processing',
    done: 'status-done',
    error: 'status-error',
  }[item.status];

  const isActive = item.id === state.activeFileId;

  const card = document.createElement('div');
  card.id = `qcard-${item.id}`;
  card.className = `queue-card ${statusClass} ${isActive ? 'active' : ''}`;

  const thumbHtml = item.thumbnail
    ? `<img src="${item.thumbnail}" alt="">`
    : `<span>${isPdfFile(item.file) ? '&#128196;' : '&#128247;'}</span>`;

  const statusIcon = {
    pending: '&#9900;',
    processing: '<span class="spinning">&#9881;</span>',
    done: '&#10003;',
    error: '&#10007;',
  }[item.status];

  const progress = item.status === 'processing' && item.pageCount
    ? `<div class="progress-bar"><div class="progress-fill" style="width:${Math.round((item.pages.length / item.pageCount) * 100)}%"></div></div>`
    : '';

  card.innerHTML = `
    <div class="queue-thumb">${thumbHtml}</div>
    <div class="queue-info">
      <div class="queue-name" title="${escapeAttr(item.name)}">${escapeHtml(item.name)}</div>
      <div class="queue-meta">${formatSize(item.size)}${item.pageCount ? ` &middot; ${item.pageCount} tr` : ''}</div>
      ${progress}
    </div>
    <div class="queue-status-badge">${statusIcon}</div>
    <button class="queue-delete-btn" title="Xoa" aria-label="Xoa file">&#10005;</button>
  `;

  card.addEventListener('click', (e) => {
    if (e.target.closest('.queue-delete-btn')) return;
    state.activeFileId = item.id;
    // Re-mark active on all cards
    document.querySelectorAll('.queue-card').forEach((c) => c.classList.remove('active'));
    card.classList.add('active');
    renderTabs();
    renderPages();
    if (item.pages.length > 0 || item.status === 'processing') {
      document.getElementById('results-section').classList.remove('hidden');
    }
  });

  card.querySelector('.queue-delete-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    removeFile(item.id);
  });

  return card;
}

// ─── Result tabs ──────────────────────────────────────────────────────────────

function renderTabs() {
  const container = document.getElementById('result-tabs');
  container.innerHTML = '';

  const visible = state.files.filter(
    (f) => f.pages.length > 0 || f.status === 'processing',
  );

  for (const item of visible) {
    const btn = document.createElement('button');
    const active = item.id === state.activeFileId;

    btn.className = active
      ? 'px-3 py-1.5 text-xs rounded-lg bg-indigo-600 text-white font-medium whitespace-nowrap flex items-center gap-1.5'
      : 'px-3 py-1.5 text-xs rounded-lg border border-gray-200 bg-white text-gray-600 hover:border-indigo-400 transition whitespace-nowrap flex items-center gap-1.5';

    const icon = item.status === 'processing'
      ? '<span class="spinning">&#9881;</span>'
      : item.status === 'error' ? '&#10007;' : '';

    btn.innerHTML = `${icon}<span class="max-w-[140px] truncate">${escapeHtml(item.name)}</span>`;

    btn.addEventListener('click', () => {
      state.activeFileId = item.id;
      renderTabs();
      renderPages();
      // Sync active state on queue cards
      document.querySelectorAll('.queue-card').forEach((c) => c.classList.remove('active'));
      document.getElementById(`qcard-${item.id}`)?.classList.add('active');
    });
    container.appendChild(btn);
  }
}

// ─── Page rendering ───────────────────────────────────────────────────────────

let _renderedFileId = null;

/** Render ALL pages for the active file (used on tab switch / view change / search). */
function renderPages() {
  const container = document.getElementById('pages-container');
  const activeFile = state.files.find((f) => f.id === state.activeFileId);

  if (!activeFile) {
    container.innerHTML = '';
    _renderedFileId = null;
    return;
  }

  // Full rebuild when file changes
  if (_renderedFileId !== state.activeFileId) {
    container.innerHTML = '';
    _renderedFileId = state.activeFileId;
  }

  // Remove pages that no longer exist (shouldn't happen, but safety)
  container.querySelectorAll('.page-card').forEach((el) => {
    const num = parseInt(el.dataset.page, 10);
    if (!activeFile.pages.find((p) => p.pageNum === num)) el.remove();
  });

  for (const page of activeFile.pages) {
    upsertPageCard(page, activeFile.id);
  }
}

/** Append or update a single page card — used during streaming. */
function renderPage(page, fileId) {
  if (fileId !== state.activeFileId) return;
  upsertPageCard(page, fileId);
}

function upsertPageCard(page, fileId) {
  const container = document.getElementById('pages-container');
  const cardId = `pcard-${fileId}-${page.pageNum}`;
  let card = document.getElementById(cardId);

  const isNew = !card;
  if (isNew) {
    card = document.createElement('div');
    card.id = cardId;
    card.className = 'page-card';
    card.dataset.page = page.pageNum;
    container.appendChild(card);
  }

  // Search visibility
  const q = state.searchQuery.toLowerCase();
  const visible = !q || page.markdown.toLowerCase().includes(q);
  card.classList.toggle('hidden-by-search', !visible);

  const hasTable = page.markdown.includes('|');
  const tableBadge = hasTable ? '<span class="table-badge">TABLE</span>' : '';

  // Content area
  let contentHtml;
  if (state.view === 'raw') {
    contentHtml = `<div class="raw-view">${escapeHtml(page.markdown)}</div>`;
  } else {
    const rawHtml = DOMPurify.sanitize(marked.parse(page.markdown));
    const html = q ? highlightHtml(rawHtml, q) : rawHtml;
    contentHtml = `<div class="markdown-body">${html}</div>`;
  }

  // Layout
  const showImage = state.view === 'split' && page.imageDataUrl;
  const layoutClass = showImage ? 'split-grid' : '';
  const imageHtml = showImage
    ? `<div class="split-image"><img src="${page.imageDataUrl}" alt="Trang ${page.pageNum}" loading="lazy"></div>`
    : '';

  card.innerHTML = `
    <div class="flex items-center gap-2 mb-3">
      <label class="flex items-center gap-2 text-xs font-semibold text-gray-500 cursor-pointer select-none">
        <input type="checkbox" class="page-checkbox rounded" data-page="${page.pageNum}" ${page.selected ? 'checked' : ''}>
        Trang ${page.pageNum}
      </label>
      ${tableBadge}
      <div class="ml-auto flex items-center gap-1.5">
        <button class="copy-btn text-xs text-gray-400 hover:text-gray-700 transition px-2 py-0.5 rounded hover:bg-gray-100" data-page="${page.pageNum}">
          Copy
        </button>
      </div>
    </div>
    <div class="${layoutClass}">
      ${imageHtml}
      <div>${contentHtml}</div>
    </div>
  `;

  // Events
  card.querySelector('.page-checkbox').addEventListener('change', (e) => {
    page.selected = e.target.checked;
  });
  card.querySelector('.copy-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(page.markdown).then(() => showToast('Da copy!'));
  });
}

// ─── Search highlight ─────────────────────────────────────────────────────────

function highlightHtml(html, query) {
  const div = document.createElement('div');
  div.innerHTML = html;
  walkTextNodes(div, query);
  return div.innerHTML;
}

function walkTextNodes(node, query) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent;
    const lower = text.toLowerCase();
    const idx = lower.indexOf(query);
    if (idx < 0) return;

    const before = document.createTextNode(text.slice(0, idx));
    const mark = document.createElement('mark');
    mark.className = 'search-hl';
    mark.textContent = text.slice(idx, idx + query.length);
    const after = document.createTextNode(text.slice(idx + query.length));

    const parent = node.parentNode;
    parent.insertBefore(before, node);
    parent.insertBefore(mark, node);
    parent.insertBefore(after, node);
    parent.removeChild(node);
  } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'MARK') {
    for (const child of Array.from(node.childNodes)) {
      walkTextNodes(child, query);
    }
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}

function setStatusBar(msg) {
  const el = document.getElementById('status-bar');
  if (msg) {
    el.textContent = msg;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  const bg = type === 'error' ? 'bg-red-600' : 'bg-gray-800';
  toast.className = `${bg} text-white text-xs px-4 py-2.5 rounded-xl shadow-lg pointer-events-auto max-w-xs`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

function updateStartButton() {
  const btn = document.getElementById('btn-start');
  const hasPending = state.files.some((f) => f.status === 'pending');
  btn.classList.toggle('hidden', !hasPending || state.processing);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
  initPdfWorker();

  // ── Upload zone ──
  const zone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('file-input');

  zone.addEventListener('click', (e) => {
    if (e.target.closest('#btn-start')) return;
    fileInput.click();
  });
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('border-indigo-400', 'bg-indigo-50');
  });
  zone.addEventListener('dragleave', () => {
    zone.classList.remove('border-indigo-400', 'bg-indigo-50');
  });
  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    zone.classList.remove('border-indigo-400', 'bg-indigo-50');
    await addFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener('change', async () => {
    await addFiles(fileInput.files);
    fileInput.value = '';
  });

  document.getElementById('btn-start').addEventListener('click', (e) => {
    e.stopPropagation();
    startProcessing();
  });

  // ── Clear queue ──
  document.getElementById('btn-clear-queue').addEventListener('click', () => {
    if (state.processing) return;
    state.files = [];
    state.activeFileId = null;
    _renderedFileId = null;
    document.getElementById('queue-list').innerHTML = '';
    document.getElementById('pages-container').innerHTML = '';
    document.getElementById('result-tabs').innerHTML = '';
    showQueueSection();
    document.getElementById('results-section').classList.add('hidden');
    updateStartButton();
  });

  // ── View toggle ──
  document.querySelectorAll('.view-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.view = btn.dataset.view;
      _renderedFileId = null; // force full rebuild
      document.querySelectorAll('.view-btn').forEach((b) =>
        b.classList.toggle('active', b === btn),
      );
      renderPages();
    });
  });

  // ── Search ──
  let searchTimer;
  document.getElementById('search-input').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.searchQuery = e.target.value.trim();
      renderPages();
    }, 180);
  });

  // ── Select all / deselect ──
  document.getElementById('btn-select-all').addEventListener('click', () => {
    const activeFile = state.files.find((f) => f.id === state.activeFileId);
    if (!activeFile) return;
    const allSelected = activeFile.pages.every((p) => p.selected);
    activeFile.pages.forEach((p) => { p.selected = !allSelected; });
    renderPages();
  });

  // ── Copy all ──
  document.getElementById('btn-copy-all').addEventListener('click', () => {
    const activeFile = state.files.find((f) => f.id === state.activeFileId);
    if (!activeFile || activeFile.pages.length === 0) return;
    const text = activeFile.pages
      .map((p) => `# Trang ${p.pageNum}\n\n${p.markdown}`)
      .join('\n\n---\n\n');
    navigator.clipboard.writeText(text).then(() => showToast('Da copy tat ca!'));
  });

  // ── Export menu ──
  const exportBtn = document.getElementById('btn-export');
  const exportMenu = document.getElementById('export-menu');

  exportBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    exportMenu.classList.toggle('hidden');
  });
  document.addEventListener('click', () => exportMenu.classList.add('hidden'));

  document.querySelectorAll('.export-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const activeFile = state.files.find((f) => f.id === state.activeFileId);
      if (!activeFile) return;

      const selected = activeFile.pages.filter((p) => p.selected);
      if (selected.length === 0) {
        showToast('Chua chon trang nao!', 'error');
        return;
      }

      const basename = activeFile.name.replace(/\.[^.]+$/, '') + '_ocr';

      switch (btn.dataset.format) {
        case 'md':     exportMD(basename, selected);   break;
        case 'csv':    exportCSV(basename, selected);  break;
        case 'xlsx':   exportXLSX(basename, selected); break;
        case 'md-all': exportMergedMD(
          state.files.filter((f) => f.pages.length > 0),
        ); break;
      }
    });
  });

  // ── Settings modal ──
  document.getElementById('btn-settings').addEventListener('click', () => {
    document.getElementById('input-api-url').value = state.config.apiUrl;
    document.getElementById('input-temperature').value = state.config.temperature;
    document.getElementById('input-max-tokens').value = state.config.maxTokens;
    document.getElementById('modal-settings').classList.remove('hidden');
  });
  document.getElementById('btn-settings-cancel').addEventListener('click', () => {
    document.getElementById('modal-settings').classList.add('hidden');
  });
  document.getElementById('btn-settings-save').addEventListener('click', () => {
    const url = document.getElementById('input-api-url').value.trim();
    const temp = parseFloat(document.getElementById('input-temperature').value);
    const tokens = parseInt(document.getElementById('input-max-tokens').value);

    if (!url) { showToast('URL khong duoc de trong!', 'error'); return; }
    if (isNaN(temp) || temp < 0 || temp > 2) { showToast('Temperature phai tu 0 den 2', 'error'); return; }
    if (isNaN(tokens) || tokens < 1) { showToast('Max tokens khong hop le', 'error'); return; }

    state.config.apiUrl = url;
    state.config.temperature = temp;
    state.config.maxTokens = tokens;
    saveConfig();
    document.getElementById('modal-settings').classList.add('hidden');
    showToast('Da luu cai dat!');
  });

  // Close settings modal on backdrop click
  document.getElementById('modal-settings').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
  });
}

document.addEventListener('DOMContentLoaded', init);

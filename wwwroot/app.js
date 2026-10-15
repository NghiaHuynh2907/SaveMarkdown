(() => {
  'use strict';

  // ================= Tiện ích chung =================

  const $ = (id) => document.getElementById(id);
  const els = {
    body: $('app-body'),
    sidebar: $('sidebar'),
    treeScroll: $('tree-scroll'),
    tree: $('tree'),
    results: $('search-results'),
    search: $('search'),
    hint: $('target-hint'),
    backdrop: $('backdrop'),
    viewer: $('viewer'),
    doc: $('doc'),
    toc: $('toc'),
    path: $('doc-path'),
    actions: $('doc-actions'),
    editor: $('editor'),
    editorToolbar: $('editor-toolbar'),
    editorInput: $('editor-input'),
    editorPreview: $('editor-preview'),
    menu: $('context-menu'),
    modalRoot: $('modal-root'),
    toast: $('toast'),
    fileInput: $('file-input'),
  };

  const ROOT_NAME = 'Tất cả tài liệu';
  const TEXT_EXT = ['.md', '.markdown', '.txt'];
  const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
  const JSON_HEADERS = { 'Content-Type': 'application/json' };
  const isCoarse = matchMedia('(pointer: coarse)').matches;
  const mobileQuery = matchMedia('(max-width: 760px)');

  const extOf = (p) => { const m = /\.[^./]+$/.exec(p); return m ? m[0].toLowerCase() : ''; };
  const isText = (p) => TEXT_EXT.includes(extOf(p));
  const isImage = (p) => IMAGE_EXT.includes(extOf(p));
  const parentOf = (p) => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
  const nameOf = (p) => p ? p.slice(p.lastIndexOf('/') + 1) : ROOT_NAME;
  const join = (a, b) => a ? `${a}/${b}` : b;
  const enc = encodeURIComponent;
  const folderLabel = (p) => p ? `/${p}` : ROOT_NAME;
  const rawUrl = (p) => `/api/files/raw?path=${enc(p)}`;

  // Bản chạy trên GitHub Pages cài window.SAVEMD_BACKEND để thay server (gọi GitHub API).
  const backend = window.SAVEMD_BACKEND || null;
  const loginUrl = backend ? backend.loginUrl : '/login';

  // Gán ảnh/link ảnh từ thư mục tài liệu; bản GitHub cần tải kèm token nên trả về blob URL.
  function setRawUrl(node, attr, path) {
    if (!backend) {
      node[attr] = rawUrl(path);
      return;
    }
    backend.blobUrl(path).then((url) => { node[attr] = url; }).catch(() => { /* ảnh lỗi thì bỏ qua */ });
  }

  // localStorage chỉ dùng cho tiện ích cá nhân (theme, thư mục đang mở...); lỗi thì bỏ qua.
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem('savemd.' + key);
        return v === null ? fallback : JSON.parse(v);
      } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('savemd.' + key, JSON.stringify(value)); } catch { /* bỏ qua */ }
    },
    remove(key) {
      try { localStorage.removeItem('savemd.' + key); } catch { /* bỏ qua */ }
    },
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // Bỏ dấu tiếng Việt + chữ thường, dùng cho slug tiêu đề.
  const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
  const slugify = (s) => fold(s).trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');

  // ================= Icon (SVG tĩnh, không chứa dữ liệu người dùng) =================

  const svg = (paths) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
  const FOLDER_PATH = '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>';
  const FILE_PATH = '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>';
  const ICONS = {
    chevron: svg('<path d="m9 18 6-6-6-6"/>'),
    folder: svg(FOLDER_PATH),
    folderOpen: svg('<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>'),
    folderPlus: svg('<path d="M12 10v6"/><path d="M9 13h6"/>' + FOLDER_PATH),
    file: svg(FILE_PATH + '<path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>'),
    filePlus: svg(FILE_PATH + '<path d="M9 15h6"/><path d="M12 18v-6"/>'),
    image: svg('<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'),
    library: svg('<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>'),
    upload: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>'),
    download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>'),
    archive: svg('<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>'),
    trash: svg('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>'),
    restore: svg('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>'),
    eye: svg('<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'),
    pencil: svg('<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>'),
    rename: svg('<path d="M17 22h-1a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4h1"/><path d="M7 22h1a4 4 0 0 0 4-4v-1"/><path d="M7 2h1a4 4 0 0 1 4 4v1"/>'),
    move: svg('<path d="M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1"/><path d="M2 13h10"/><path d="m9 16 3-3-3-3"/>'),
    save: svg('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>'),
    x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
    copy: svg('<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'),
    check: svg('<path d="M20 6 9 17l-5-5"/>'),
    sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>'),
    moon: svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'),
    monitor: svg('<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>'),
    bold: svg('<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>'),
    italic: svg('<line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/>'),
    heading: svg('<path d="M6 12h12"/><path d="M6 20V4"/><path d="M18 20V4"/>'),
    list: svg('<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>'),
    listChecks: svg('<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>'),
    quote: svg('<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>'),
    code: svg('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>'),
    link: svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
  };

  const iconForPath = (path, type, open) =>
    type === 'dir' ? (path === '' ? ICONS.library : open ? ICONS.folderOpen : ICONS.folder)
      : isImage(path) ? ICONS.image : ICONS.file;
  const iconClass = (path, type) =>
    type === 'dir' ? (path === '' ? 'root' : 'folder') : isImage(path) ? 'image' : 'file';

  // ================= Trạng thái =================

  const state = {
    tree: null,
    selected: { path: '', type: 'dir' },
    expanded: new Set(store.get('expanded', [''])),
    openFile: '',
    version: '',
    content: '',
    editing: false,
    dirty: false,
    uploadFolder: '',
    pendingEdit: null,
    git: null,
  };
  state.expanded.add('');
  const saveExpanded = () => store.set('expanded', [...state.expanded]);

  // ================= API =================

  // Mọi request API đi qua đây: gặp 401 -> lưu nháp (nếu đang sửa) rồi về trang đăng nhập.
  async function api(url, options = {}) {
    const res = backend ? await backend.fetch(url, options) : await fetch(url, { credentials: 'same-origin', ...options });
    if (res.status === 401) {
      if (state.editing && state.dirty) saveDraftNow();
      location.replace(loginUrl);
      throw new Error('unauthorized');
    }
    return res;
  }
  const apiJson = (url, method, body) => api(url, { method, headers: JSON_HEADERS, body: JSON.stringify(body) });

  async function errorMessage(res) {
    try {
      const body = await res.json();
      return body.message || body.title || res.statusText;
    } catch {
      return res.statusText || `Lỗi ${res.status}`;
    }
  }

  function handleError(err) {
    if (err && err.message !== 'unauthorized') {
      console.error(err);
      toastError('Không kết nối được tới server');
    }
  }

  // ================= Toast =================

  let toastTimer = null;
  function toast(message, { error = false, action = null, duration } = {}) {
    clearTimeout(toastTimer);
    const children = [el('span', null, message)];
    if (action) {
      const btn = el('button', 'toast-action', action.label);
      btn.type = 'button';
      btn.addEventListener('click', () => {
        hideToast();
        Promise.resolve(action.run()).catch(handleError);
      });
      children.push(btn);
    }
    els.toast.replaceChildren(...children);
    els.toast.classList.toggle('error', error);
    els.toast.classList.add('show');
    toastTimer = setTimeout(hideToast, duration ?? (action ? 7000 : error ? 5000 : 2800));
  }
  const toastError = (message) => toast(message, { error: true });
  const hideToast = () => els.toast.classList.remove('show');

  // ================= Hộp thoại (thay cho prompt/confirm của trình duyệt) =================

  function openModal({ title, content = [], buttons, initialFocus, wide = false, onReady }) {
    return new Promise((resolve) => {
      const overlay = el('div', 'modal-overlay');
      const box = el('div', 'modal' + (wide ? ' modal-wide' : ''));
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-label', title);
      const body = el('div', 'modal-body');
      body.append(...content);
      const footer = el('div', 'modal-actions');
      const previousFocus = document.activeElement;
      let primary = null;

      const finish = (value) => {
        overlay.remove();
        document.removeEventListener('keydown', onKey, true);
        if (previousFocus && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
        resolve(value);
      };

      for (const def of buttons) {
        const btn = el('button', `btn ${def.kind ? 'btn-' + def.kind : ''} ${def.className || ''}`, def.label);
        btn.type = 'button';
        btn.addEventListener('click', () => {
          // value là hàm: trả undefined = giữ hộp thoại mở.
          const value = typeof def.value === 'function' ? def.value() : def.value;
          if (value !== undefined) finish(value);
        });
        if (def.primary) primary = btn;
        footer.appendChild(btn);
      }

      function onKey(e) {
        if (els.modalRoot.lastElementChild !== overlay) return; // chỉ hộp thoại trên cùng nhận phím
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(null);
        } else if (e.key === 'Enter' && primary && !e.target.closest('textarea, button')) {
          e.preventDefault();
          primary.click();
        }
      }

      overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) finish(null); });
      document.addEventListener('keydown', onKey, true);
      box.append(el('h2', 'modal-title', title), body, footer);
      overlay.appendChild(box);
      els.modalRoot.appendChild(overlay);
      (initialFocus || primary || box.querySelector('button'))?.focus({ preventScroll: true });
      box.scrollTop = 0;
      onReady?.({ finish, body, footer });
    });
  }

  const uiConfirm = ({ title, message, okLabel = 'Đồng ý', danger = false }) =>
    openModal({
      title,
      content: [el('p', 'modal-text', message)],
      buttons: [
        { label: 'Hủy', value: false },
        { label: okLabel, kind: danger ? 'danger' : 'primary', primary: true, value: true },
      ],
    }).then((v) => v === true);

  function uiPrompt({ title, label, value = '', okLabel = 'OK', selectRange }) {
    const input = el('input', 'input');
    input.value = value;
    input.spellcheck = false;
    const lab = el('label', 'field-label', label);
    const id = 'f' + Math.random().toString(36).slice(2);
    input.id = id;
    lab.htmlFor = id;
    const promise = openModal({
      title,
      content: [lab, input],
      initialFocus: input,
      buttons: [
        { label: 'Hủy', value: null },
        { label: okLabel, kind: 'primary', primary: true, value: () => input.value.trim() || undefined },
      ],
    });
    if (selectRange) input.setSelectionRange(...selectRange);
    else input.select();
    return promise;
  }

  function uiSelect({ title, label, options, okLabel = 'OK' }) {
    const select = el('select', 'select');
    for (const opt of options) {
      const o = el('option', null, opt.label);
      o.value = opt.value;
      select.appendChild(o);
    }
    return openModal({
      title,
      content: [el('label', 'field-label', label), select],
      initialFocus: select,
      buttons: [
        { label: 'Hủy', value: null },
        { label: okLabel, kind: 'primary', primary: true, value: () => select.value },
      ],
    });
  }

  // ================= Cây thư mục =================

  async function loadTree() {
    const res = await api('/api/files/tree');
    if (!res.ok) {
      toastError(await errorMessage(res));
      return;
    }
    state.treeJson = await res.text();
    state.tree = JSON.parse(state.treeJson);
    renderTree();
  }

  // Tự cập nhật cây khi người khác thêm/xóa/đổi tên: định kỳ khi tab đang mở và ngay khi quay lại tab.
  // Chỉ vẽ lại khi cây thật sự đổi; bỏ qua lúc đang mở menu, hộp thoại hoặc kéo thả để không làm phiền.
  const TREE_REFRESH_MS = backend ? backend.refreshMs : 5000;
  let refreshing = false;

  async function refreshTreeQuietly() {
    if (refreshing || document.hidden || !state.tree) return;
    if (els.modalRoot.childElementCount || !els.menu.hidden || document.querySelector('.tree-row.dragging')) return;
    refreshing = true;
    try {
      const res = await api('/api/files/tree');
      if (!res.ok) return;
      const json = await res.text();
      if (json === state.treeJson) return;
      state.treeJson = json;
      state.tree = JSON.parse(json);
      renderTree();
      if (els.search.value.trim()) await runSearch();
    } catch { /* mất mạng tạm thời: lần sau thử lại */ } finally {
      refreshing = false;
    }
  }

  function renderTree() {
    if (!state.tree) return;
    const focusedPath = els.tree.contains(document.activeElement) ? document.activeElement.dataset.path : null;
    els.tree.replaceChildren(renderNode({ ...state.tree, name: ROOT_NAME }));
    updateTargetHint();
    if (focusedPath != null) focusRow(focusedPath);
  }

  const rowFor = (path) => els.tree.querySelector(`.tree-row[data-path="${CSS.escape(path)}"]`);
  function focusRow(path) {
    const row = rowFor(path);
    if (row) {
      row.focus({ preventScroll: true });
      row.scrollIntoView({ block: 'nearest' });
    }
  }

  function renderNode(node) {
    const li = el('li');
    li.setAttribute('role', 'none');

    const isDir = node.type === 'dir';
    const isRoot = node.path === '';
    const open = isDir && state.expanded.has(node.path);

    const row = el('button', 'tree-row');
    row.type = 'button';
    row.setAttribute('role', 'treeitem');
    row.dataset.path = node.path;
    row.dataset.type = node.type;
    row.title = node.path || '/';
    if (state.selected.path === node.path && state.selected.type === node.type) row.classList.add('selected');
    if (isDir) row.setAttribute('aria-expanded', String(open));

    const chevron = el('span', 'chevron');
    if (isDir && !isRoot) chevron.innerHTML = ICONS.chevron;
    const icon = el('span', `icon-type ${iconClass(node.path, node.type)}`);
    icon.innerHTML = iconForPath(node.path, node.type, open);
    row.append(chevron, icon, el('span', 'tree-name', node.name));

    row.addEventListener('click', () => onRowClick(node));
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (menuOpenedByLongPress()) return;
      openMenu(e, node, row);
    });
    attachLongPress(row, () => node);

    // Kéo thả để di chuyển (chuột). Trên cảm ứng nhấn giữ là mở menu nên không bật kéo.
    if (!isRoot && !isCoarse) {
      row.draggable = true;
      row.addEventListener('dragstart', (e) => {
        dragSource = node;
        e.dataTransfer.setData(INTERNAL_DRAG, node.path);
        e.dataTransfer.setData('text/plain', node.path);
        e.dataTransfer.effectAllowed = 'move';
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        dragSource = null;
        clearDrop();
      });
    }

    li.appendChild(row);

    if (isDir && open) {
      const ul = el('ul');
      ul.setAttribute('role', 'group');
      if (node.children && node.children.length) node.children.forEach((child) => ul.appendChild(renderNode(child)));
      else ul.appendChild(el('li', 'tree-empty', 'Trống'));
      li.appendChild(ul);
    }
    return li;
  }

  function onRowClick(node) {
    if (node.type === 'dir') {
      state.selected = { path: node.path, type: 'dir' };
      toggleExpanded(node.path);
      renderTree();
    } else {
      goToFile(node.path);
    }
  }

  function toggleExpanded(path, force) {
    if (path === '') return;
    const open = force ?? !state.expanded.has(path);
    if (open) state.expanded.add(path);
    else state.expanded.delete(path);
    saveExpanded();
  }

  function expandTo(path) {
    for (let p = path; p; p = parentOf(p)) state.expanded.add(p);
    saveExpanded();
  }

  // Thư mục đích cho "File mới"/"Thư mục"/"Tải lên": thư mục đang chọn, hoặc thư mục chứa file đang chọn.
  const targetFolder = () => state.selected.type === 'dir' ? state.selected.path : parentOf(state.selected.path);

  function updateTargetHint() {
    const label = el('strong', null, folderLabel(targetFolder()));
    const tail = isCoarse ? ' · nhấn giữ để xem thêm' : ' · chuột phải để xem thêm';
    els.hint.replaceChildren('Lưu vào: ', label, tail);
    els.hint.title = 'Bấm vào thư mục ở cây để đổi nơi lưu.';
  }

  function listFolders(node, out = []) {
    if (node && node.type === 'dir') {
      out.push(node.path);
      (node.children || []).forEach((c) => listFolders(c, out));
    }
    return out;
  }

  // Bàn phím trong cây / kết quả tìm kiếm.
  els.treeScroll.addEventListener('keydown', (e) => {
    const inResults = els.tree.hidden;
    const rows = [...els.treeScroll.querySelectorAll(inResults ? '.search-hit' : '.tree-row')];
    const i = rows.indexOf(document.activeElement);
    if (i < 0) return;
    const row = rows[i];

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      rows[Math.min(i + 1, rows.length - 1)].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (i === 0 && inResults) els.search.focus();
      else rows[Math.max(i - 1, 0)].focus();
    } else if (!inResults && e.key === 'ArrowRight' && row.dataset.type === 'dir') {
      e.preventDefault();
      if (!state.expanded.has(row.dataset.path)) {
        toggleExpanded(row.dataset.path, true);
        renderTree();
      } else {
        rows[i + 1]?.focus();
      }
    } else if (!inResults && e.key === 'ArrowLeft') {
      e.preventDefault();
      const path = row.dataset.path;
      if (row.dataset.type === 'dir' && path && state.expanded.has(path)) {
        toggleExpanded(path, false);
        renderTree();
      } else if (path) {
        focusRow(parentOf(path));
      }
    }
  });

  // ================= Tìm kiếm =================

  let searchTimer = null;
  let searchSeq = 0;

  els.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch().catch(handleError), 200);
  });
  els.search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      clearSearch();
      els.search.blur();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      els.treeScroll.querySelector(els.tree.hidden ? '.search-hit' : '.tree-row')?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(searchTimer);
      runSearch().then(() => els.results.querySelector('.search-hit')?.click()).catch(handleError);
    }
  });

  async function runSearch() {
    const q = els.search.value.trim();
    const seq = ++searchSeq;
    if (!q) {
      showTreeView();
      return;
    }
    const res = await api(`/api/files/search?q=${enc(q)}`);
    if (seq !== searchSeq) return; // đã có lượt tìm mới hơn
    if (!res.ok) {
      toastError(await errorMessage(res));
      return;
    }
    renderResults(await res.json(), q);
  }

  function renderResults(hits, q) {
    els.tree.hidden = true;
    els.results.hidden = false;
    if (!hits.length) {
      els.results.replaceChildren(el('div', 'search-empty', `Không tìm thấy “${q}”`));
      return;
    }
    const head = el('div', 'search-head', `${hits.length}${hits.length >= 100 ? '+' : ''} kết quả`);
    els.results.replaceChildren(head, ...hits.map(renderHit));
  }

  function appendHighlighted(target, text, start, length) {
    if (start < 0 || start >= text.length) {
      target.textContent = text;
      return;
    }
    target.append(text.slice(0, start), el('mark', null, text.slice(start, start + length)), text.slice(start + length));
  }

  function renderHit(hit) {
    const btn = el('button', 'search-hit');
    btn.type = 'button';
    const top = el('div', 'hit-top');
    const icon = el('span', `icon-type ${iconClass(hit.path, hit.type)}`);
    icon.innerHTML = iconForPath(hit.path, hit.type, false);
    const name = el('span', 'hit-name');
    if (hit.snippet) name.textContent = hit.name;
    else appendHighlighted(name, hit.name, hit.matchStart, hit.matchLength);
    top.append(icon, name);
    btn.append(top, el('div', 'hit-path', folderLabel(parentOf(hit.path)) + (hit.line ? ` · dòng ${hit.line}` : '')));
    if (hit.snippet) {
      const snippet = el('div', 'hit-snippet');
      appendHighlighted(snippet, hit.snippet, hit.matchStart, hit.matchLength);
      btn.appendChild(snippet);
    }
    btn.addEventListener('click', () => {
      if (hit.type === 'dir') {
        clearSearch();
        expandTo(hit.path);
        state.selected = { path: hit.path, type: 'dir' };
        renderTree();
        focusRow(hit.path);
      } else {
        goToFile(hit.path);
      }
    });
    return btn;
  }

  function clearSearch() {
    els.search.value = '';
    searchSeq++;
    showTreeView();
  }

  function showTreeView() {
    els.results.hidden = true;
    els.results.replaceChildren();
    els.tree.hidden = false;
  }

  function focusSearch() {
    openDrawer();
    els.search.focus();
    els.search.select();
  }

  // ================= Điều hướng (URL dạng #/thư-mục/file.md) =================

  const pathFromHash = () => {
    if (!location.hash.startsWith('#/')) return '';
    try { return decodeURIComponent(location.hash.slice(2)); } catch { return ''; }
  };
  const hashFor = (path) => '#/' + path.split('/').map(enc).join('/');
  let currentHash = location.hash;

  function setHashSilently(path) {
    history.replaceState(null, '', path ? hashFor(path) : location.pathname + location.search);
    currentHash = location.hash;
  }

  function goToFile(path) {
    if (pathFromHash() === path) {
      openFileAt(path).catch(handleError);
    } else {
      location.hash = hashFor(path);
    }
  }

  window.addEventListener('hashchange', async () => {
    const path = pathFromHash();
    if (state.editing && state.dirty && path !== state.openFile) {
      if (!await confirmDiscard()) {
        history.replaceState(null, '', currentHash || location.pathname);
        return;
      }
      clearDraft();
    }
    currentHash = location.hash;
    if (path) await openFileAt(path).catch(handleError);
    else showEmptyState();
  });

  // ================= Xem file =================

  async function openFileAt(path) {
    if (state.editing && state.openFile === path) return;
    stopEditing(true);
    expandTo(parentOf(path));
    state.selected = { path, type: 'file' };
    renderTree();
    closeDrawer();

    if (isImage(path)) {
      showImage(path);
      return;
    }

    const res = await api(`/api/files/read?path=${enc(path)}`);
    if (!res.ok) {
      toastError(await errorMessage(res));
      if (res.status === 404 || res.status === 400) {
        setHashSilently('');
        showEmptyState();
      }
      return;
    }
    state.openFile = path;
    state.version = res.headers.get('X-File-Version') || '';
    state.content = await res.text();
    document.title = `${nameOf(path)} · SaveMarkdown`;
    renderPath(path);
    renderView();
    renderActions();
    els.viewer.scrollTop = 0;

    if (state.pendingEdit === path) {
      state.pendingEdit = null;
      startEditing();
    }
  }

  function showImage(path) {
    state.openFile = path;
    state.content = '';
    state.version = '';
    document.title = `${nameOf(path)} · SaveMarkdown`;
    renderPath(path);
    const figure = el('figure', 'image-view');
    const img = el('img');
    setRawUrl(img, 'src', path);
    img.alt = nameOf(path);
    figure.appendChild(img);
    els.doc.replaceChildren(figure);
    els.toc.hidden = true;
    renderActions();
    els.viewer.scrollTop = 0;
  }

  function showEmptyState() {
    stopEditing(true);
    state.openFile = '';
    state.content = '';
    state.version = '';
    document.title = 'SaveMarkdown';
    els.path.replaceChildren();
    els.actions.replaceChildren();
    els.toc.hidden = true;

    const box = el('div', 'empty-state');
    box.innerHTML = ICONS.file;
    box.appendChild(el('p', null, 'Chọn một file ở bên trái để xem, hoặc tạo file mới.'));
    const btn = el('button', 'btn btn-primary');
    btn.type = 'button';
    btn.innerHTML = ICONS.filePlus;
    btn.append('File mới');
    btn.addEventListener('click', () => createFile(targetFolder()).catch(handleError));
    box.appendChild(btn);
    if (!isCoarse) {
      const tip = el('p', 'tip');
      tip.append('Nhấn ', el('kbd', null, '?'), ' để xem phím tắt');
      box.appendChild(tip);
    }
    els.doc.replaceChildren(box);
  }

  function renderPath(path) {
    const parts = path.split('/');
    els.path.replaceChildren(...parts.flatMap((part, i) => {
      const span = el('span', i === parts.length - 1 ? 'current' : null, part);
      return i === 0 ? [span] : [el('span', 'sep', '/'), span];
    }));
  }

  function actionButton(label, icon, onClick, className, shortcut) {
    const btn = el('button', className);
    btn.type = 'button';
    btn.innerHTML = icon;
    btn.appendChild(el('span', 'btn-label', label));
    btn.title = shortcut ? `${label} (${shortcut})` : label;
    btn.setAttribute('aria-label', label);
    btn.addEventListener('click', () => Promise.resolve(onClick()).catch(handleError));
    return btn;
  }

  function renderActions() {
    if (!state.openFile) {
      els.actions.replaceChildren();
      return;
    }
    if (state.editing) {
      const status = el('span', 'save-state');
      status.id = 'save-state';
      els.actions.replaceChildren(
        status,
        actionButton('Đóng', ICONS.x, closeEditor, 'btn', 'Esc'),
        actionButton('Lưu', ICONS.save, saveEditor, 'btn btn-primary', 'Ctrl+S'));
      updateDirtyIndicator();
      return;
    }
    const buttons = [];
    if (isText(state.openFile)) buttons.push(actionButton('Sửa', ICONS.pencil, startEditing, 'btn', 'E'));
    if (githubUrl(state.openFile, 'file')) {
      buttons.push(actionButton('Copy link', ICONS.link, () => copyGithubLink(state.openFile, 'file'), 'btn'));
    }
    buttons.push(actionButton('Tải về', ICONS.download, () => downloadFile(state.openFile), 'btn btn-primary'));
    els.actions.replaceChildren(...buttons);
  }

  function renderView() {
    if (extOf(state.openFile) === '.txt') {
      const pre = el('pre', 'plain', state.content);
      els.doc.replaceChildren(pre);
      els.toc.hidden = true;
      return;
    }
    renderMarkdownInto(els.doc, state.content, parentOf(state.openFile), true);
    buildToc();
  }

  // ---------- Render markdown ----------

  function resolveRelative(baseDir, href) {
    let target = href.split(/[?#]/)[0];
    try { target = decodeURIComponent(target); } catch { /* giữ nguyên */ }
    if (!target) return null;
    const parts = target.startsWith('/') ? [] : (baseDir ? baseDir.split('/') : []);
    for (const seg of target.split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') {
        if (!parts.length) return null; // ra ngoài thư mục gốc
        parts.pop();
      } else {
        parts.push(seg);
      }
    }
    return parts.join('/');
  }

  function renderMarkdownInto(container, text, baseDir, interactive) {
    if (!(window.marked && window.DOMPurify)) {
      container.replaceChildren(el('pre', 'plain', text));
      return;
    }
    container.innerHTML = DOMPurify.sanitize(marked.parse(text, { gfm: true }));

    // Tiêu đề: gán id để mục lục / link #... nhảy tới.
    const used = new Map();
    container.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
      let slug = slugify(h.textContent) || 'muc';
      const n = used.get(slug) || 0;
      used.set(slug, n + 1);
      if (n) slug += '-' + n;
      h.id = (interactive ? 'h-' : 'p-') + slug;
    });

    // Link: ngoài -> tab mới; #... -> cuộn tới; file .md tương đối -> mở trong app.
    container.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href');
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      } else if (href.startsWith('#')) {
        a.addEventListener('click', (e) => {
          e.preventDefault();
          let frag = href.slice(1);
          try { frag = decodeURIComponent(frag); } catch { /* giữ nguyên */ }
          container.querySelector(`#${CSS.escape((interactive ? 'h-' : 'p-') + slugify(frag))}`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      } else {
        const target = resolveRelative(baseDir, href);
        if (target == null) return;
        if (isText(target)) {
          a.setAttribute('href', hashFor(target));
        } else if (isImage(target)) {
          setRawUrl(a, 'href', target);
          a.target = '_blank';
        }
      }
    });

    // Ảnh tương đối (cùng thư mục với file) -> lấy qua API.
    container.querySelectorAll('img[src]').forEach((img) => {
      const src = img.getAttribute('src');
      img.loading = 'lazy';
      if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) return;
      const target = resolveRelative(baseDir, src);
      if (target != null) setRawUrl(img, 'src', target);
    });

    // Code: tô màu + nút copy.
    container.querySelectorAll('pre > code').forEach((code) => {
      if (window.hljs) {
        try { hljs.highlightElement(code); } catch { /* bỏ qua */ }
      }
      const pre = code.parentElement;
      const wrap = el('div', 'code-block');
      pre.replaceWith(wrap);
      wrap.appendChild(pre);
      const btn = el('button', 'copy-btn');
      btn.type = 'button';
      btn.innerHTML = ICONS.copy;
      btn.title = 'Copy';
      btn.setAttribute('aria-label', 'Copy code');
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(code.textContent);
          btn.innerHTML = ICONS.check;
          btn.classList.add('done');
          setTimeout(() => {
            btn.innerHTML = ICONS.copy;
            btn.classList.remove('done');
          }, 1500);
        } catch {
          toastError('Không copy được');
        }
      });
      wrap.appendChild(btn);
    });

    // Checklist "- [ ]": bấm để tick và lưu ngay (chỉ ở chế độ xem).
    container.querySelectorAll('li input[type="checkbox"]').forEach((box, index) => {
      box.closest('li').classList.add('task-item');
      if (!interactive) return;
      box.disabled = false;
      box.addEventListener('change', () => toggleTask(index, box.checked, box).catch(handleError));
    });
  }

  async function toggleTask(index, checked, box) {
    const lines = state.content.split('\n');
    let fence = null;
    let count = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const f = /^\s*(`{3,}|~{3,})/.exec(line);
      if (f) {
        if (!fence) fence = f[1][0];
        else if (f[1][0] === fence) fence = null;
        continue;
      }
      if (fence) continue; // checklist trong khối code không tính
      const m = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/.exec(line);
      if (m && ++count === index) {
        lines[i] = m[1] + (checked ? '[x]' : '[ ]') + line.slice(m[0].length);
        const ok = await saveContent(lines.join('\n'), { quiet: true });
        if (!ok) box.checked = !checked;
        return;
      }
    }
    box.checked = !checked;
  }

  // ---------- Mục lục ----------

  let tocLinks = [];
  function buildToc() {
    const heads = [...els.doc.querySelectorAll('h1, h2, h3')];
    if (heads.length < 2) {
      els.toc.hidden = true;
      els.toc.replaceChildren();
      tocLinks = [];
      return;
    }
    const minLevel = Math.min(...heads.map((h) => +h.tagName[1]));
    const list = el('ul', 'toc-list');
    tocLinks = heads.map((h) => {
      const li = el('li', `toc-item level-${+h.tagName[1] - minLevel}`);
      const a = el('a', null, h.textContent);
      a.href = '#';
      a.addEventListener('click', (e) => {
        e.preventDefault();
        h.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      li.appendChild(a);
      list.appendChild(li);
      return { a, h };
    });
    els.toc.replaceChildren(el('div', 'toc-title', 'Mục lục'), list);
    els.toc.hidden = false;
    updateTocActive();
  }

  function updateTocActive() {
    if (!tocLinks.length || els.toc.hidden) return;
    const top = els.viewer.getBoundingClientRect().top + 90;
    let active = tocLinks[0];
    for (const item of tocLinks) {
      if (item.h.getBoundingClientRect().top <= top) active = item;
      else break;
    }
    tocLinks.forEach((item) => item.a.classList.toggle('active', item === active));
  }

  let tocFrame = 0;
  els.viewer.addEventListener('scroll', () => {
    cancelAnimationFrame(tocFrame);
    tocFrame = requestAnimationFrame(updateTocActive);
  }, { passive: true });

  // ================= Soạn thảo =================

  async function saveContent(content, { quiet = false, force = false } = {}) {
    const path = state.openFile;
    const res = await apiJson('/api/files/content', 'PUT', { path, content, version: state.version, force });
    if (res.status === 409 && !force) {
      const overwrite = await uiConfirm({
        title: 'File đã thay đổi',
        message: 'File này vừa được sửa ở nơi khác (thiết bị hoặc tab khác). Ghi đè bằng nội dung của bạn?',
        okLabel: 'Ghi đè',
        danger: true,
      });
      return overwrite ? saveContent(content, { quiet, force: true }) : false;
    }
    if (!res.ok) {
      toastError(await errorMessage(res));
      return false;
    }
    const body = await res.json();
    if (path === state.openFile) {
      state.version = body.version;
      state.content = content;
    }
    if (!quiet) toast('Đã lưu');
    return true;
  }

  async function startEditing() {
    if (!state.openFile || !isText(state.openFile) || state.editing) return;
    let initial = state.content;
    let restoredDraft = false;

    const draft = store.get('draft', null);
    if (draft && draft.path === state.openFile && draft.content !== state.content) {
      restoredDraft = await uiConfirm({
        title: 'Khôi phục bản nháp?',
        message: 'Có bản nháp chưa lưu của file này từ lần sửa trước. Khôi phục để sửa tiếp?',
        okLabel: 'Khôi phục',
      });
      if (restoredDraft) initial = draft.content;
      else clearDraft();
    }

    state.editing = true;
    state.dirty = restoredDraft;
    els.editorInput.value = initial;
    els.viewer.classList.add('editing');
    els.doc.hidden = true;
    els.toc.hidden = true;
    els.editor.hidden = false;
    setEditorTab('write');
    renderPreview();
    renderActions();
    els.viewer.scrollTop = 0;
    els.editorInput.focus();
    els.editorInput.setSelectionRange(0, 0);
    els.editorInput.scrollTop = 0;
  }

  function stopEditing(silent = false) {
    if (!state.editing) return;
    state.editing = false;
    state.dirty = false;
    clearTimeout(previewTimer);
    clearTimeout(draftTimer);
    els.viewer.classList.remove('editing');
    els.editor.hidden = true;
    els.doc.hidden = false;
    els.editorPreview.replaceChildren();
    if (!silent) {
      renderView();
      renderActions();
    }
  }

  const confirmDiscard = () => uiConfirm({
    title: 'Bỏ thay đổi?',
    message: 'Bạn có thay đổi chưa lưu. Bỏ các thay đổi này?',
    okLabel: 'Bỏ thay đổi',
    danger: true,
  });

  async function closeEditor() {
    if (state.dirty) {
      if (!await confirmDiscard()) return;
      clearDraft();
    }
    stopEditing();
  }

  async function saveEditor() {
    if (!state.editing) return;
    const ok = await saveContent(els.editorInput.value);
    if (ok && state.editing) {
      state.dirty = false;
      clearDraft();
      updateDirtyIndicator();
    }
  }

  function updateDirtyIndicator() {
    const status = document.getElementById('save-state');
    if (!status) return;
    status.textContent = state.dirty ? '● Chưa lưu' : 'Đã lưu';
    status.classList.toggle('dirty', state.dirty);
  }

  // Nháp tự lưu vào trình duyệt để không mất chữ khi lỡ đóng tab / mất phiên.
  let draftTimer = null;
  function saveDraftNow() {
    store.set('draft', { path: state.openFile, content: els.editorInput.value });
  }
  function clearDraft() {
    clearTimeout(draftTimer);
    store.remove('draft');
  }

  let previewTimer = null;
  function renderPreview() {
    renderMarkdownInto(els.editorPreview, els.editorInput.value, parentOf(state.openFile), false);
  }

  els.editorInput.addEventListener('input', () => {
    if (!state.dirty) {
      state.dirty = true;
      updateDirtyIndicator();
    }
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 250);
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraftNow, 800);
  });

  function setEditorTab(tab) {
    els.editor.dataset.tab = tab;
    els.editorToolbar.querySelectorAll('.editor-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    if (tab === 'preview') renderPreview();
  }

  // Thay đoạn chữ, giữ được Ctrl+Z (execCommand), có dự phòng setRangeText.
  function replaceRange(start, end, text, selStart, selEnd) {
    const ta = els.editorInput;
    ta.focus();
    ta.setSelectionRange(start, end);
    const ok = document.execCommand && document.execCommand('insertText', false, text);
    if (!ok) {
      ta.setRangeText(text, start, end, 'end');
      ta.dispatchEvent(new Event('input'));
    }
    ta.setSelectionRange(selStart, selEnd);
  }

  function wrapSelection(before, after, placeholder) {
    const { selectionStart: s, selectionEnd: e, value } = els.editorInput;
    const selected = value.slice(s, e) || placeholder;
    replaceRange(s, e, before + selected + after, s + before.length, s + before.length + selected.length);
  }

  function prefixLines(prefix) {
    const ta = els.editorInput;
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    let lineEnd = value.indexOf('\n', e);
    if (lineEnd < 0) lineEnd = value.length;
    const lines = value.slice(lineStart, lineEnd).split('\n');
    const allHave = lines.every((l) => l.startsWith(prefix));
    const block = lines.map((l) => (allHave ? l.slice(prefix.length) : prefix + l)).join('\n');
    replaceRange(lineStart, lineEnd, block, lineStart + block.length, lineStart + block.length);
  }

  function wrapCode() {
    const { selectionStart: s, selectionEnd: e, value } = els.editorInput;
    if (value.slice(s, e).includes('\n')) wrapSelection('```\n', '\n```', '');
    else wrapSelection('`', '`', 'code');
  }

  const EDITOR_TOOLS = [
    { icon: ICONS.bold, label: 'Đậm (Ctrl+B)', run: () => wrapSelection('**', '**', 'chữ đậm') },
    { icon: ICONS.italic, label: 'Nghiêng (Ctrl+I)', run: () => wrapSelection('*', '*', 'chữ nghiêng') },
    { icon: ICONS.heading, label: 'Tiêu đề', run: () => prefixLines('## ') },
    'sep',
    { icon: ICONS.list, label: 'Danh sách', run: () => prefixLines('- ') },
    { icon: ICONS.listChecks, label: 'Checklist', run: () => prefixLines('- [ ] ') },
    { icon: ICONS.quote, label: 'Trích dẫn', run: () => prefixLines('> ') },
    'sep',
    { icon: ICONS.code, label: 'Code', run: wrapCode },
    { icon: ICONS.link, label: 'Link', run: () => wrapSelection('[', '](https://)', 'tên link') },
  ];

  function buildEditorToolbar() {
    const items = EDITOR_TOOLS.map((tool) => {
      if (tool === 'sep') return el('span', 'tool-sep');
      const btn = el('button', 'tool');
      btn.type = 'button';
      btn.innerHTML = tool.icon;
      btn.title = tool.label;
      btn.setAttribute('aria-label', tool.label);
      // Giữ focus ở ô soạn thảo khi bấm nút.
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', tool.run);
      return btn;
    });
    const tabs = el('div', 'editor-tabs');
    for (const [tab, label] of [['write', 'Soạn'], ['preview', 'Xem trước']]) {
      const b = el('button', null, label);
      b.type = 'button';
      b.dataset.tab = tab;
      b.addEventListener('click', () => setEditorTab(tab));
      tabs.appendChild(b);
    }
    els.editorToolbar.replaceChildren(...items, tabs);
  }

  els.editorInput.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const ta = els.editorInput;
    if (mod && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      wrapSelection('**', '**', 'chữ đậm');
    } else if (mod && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      wrapSelection('*', '*', 'chữ nghiêng');
    } else if (e.key === 'Tab' && !mod && !e.altKey) {
      e.preventDefault();
      if (!e.shiftKey) replaceRange(ta.selectionStart, ta.selectionEnd, '  ', ta.selectionStart + 2, ta.selectionStart + 2);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeEditor().catch(handleError);
    } else if (e.key === 'Enter' && !e.shiftKey && !mod && !e.altKey && ta.selectionStart === ta.selectionEnd) {
      // Enter trong danh sách: tự thêm gạch đầu dòng; dòng trống thì kết thúc danh sách.
      const s = ta.selectionStart;
      const lineStart = ta.value.lastIndexOf('\n', s - 1) + 1;
      const line = ta.value.slice(lineStart, s);
      const m = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?/.exec(line);
      if (!m) return;
      e.preventDefault();
      if (line.length === m[0].length) {
        replaceRange(lineStart, s, '', lineStart, lineStart);
        return;
      }
      let marker = m[2];
      if (/^\d/.test(marker)) marker = (parseInt(marker, 10) + 1) + marker.slice(-1);
      const insert = '\n' + m[1] + marker + m[3] + (m[4] ? '[ ] ' : '');
      replaceRange(s, s, insert, s + insert.length, s + insert.length);
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (state.editing && state.dirty) {
      saveDraftNow();
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ================= Thao tác file =================

  async function downloadUrl(url, fallbackName) {
    const res = await api(url);
    if (!res.ok) {
      toastError(await errorMessage(res));
      return;
    }
    let name = fallbackName;
    const disposition = res.headers.get('Content-Disposition') || '';
    const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
    const plain = /filename="?([^";]+)"?/i.exec(disposition);
    if (star) {
      try { name = decodeURIComponent(star[1]); } catch { /* giữ tên mặc định */ }
    } else if (plain) {
      name = plain[1];
    }
    const blobUrl = URL.createObjectURL(await res.blob());
    const a = el('a');
    a.href = blobUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
  }

  // Link chia sẻ: ưu tiên mở thẳng trong bản web SaveMarkdown (appUrl, cần đăng nhập),
  // không có thì dùng GitHub Pages của repo tài liệu; null nếu chưa bật đồng bộ git.
  // Không có trang cho từng thư mục: chỉ thư mục gốc có link.
  function githubUrl(path, type) {
    const git = state.git;
    if (!git || !git.enabled) return null;
    if (git.appUrl) return path ? (type === 'dir' ? null : git.appUrl + hashFor(path)) : git.appUrl;
    if (!git.pagesUrl) return null;
    if (!path) return `${git.pagesUrl}/`;
    if (type === 'dir') return null;
    const encoded = path.split('/').map(enc).join('/').replace(/\.(md|markdown)$/i, '.html');
    return `${git.pagesUrl}/${encoded}`;
  }

  async function copyGithubLink(path, type) {
    const url = githubUrl(path, type);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast(backend ? 'Đã copy link.' : 'Đã copy link. Thay đổi mới sẽ lên GitHub sau vài giây.');
    } catch {
      await uiPrompt({ title: 'Link chia sẻ', label: 'Copy link bên dưới', value: url, okLabel: 'Đóng' });
    }
  }

  const downloadFile = (path) => downloadUrl(`/api/files/download?path=${enc(path)}`, nameOf(path));
  const downloadZip = (path) => downloadUrl(`/api/files/zip?path=${enc(path)}`, `${path ? nameOf(path) : 'SaveMarkdown'}.zip`);

  async function editFile(path) {
    if (state.openFile === path && !state.editing) {
      await startEditing();
      return;
    }
    state.pendingEdit = path;
    goToFile(path);
  }

  async function createFile(parent) {
    const suggested = 'ghi-chu-moi';
    let name = await uiPrompt({
      title: 'File mới',
      label: `Tên file (trong ${folderLabel(parent)})`,
      value: `${suggested}.md`,
      okLabel: 'Tạo',
      selectRange: [0, suggested.length],
    });
    if (!name) return;
    if (!isText(name)) name += '.md';
    const res = await apiJson('/api/files/file', 'POST', { path: join(parent, name) });
    if (!res.ok) {
      toastError(await errorMessage(res));
      return;
    }
    const { path } = await res.json();
    clearSearch();
    expandTo(parent);
    await loadTree();
    state.pendingEdit = path;
    goToFile(path);
  }

  async function createFolder(parent) {
    const name = await uiPrompt({ title: 'Thư mục mới', label: `Tên thư mục (trong ${folderLabel(parent)})`, okLabel: 'Tạo' });
    if (!name) return;
    const res = await apiJson('/api/files/folder', 'POST', { path: join(parent, name) });
    if (!res.ok) {
      toastError(await errorMessage(res));
      return;
    }
    const { path } = await res.json();
    clearSearch();
    expandTo(path);
    state.selected = { path, type: 'dir' };
    await loadTree();
    toast(`Đã tạo thư mục "${name}"`);
  }

  async function renameItem(node) {
    const name = nameOf(node.path);
    const dot = node.type === 'file' ? name.lastIndexOf('.') : -1;
    const newName = await uiPrompt({
      title: node.type === 'dir' ? 'Đổi tên thư mục' : 'Đổi tên file',
      label: 'Tên mới',
      value: name,
      okLabel: 'Đổi tên',
      selectRange: [0, dot > 0 ? dot : name.length],
    });
    if (!newName || newName === name) return;
    if (await moveItem(node, join(parentOf(node.path), newName))) toast('Đã đổi tên');
  }

  async function moveDialog(node) {
    const folders = listFolders(state.tree).filter((f) =>
      f !== parentOf(node.path) && (node.type !== 'dir' || (f !== node.path && !f.startsWith(node.path + '/'))));
    if (!folders.length) {
      toast('Không có thư mục nào khác để chuyển tới');
      return;
    }
    const dest = await uiSelect({
      title: `Di chuyển "${nameOf(node.path)}"`,
      label: 'Tới thư mục',
      options: folders.map((f) => ({ value: f, label: folderLabel(f) })),
      okLabel: 'Di chuyển',
    });
    if (dest == null) return;
    if (await moveItem(node, join(dest, nameOf(node.path)))) {
      expandTo(dest);
      renderTree();
      toast(`Đã chuyển tới ${folderLabel(dest)}`);
    }
  }

  async function moveItem(node, to) {
    const res = await apiJson('/api/files/move', 'POST', { from: node.path, to });
    if (!res.ok) {
      toastError(await errorMessage(res));
      return false;
    }
    const { path: newPath } = await res.json();
    remapPath(node.path, newPath);
    await loadTree();
    return true;
  }

  // Sau khi đổi tên/di chuyển: cập nhật các đường dẫn đang nhớ (thư mục mở, file đang xem...).
  function remapPath(from, to) {
    const map = (p) => (p === from ? to : p.startsWith(from + '/') ? to + p.slice(from.length) : null);
    state.expanded = new Set([...state.expanded].map((p) => map(p) ?? p));
    saveExpanded();
    const selected = map(state.selected.path);
    if (selected != null) state.selected = { ...state.selected, path: selected };
    const open = map(state.openFile);
    if (open != null) {
      state.openFile = open;
      renderPath(open);
      setHashSilently(open);
      document.title = `${nameOf(open)} · SaveMarkdown`;
    }
  }

  // Xóa = chuyển vào thùng rác, kèm nút "Hoàn tác" trên toast.
  async function removeItem(node) {
    const affectsOpen = state.openFile === node.path || state.openFile.startsWith(node.path + '/');
    if (affectsOpen && state.editing && state.dirty && !await confirmDiscard()) return;

    const res = await api(`/api/files?path=${enc(node.path)}`, { method: 'DELETE' });
    if (!res.ok) {
      toastError(await errorMessage(res));
      return;
    }
    const { trashId } = await res.json();
    if (affectsOpen) {
      clearDraft();
      setHashSilently('');
      showEmptyState();
    }
    if (state.selected.path === node.path || state.selected.path.startsWith(node.path + '/')) {
      state.selected = { path: parentOf(node.path), type: 'dir' };
    }
    await loadTree();
    if (els.search.value.trim()) await runSearch();
    toast(`Đã chuyển "${nameOf(node.path)}" vào thùng rác`, {
      action: { label: 'Hoàn tác', run: () => restoreTrash(trashId, true) },
    });
  }

  async function restoreTrash(id, reopen = false) {
    const res = await apiJson('/api/trash/restore', 'POST', { id });
    if (!res.ok) {
      toastError(await errorMessage(res));
      return false;
    }
    const { path } = await res.json();
    expandTo(parentOf(path));
    await loadTree();
    toast(`Đã khôi phục "${nameOf(path)}"`);
    if (reopen && (isText(path) || isImage(path)) && !state.openFile) goToFile(path);
    return true;
  }

  // ---------- Tải lên (nút, menu, kéo thả) ----------

  function pickFiles(folder) {
    state.uploadFolder = folder;
    els.fileInput.click();
  }

  els.fileInput.addEventListener('change', () => {
    const files = [...els.fileInput.files];
    els.fileInput.value = '';
    if (files.length) upload(files, state.uploadFolder).catch(handleError);
  });

  async function upload(files, folder, overwrite = false) {
    const form = new FormData();
    form.append('folder', folder);
    if (overwrite) form.append('overwrite', 'true');
    for (const f of files) form.append('files', f, f.name);

    const res = await api('/api/files/upload', { method: 'POST', body: form });
    if (res.status === 409 && !overwrite) {
      const body = await res.json().catch(() => ({}));
      const ok = await uiConfirm({
        title: 'File đã tồn tại',
        message: `Đã có: ${(body.existing || []).join(', ')}. Ghi đè các file này?`,
        okLabel: 'Ghi đè',
        danger: true,
      });
      if (ok) await upload(files, folder, true);
      return;
    }
    if (!res.ok) {
      toastError(await errorMessage(res));
      return;
    }
    expandTo(folder);
    await loadTree();
    toast(`Đã tải lên ${files.length} file vào ${folderLabel(folder)}`);
  }

  // ================= Thùng rác =================

  function timeAgo(iso) {
    const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
    const rtf = new Intl.RelativeTimeFormat('vi', { numeric: 'auto' });
    const units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
    for (const [unit, size] of units) {
      if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
    }
    return 'vừa xong';
  }

  async function showTrash() {
    const list = el('div', 'trash-list');
    const note = el('p', 'trash-note', backend ? backend.trashNote : 'Mục trong thùng rác tự xóa hẳn sau 30 ngày.');
    let emptyButton = null;

    async function refresh() {
      const res = await api('/api/trash');
      if (!res.ok) {
        toastError(await errorMessage(res));
        return;
      }
      const items = await res.json();
      if (emptyButton) emptyButton.disabled = !items.length;
      if (!items.length) {
        list.replaceChildren(el('div', 'trash-empty', 'Thùng rác trống'));
        return;
      }
      list.replaceChildren(...items.map((item) => {
        const row = el('div', 'trash-item');
        const icon = el('span', `icon-type ${iconClass(item.originalPath, item.type)}`);
        icon.innerHTML = iconForPath(item.originalPath, item.type, false);
        const info = el('div', 'trash-info');
        info.append(el('div', 'trash-name', item.name), el('div', 'trash-meta', `${folderLabel(parentOf(item.originalPath))} · ${timeAgo(item.deletedAt)}`));

        const restore = el('button', 'icon-btn');
        restore.type = 'button';
        restore.innerHTML = ICONS.restore;
        restore.title = 'Khôi phục';
        restore.setAttribute('aria-label', `Khôi phục ${item.name}`);
        restore.addEventListener('click', async () => {
          if (await restoreTrash(item.id)) await refresh();
        });

        const remove = el('button', 'icon-btn danger');
        remove.type = 'button';
        remove.innerHTML = ICONS.trash;
        remove.title = 'Xóa vĩnh viễn';
        remove.setAttribute('aria-label', `Xóa vĩnh viễn ${item.name}`);
        remove.addEventListener('click', async () => {
          const ok = await uiConfirm({ title: 'Xóa vĩnh viễn?', message: `"${item.name}" sẽ bị xóa hẳn, không khôi phục được.`, okLabel: 'Xóa vĩnh viễn', danger: true });
          if (!ok) return;
          const r = await api(`/api/trash/${enc(item.id)}`, { method: 'DELETE' });
          if (!r.ok) toastError(await errorMessage(r));
          await refresh();
        });

        row.append(icon, info, restore, remove);
        return row;
      }));
    }

    const modalPromise = openModal({
      title: 'Thùng rác',
      wide: true,
      content: [list, note],
      buttons: [
        {
          label: 'Dọn sạch thùng rác',
          kind: 'danger',
          className: 'push-left',
          value: () => {
            (async () => {
              const ok = await uiConfirm({ title: 'Dọn sạch thùng rác?', message: 'Mọi mục trong thùng rác sẽ bị xóa hẳn, không khôi phục được.', okLabel: 'Dọn sạch', danger: true });
              if (!ok) return;
              const r = await api('/api/trash', { method: 'DELETE' });
              if (!r.ok) toastError(await errorMessage(r));
              await refresh();
            })().catch(handleError);
            return undefined;
          },
        },
        { label: 'Đóng', primary: true, value: true },
      ],
      onReady: ({ footer }) => { emptyButton = footer.querySelector('.push-left'); },
    });
    list.replaceChildren(el('div', 'trash-empty', 'Đang tải…'));
    await refresh();
    await modalPromise;
  }

  // ================= Phím tắt =================

  function showShortcuts() {
    const groups = [
      ['Chung', [
        [['/'], 'Tìm kiếm'], [['Ctrl', 'K'], 'Tìm kiếm'], [['N'], 'File mới'], [['?'], 'Bảng phím tắt'],
      ]],
      ['Xem & sửa file', [
        [['E'], 'Sửa file đang mở'], [['Ctrl', 'S'], 'Lưu'], [['Ctrl', 'B'], 'Chữ đậm'],
        [['Ctrl', 'I'], 'Chữ nghiêng'], [['Esc'], 'Đóng trình soạn'],
      ]],
      ['Cây thư mục', [
        [['↑', '↓'], 'Di chuyển giữa các mục'], [['→', '←'], 'Mở / đóng thư mục'], [['Enter'], 'Mở'],
        [['F2'], 'Đổi tên'], [['Delete'], 'Chuyển vào thùng rác'], [['Shift', 'F10'], 'Mở menu'],
      ]],
    ];
    const wrap = el('div', 'shortcut-groups');
    for (const [title, rows] of groups) {
      const section = el('section');
      const dl = el('dl', 'shortcut-list');
      for (const [keys, label] of rows) {
        const dt = el('dt');
        keys.forEach((k) => dt.appendChild(el('kbd', null, k)));
        dl.append(dt, el('dd', null, label));
      }
      section.append(el('div', 'shortcut-group', title), dl);
      wrap.appendChild(section);
    }
    return openModal({ title: 'Phím tắt', wide: true, content: [wrap], buttons: [{ label: 'Đóng', primary: true, value: true }] });
  }

  // Mục đang thao tác: dòng đang focus trong cây, hoặc mục đang chọn.
  function actionTarget() {
    const row = document.activeElement?.closest?.('.tree-row');
    if (row) return { path: row.dataset.path, type: row.dataset.type };
    return state.selected.path ? { ...state.selected } : null;
  }

  document.addEventListener('keydown', (e) => {
    if (els.modalRoot.childElementCount) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'k') {
      e.preventDefault();
      focusSearch();
      return;
    }
    if (mod && key === 's') {
      e.preventDefault();
      if (state.editing) saveEditor().catch(handleError);
      return;
    }
    if (!els.menu.hidden || mod || e.altKey) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;

    if (e.key === '/') {
      e.preventDefault();
      focusSearch();
    } else if (e.key === '?') {
      e.preventDefault();
      showShortcuts();
    } else if (key === 'e' && !state.editing && state.openFile && isText(state.openFile)) {
      e.preventDefault();
      startEditing().catch(handleError);
    } else if (key === 'n' && !e.shiftKey) {
      e.preventDefault();
      createFile(targetFolder()).catch(handleError);
    } else if (e.key === 'Delete') {
      const t = actionTarget();
      if (t && t.path) {
        e.preventDefault();
        removeItem(t).catch(handleError);
      }
    } else if (e.key === 'F2') {
      const t = actionTarget();
      if (t && t.path) {
        e.preventDefault();
        renameItem(t).catch(handleError);
      }
    }
  });

  // ================= Menu chuột phải / nhấn giữ =================

  function menuItems(node) {
    const isRoot = node.path === '';
    if (node.type === 'file') {
      const items = [{ label: 'Mở', icon: ICONS.eye, action: () => goToFile(node.path) }];
      if (isText(node.path)) items.push({ label: 'Sửa', icon: ICONS.pencil, shortcut: 'E', action: () => editFile(node.path) });
      items.push({ label: 'Tải về máy', icon: ICONS.download, action: () => downloadFile(node.path) });
      if (githubUrl(node.path, 'file')) items.push({ label: 'Copy link', icon: ICONS.link, action: () => copyGithubLink(node.path, 'file') });
      items.push(
        'separator',
        { label: 'Đổi tên', icon: ICONS.rename, shortcut: 'F2', action: () => renameItem(node) },
        { label: 'Di chuyển…', icon: ICONS.move, action: () => moveDialog(node) },
        'separator',
        { label: 'Xóa', icon: ICONS.trash, danger: true, shortcut: 'Del', action: () => removeItem(node) });
      return items;
    }
    const items = [
      { label: 'File mới', icon: ICONS.filePlus, shortcut: 'N', action: () => createFile(node.path) },
      { label: 'Thư mục mới', icon: ICONS.folderPlus, action: () => createFolder(node.path) },
      { label: 'Tải file lên', icon: ICONS.upload, action: () => pickFiles(node.path) },
      { label: 'Tải về (.zip)', icon: ICONS.archive, action: () => downloadZip(node.path) },
    ];
    if (githubUrl(node.path, 'dir')) items.push({ label: 'Copy link', icon: ICONS.link, action: () => copyGithubLink(node.path, 'dir') });
    if (!isRoot) {
      items.push(
        'separator',
        { label: 'Đổi tên', icon: ICONS.rename, shortcut: 'F2', action: () => renameItem(node) },
        { label: 'Di chuyển…', icon: ICONS.move, action: () => moveDialog(node) },
        'separator',
        { label: 'Xóa thư mục', icon: ICONS.trash, danger: true, shortcut: 'Del', action: () => removeItem(node) });
    }
    return items;
  }

  let menuAnchor = null;

  function openMenu(event, node, anchor) {
    closeMenu();
    const children = [el('div', 'context-menu-title', node.path ? nameOf(node.path) : ROOT_NAME)];
    for (const item of menuItems(node)) {
      if (item === 'separator') {
        children.push(el('hr'));
        continue;
      }
      const btn = el('button', item.danger ? 'danger' : null);
      btn.type = 'button';
      btn.setAttribute('role', 'menuitem');
      btn.innerHTML = item.icon;
      btn.append(item.label);
      if (item.shortcut) btn.appendChild(el('span', 'shortcut', item.shortcut));
      btn.addEventListener('click', () => {
        closeMenu();
        Promise.resolve(item.action()).catch(handleError);
      });
      children.push(btn);
    }
    els.menu.replaceChildren(...children);

    if (anchor && anchor.classList.contains('tree-row')) {
      menuAnchor = anchor;
      anchor.classList.add('menu-open');
    }

    // Mở bằng phím Menu/Shift+F10 thì không có tọa độ chuột -> đặt cạnh dòng.
    let x = event.clientX;
    let y = event.clientY;
    if (!x && !y && anchor) {
      const rect = anchor.getBoundingClientRect();
      x = rect.left + 24;
      y = rect.bottom;
    }
    els.menu.hidden = false;
    const { width, height } = els.menu.getBoundingClientRect();
    els.menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
    els.menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
    els.menu.querySelector('button')?.focus({ preventScroll: true });
  }

  function closeMenu() {
    els.menu.hidden = true;
    if (menuAnchor) {
      menuAnchor.classList.remove('menu-open');
      menuAnchor = null;
    }
  }

  document.addEventListener('click', (e) => { if (!els.menu.contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', (e) => {
    if (els.menu.hidden) return;
    const buttons = [...els.menu.querySelectorAll('button')];
    const index = buttons.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      const anchor = menuAnchor;
      closeMenu();
      anchor?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      buttons[(index + 1) % buttons.length].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      buttons[(index - 1 + buttons.length) % buttons.length].focus();
    }
  });
  window.addEventListener('resize', closeMenu);
  window.addEventListener('blur', closeMenu);
  els.treeScroll.addEventListener('scroll', closeMenu, { passive: true });

  // Chuột phải / nhấn giữ vào vùng trống của sidebar = thao tác trên thư mục gốc.
  const ROOT_NODE = { path: '', type: 'dir' };
  attachLongPress(els.treeScroll, (e) => (e.target.closest('.tree-row, .search-hit') ? null : ROOT_NODE));
  els.treeScroll.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.search-hit')) return;
    e.preventDefault();
    if (menuOpenedByLongPress()) return;
    openMenu(e, ROOT_NODE, null);
  });

  // ---------- Nhấn giữ (điện thoại) ----------
  // iOS Safari không phát sự kiện contextmenu khi nhấn giữ, nên tự đếm giờ bằng pointer events.
  // Android có phát contextmenu; hai đường được gộp lại để menu chỉ mở một lần.

  const LONG_PRESS_MS = 500;
  const MOVE_TOLERANCE_PX = 10;
  let longPressAt = 0;
  function justLongPressed() { return Date.now() - longPressAt < 700; }
  function menuOpenedByLongPress() { return justLongPressed() && !els.menu.hidden; }

  function attachLongPress(target, resolveNode) {
    let timer = null;
    let startX = 0;
    let startY = 0;
    const cancel = () => {
      clearTimeout(timer);
      timer = null;
    };
    target.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      const node = resolveNode(e);
      if (!node) return;
      cancel();
      startX = e.clientX;
      startY = e.clientY;
      timer = setTimeout(() => {
        timer = null;
        longPressAt = Date.now();
        if (navigator.vibrate) navigator.vibrate(10);
        openMenu({ clientX: startX, clientY: startY }, node, target.classList.contains('tree-row') ? target : null);
      }, LONG_PRESS_MS);
    });
    target.addEventListener('pointermove', (e) => {
      if (timer && Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_TOLERANCE_PX) cancel();
    });
    target.addEventListener('pointerup', cancel);
    target.addEventListener('pointercancel', cancel); // bắt đầu cuộn
    target.addEventListener('contextmenu', () => {
      if (timer) {
        cancel();
        longPressAt = Date.now();
      }
    });
  }

  // Thả tay sau khi nhấn giữ sinh ra một cú click: chặn để không mở file / đóng menu ngay.
  document.addEventListener('click', (e) => {
    if (justLongPressed() && !els.menu.contains(e.target)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  // ================= Kéo thả =================

  const INTERNAL_DRAG = 'application/x-savemd-path';
  let dragSource = null;
  let dropRow = null;

  const dragTypes = (e) => (e.dataTransfer ? [...e.dataTransfer.types] : []);
  const isFileDrag = (e) => dragTypes(e).includes('Files');
  const isInternalDrag = (e) => dragSource && dragTypes(e).includes(INTERNAL_DRAG);

  // Thả lên thư mục -> vào thư mục đó; lên file -> thư mục chứa file; chỗ trống -> thư mục gốc / đang chọn.
  function dropTarget(e, fallback) {
    const row = e.target.closest('.tree-row');
    if (!row) return { folder: fallback, row: null };
    if (row.dataset.type === 'dir') return { folder: row.dataset.path, row };
    const folder = parentOf(row.dataset.path);
    return { folder, row: rowFor(folder) };
  }

  function canMoveInto(folder) {
    if (!dragSource) return false;
    if (folder === parentOf(dragSource.path)) return false;
    if (dragSource.type === 'dir' && (folder === dragSource.path || folder.startsWith(dragSource.path + '/'))) return false;
    return true;
  }

  function highlightDrop(row) {
    if (row === dropRow) return;
    dropRow?.classList.remove('drop-target');
    dropRow = row;
    dropRow?.classList.add('drop-target');
  }

  function clearDrop() {
    els.sidebar.classList.remove('drag-over');
    highlightDrop(null);
  }

  els.sidebar.addEventListener('dragover', (e) => {
    if (isInternalDrag(e)) {
      const { folder, row } = dropTarget(e, '');
      if (!canMoveInto(folder)) {
        highlightDrop(null);
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      highlightDrop(row || rowFor(''));
    } else if (isFileDrag(e)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      els.sidebar.classList.add('drag-over');
      highlightDrop(dropTarget(e, targetFolder()).row);
    }
  });
  els.sidebar.addEventListener('dragleave', (e) => {
    if (!els.sidebar.contains(e.relatedTarget)) clearDrop();
  });
  els.sidebar.addEventListener('drop', (e) => {
    if (isInternalDrag(e)) {
      e.preventDefault();
      const { folder } = dropTarget(e, '');
      const source = dragSource;
      clearDrop();
      if (source && canMoveInto(folder)) {
        moveItem(source, join(folder, nameOf(source.path)))
          .then((ok) => {
            if (!ok) return;
            expandTo(folder);
            renderTree();
            toast(`Đã chuyển tới ${folderLabel(folder)}`);
          })
          .catch(handleError);
      }
    } else if (isFileDrag(e)) {
      e.preventDefault();
      const { folder } = dropTarget(e, targetFolder());
      clearDrop();
      const files = [...e.dataTransfer.files];
      if (files.length) upload(files, folder).catch(handleError);
    }
  });
  // Thả file ra ngoài sidebar thì trình duyệt không tự mở file đó.
  window.addEventListener('dragover', (e) => { if (isFileDrag(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => { if (isFileDrag(e)) e.preventDefault(); });

  // ================= Giao diện: theme, thanh bên =================

  const THEMES = ['auto', 'light', 'dark'];
  const THEME_LABEL = { auto: 'Theo hệ thống', light: 'Sáng', dark: 'Tối' };
  let theme = store.get('theme', 'auto');
  if (!THEMES.includes(theme)) theme = 'auto';

  function applyTheme() {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    const btn = $('btn-theme');
    btn.innerHTML = theme === 'light' ? ICONS.sun : theme === 'dark' ? ICONS.moon : ICONS.monitor;
    btn.title = `Giao diện: ${THEME_LABEL[theme]} (bấm để đổi)`;
  }
  $('btn-theme').addEventListener('click', () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    store.set('theme', theme);
    applyTheme();
    toast(`Giao diện: ${THEME_LABEL[theme]}`);
  });
  applyTheme();

  const SIDEBAR_MIN = 220;
  const SIDEBAR_MAX = 560;
  const SIDEBAR_DEFAULT = 300;
  function setSidebarWidth(width) {
    const w = Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width)));
    els.body.style.setProperty('--sidebar-width', `${w}px`);
    return w;
  }
  setSidebarWidth(store.get('sidebarWidth', SIDEBAR_DEFAULT));
  if (store.get('sidebarCollapsed', false)) els.body.classList.add('sidebar-collapsed');

  function openDrawer() {
    if (mobileQuery.matches) {
      els.body.classList.add('drawer-open');
      els.backdrop.hidden = false;
    } else if (els.body.classList.contains('sidebar-collapsed')) {
      els.body.classList.remove('sidebar-collapsed');
      store.set('sidebarCollapsed', false);
    }
  }
  function closeDrawer() {
    els.body.classList.remove('drawer-open');
    els.backdrop.hidden = true;
  }
  $('btn-sidebar').addEventListener('click', () => {
    if (mobileQuery.matches) {
      if (els.body.classList.contains('drawer-open')) closeDrawer();
      else openDrawer();
    } else {
      store.set('sidebarCollapsed', els.body.classList.toggle('sidebar-collapsed'));
    }
  });
  els.backdrop.addEventListener('click', closeDrawer);
  mobileQuery.addEventListener('change', closeDrawer);

  const resizer = $('sidebar-resizer');
  resizer.addEventListener('pointerdown', (e) => {
    if (mobileQuery.matches || e.button !== 0) return;
    e.preventDefault();
    resizer.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
    const startX = e.clientX;
    const startWidth = els.sidebar.getBoundingClientRect().width;
    let width = startWidth;
    const move = (ev) => { width = setSidebarWidth(startWidth + ev.clientX - startX); };
    const up = () => {
      resizer.removeEventListener('pointermove', move);
      resizer.removeEventListener('pointerup', up);
      resizer.removeEventListener('pointercancel', up);
      document.body.classList.remove('resizing');
      store.set('sidebarWidth', width);
    };
    resizer.addEventListener('pointermove', move);
    resizer.addEventListener('pointerup', up);
    resizer.addEventListener('pointercancel', up);
  });
  resizer.addEventListener('dblclick', () => store.set('sidebarWidth', setSidebarWidth(SIDEBAR_DEFAULT)));

  // ================= Nút cố định =================

  $('btn-new-file').addEventListener('click', () => createFile(targetFolder()).catch(handleError));
  $('btn-new-folder').addEventListener('click', () => createFolder(targetFolder()).catch(handleError));
  $('btn-upload').addEventListener('click', () => pickFiles(targetFolder()));
  $('btn-trash').addEventListener('click', () => showTrash().catch(handleError));
  $('btn-zip-all').addEventListener('click', () => downloadZip('').catch(handleError));
  $('btn-shortcuts').addEventListener('click', () => showShortcuts());
  $('btn-logout').addEventListener('click', async () => {
    if (state.editing && state.dirty && !await confirmDiscard()) return;
    clearDraft();
    state.dirty = false;
    try {
      if (backend) backend.logout();
      else await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } finally {
      location.replace(loginUrl);
    }
  });

  // ================= Khởi động =================

  if ('serviceWorker' in navigator && !backend) {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* không bắt buộc */ });
  }

  setInterval(refreshTreeQuietly, TREE_REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshTreeQuietly(); });

  buildEditorToolbar();
  showEmptyState();
  (async () => {
    const me = await api('/api/auth/me');
    if (!me.ok) {
      location.replace(loginUrl);
      return;
    }
    const git = await api('/api/git/status').catch(() => null);
    if (git && git.ok) state.git = await git.json();
    await loadTree();
    const path = pathFromHash();
    if (path) await openFileAt(path);
    else if (mobileQuery.matches) openDrawer();
  })().catch(handleError);
})();

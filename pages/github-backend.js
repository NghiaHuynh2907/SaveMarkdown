// Thay server ASP.NET khi chạy trên GitHub Pages: nhận các request /api/... của app.js và
// thực hiện bằng GitHub REST API trên repo tài liệu (SAVEMD_CONFIG). Mỗi thao tác ghi là một commit
// đứng tên người đang đăng nhập (token GitHub của họ).
(() => {
  'use strict';

  const cfg = window.SAVEMD_CONFIG;
  const API = 'https://api.github.com';
  const REPO = `${API}/repos/${cfg.owner}/${cfg.repo}`;
  const TOKEN_KEY = 'savemd.githubToken';

  const TEXT_EXT = ['.md', '.markdown', '.txt'];
  const IMAGE_TYPES = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  };
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const MAX_SEARCH_FILE_BYTES = 2 * 1024 * 1024;
  const MAX_SEARCH_HITS = 100;
  const TRASH_DAYS = 30;
  const INDEX_FILE = 'index.md';
  const KEEP_FILE = '.gitkeep';
  const WINDOWS_RESERVED = new Set(['CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9']);

  const extOf = (p) => { const m = /\.[^./]+$/.exec(p); return m ? m[0].toLowerCase() : ''; };
  const isText = (p) => TEXT_EXT.includes(extOf(p));
  const isAllowed = (p) => isText(p) || extOf(p) in IMAGE_TYPES;
  const parentOf = (p) => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
  const nameOf = (p) => p.slice(p.lastIndexOf('/') + 1);
  const join = (a, b) => a ? `${a}/${b}` : b;
  const isVisibleName = (name) => !name.startsWith('.');
  const compareNames = (a, b) => a.localeCompare(b, 'vi', { sensitivity: 'base' });

  // ---------- Token ----------

  function getToken() {
    try { return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY); } catch { return null; }
  }

  function setToken(token, remember) {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(TOKEN_KEY);
      (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
    } catch { /* trình duyệt chặn storage: chỉ dùng được trong phiên này */ }
  }

  function clearToken() {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(TOKEN_KEY);
    } catch { /* bỏ qua */ }
  }

  // ---------- Lỗi trả về cho app.js ----------

  class HttpError extends Error {
    constructor(status, message, extra) {
      super(message);
      this.status = status;
      this.extra = extra;
    }
  }
  const fail = (status, message, extra) => { throw new HttpError(status, message, extra); };

  // ---------- GitHub API ----------

  async function gh(method, path, body, { noStore = false, token = getToken() } = {}) {
    if (!token) fail(401, 'Chưa đăng nhập');
    const res = await fetch(path.startsWith('http') ? path : REPO + path, {
      method,
      cache: noStore ? 'no-store' : 'default',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return res.status === 204 ? null : res.json();

    let message = '';
    try { message = (await res.json()).message || ''; } catch { /* không có body */ }
    if (res.status === 401) {
      if (token === getToken()) clearToken();
      fail(401, 'Token hết hạn hoặc không hợp lệ.');
    }
    if (res.status === 403 || res.status === 404) {
      if (/rate limit/i.test(message)) fail(429, 'Vượt giới hạn gọi GitHub API, thử lại sau ít phút.');
      fail(403, `Token không có quyền với repo ${cfg.owner}/${cfg.repo} (cần quyền Contents: Read and write).`);
    }
    const error = new HttpError(res.status, message || `GitHub trả lỗi ${res.status}`);
    error.github = true;
    throw error;
  }

  // ---------- Base64 / UTF-8 ----------

  function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  function base64ToBytes(b64) {
    const binary = atob(b64.replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  const utf8 = new TextEncoder();
  const utf8Decoder = new TextDecoder('utf-8');

  // sha của blob git (sha1 của "blob <độ dài>\0<nội dung>"): so sánh nội dung mà không cần tải về.
  async function gitBlobSha(bytes) {
    const header = utf8.encode(`blob ${bytes.length}\0`);
    const all = new Uint8Array(header.length + bytes.length);
    all.set(header);
    all.set(bytes, header.length);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', all));
    return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // ---------- Trạng thái repo (commit mới nhất + danh sách file) ----------

  const repo = { head: null, tree: null, entries: new Map() };
  const blobCache = new Map(); // sha -> Uint8Array (blob theo sha không bao giờ đổi)

  async function refreshHead() {
    const ref = await gh('GET', `/git/ref/heads/${cfg.branch}`, null, { noStore: true });
    const head = ref.object.sha;
    if (head === repo.head) return;
    const commit = await gh('GET', `/git/commits/${head}`);
    await loadTree(head, commit.tree.sha);
  }

  async function loadTree(head, treeSha) {
    const tree = await gh('GET', `/git/trees/${treeSha}?recursive=1`);
    const entries = new Map();
    for (const item of tree.tree) {
      if (item.type === 'blob') entries.set(item.path, { type: 'file', sha: item.sha, mode: item.mode, size: item.size });
      else if (item.type === 'tree') entries.set(item.path, { type: 'dir' });
    }
    repo.head = head;
    repo.tree = treeSha;
    repo.entries = entries;
  }

  const fileEntry = (path) => { const e = repo.entries.get(path); return e && e.type === 'file' ? e : null; };
  const dirExists = (path) => path === '' || repo.entries.get(path)?.type === 'dir';
  const exists = (path) => repo.entries.has(path);

  // Mọi file nằm dưới path (path là file thì chỉ chính nó).
  function filesUnder(path) {
    const own = fileEntry(path);
    if (own) return [[path, own]];
    const prefix = path + '/';
    return [...repo.entries].filter(([p, e]) => e.type === 'file' && p.startsWith(prefix));
  }

  // Path còn hiển thị (không nằm trong thư mục/tên bắt đầu bằng dấu chấm).
  const isVisiblePath = (path) => path.split('/').every(isVisibleName);

  async function readBlob(sha) {
    if (blobCache.has(sha)) return blobCache.get(sha);
    const blob = await gh('GET', `/git/blobs/${sha}`);
    const bytes = base64ToBytes(blob.content);
    blobCache.set(sha, bytes);
    return bytes;
  }

  const readText = async (sha) => utf8Decoder.decode(await readBlob(sha));

  async function createBlob(bytes) {
    const result = await gh('POST', '/git/blobs', { content: bytesToBase64(bytes), encoding: 'base64' });
    blobCache.set(result.sha, bytes);
    return result.sha;
  }

  // ---------- Commit ----------

  // build() đọc repo.entries mới nhất và trả về { changes: [{ path, sha (null = xóa), mode? }],
  // removedRoot?, message? (thay message mặc định) }.
  // Nếu có người khác vừa commit chen vào thì đọc lại và làm lại (tối đa 3 lần).
  async function commit(message, build) {
    for (let attempt = 0; ; attempt++) {
      await refreshHead();
      const result = await build();
      const changes = result.changes;
      if (!changes.length) return result;

      await keepParentAlive(changes, result.removedRoot);
      const indexChange = await indexUpdate(changes);
      if (indexChange) changes.push(indexChange);

      const tree = await gh('POST', '/git/trees', {
        base_tree: repo.tree,
        tree: changes.map((c) => ({ path: c.path, mode: c.mode || '100644', type: 'blob', sha: c.sha })),
      });
      const created = await gh('POST', '/git/commits', { message: result.message || message, tree: tree.sha, parents: [repo.head] });
      try {
        await gh('PATCH', `/git/refs/heads/${cfg.branch}`, { sha: created.sha, force: false });
      } catch (err) {
        // 422: nhánh đã có commit mới hơn -> làm lại trên commit mới nhất.
        if (err.status === 422 && attempt < 2) continue;
        throw err;
      }
      await loadTree(created.sha, tree.sha);
      return result;
    }
  }

  // Git không lưu thư mục rỗng: khi xóa/chuyển đi mục cuối cùng của một thư mục (removedRoot)
  // thì thêm .gitkeep để thư mục cha vẫn còn.
  async function keepParentAlive(changes, removedRoot) {
    const dir = parentOf(removedRoot || '');
    if (!removedRoot || !dir) return;
    const prefix = dir + '/';
    const removed = new Set(changes.filter((c) => c.sha === null).map((c) => c.path));
    const remains = [...repo.entries].some(([p, e]) => e.type === 'file' && p.startsWith(prefix) && !removed.has(p))
      || changes.some((c) => c.sha !== null && c.path.startsWith(prefix));
    if (!remains) changes.push({ path: join(dir, KEEP_FILE), sha: await getEmptyBlob() });
  }

  // Blob rỗng cho .gitkeep (tạo một lần, repo nào chưa có thì GitHub tạo mới).
  let emptyBlob = null;
  const getEmptyBlob = async () => (emptyBlob ??= await createBlob(new Uint8Array(0)));

  // ---------- index.md (mục lục, giống bản server) ----------

  async function indexUpdate(changes) {
    const files = new Map([...repo.entries].filter(([, e]) => e.type === 'file'));
    for (const c of changes) {
      if (c.sha === null) files.delete(c.path);
      else files.set(c.path, { type: 'file', sha: c.sha });
    }
    const content = buildIndex([...files.keys()]);
    const bytes = utf8.encode(content);
    const sha = await gitBlobSha(bytes);
    if (files.get(INDEX_FILE)?.sha === sha) return null;
    return { path: INDEX_FILE, sha: await createBlob(bytes) };
  }

  function buildIndex(paths) {
    const docs = paths.filter((p) => isText(p) && isVisiblePath(p) && p !== INDEX_FILE);
    const root = { dirs: new Map(), files: [] };
    for (const p of docs) {
      const parts = p.split('/');
      let node = root;
      for (const dir of parts.slice(0, -1)) {
        if (!node.dirs.has(dir)) node.dirs.set(dir, { dirs: new Map(), files: [] });
        node = node.dirs.get(dir);
      }
      node.files.push(p);
    }
    let out = '# Tài liệu\n\n> Trang này do SaveMarkdown tự sinh mỗi lần đồng bộ, sửa tay sẽ bị ghi đè.\n\n';
    const walk = (node, depth) => {
      const indent = '  '.repeat(depth);
      for (const name of [...node.dirs.keys()].sort(compareNames)) {
        out += `${indent}- **${name}/**\n`;
        walk(node.dirs.get(name), depth + 1);
      }
      for (const p of node.files.sort((a, b) => compareNames(nameOf(a), nameOf(b)))) {
        out += `${indent}- [${nameOf(p).replace(/\.[^.]+$/, '')}](${p.replace(/ /g, '%20')})\n`;
      }
    };
    walk(root, 0);
    return out;
  }

  // ---------- Kiểm tra tên/path (giống SafePathResolver phía server) ----------

  function validateName(name) {
    if (!name || !name.trim() || name === '.' || name === '..' || name.toLowerCase() === '.trash') {
      fail(400, 'Đường dẫn không hợp lệ.');
    }
    if (/[\\/:*?"<>|\u0000-\u001f]/.test(name)) fail(400, `Tên "${name}" chứa ký tự không hợp lệ.`);
    if (/[. ]$/.test(name)) fail(400, `Tên "${name}" không được kết thúc bằng dấu chấm hoặc khoảng trắng.`);
    if (WINDOWS_RESERVED.has(name.split('.')[0].trimEnd().toUpperCase())) {
      fail(400, `Tên "${name}" là tên hệ thống, không được dùng.`);
    }
  }

  function cleanPath(path) {
    const segments = String(path ?? '').replace(/\\/g, '/').split('/').filter(Boolean);
    segments.forEach(validateName);
    return segments.join('/');
  }

  // ---------- Tìm kiếm (giống TextFold phía server) ----------

  const foldCache = new Map();
  function foldChar(c) {
    if (c.charCodeAt(0) < 128) return c.toLowerCase();
    let f = foldCache.get(c);
    if (f === undefined) {
      if (c === 'đ' || c === 'Đ') f = 'd';
      else if (/[\ud800-\udfff]/.test(c)) f = c;
      else f = c.normalize('NFD')[0].toLowerCase();
      if (f.length !== 1) f = c;
      foldCache.set(c, f);
    }
    return f;
  }
  const fold = (text) => { let s = ''; for (let i = 0; i < text.length; i++) s += foldChar(text[i]); return s; };

  function findInText(text, needle) {
    const lines = text.split(/\r\n|\n|\r/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const index = fold(line).indexOf(needle);
      if (index < 0) continue;
      const from = Math.max(0, index - 50);
      const to = Math.min(line.length, index + needle.length + 90);
      const prefix = from > 0 ? '…' : '';
      const suffix = to < line.length ? '…' : '';
      return { snippet: prefix + line.slice(from, to) + suffix, start: index - from + prefix.length, line: i + 1 };
    }
    return null;
  }

  // Duyệt giống server: thư mục trước (đệ quy), rồi tới file; chỉ mục hiển thị.
  function visibleChildren(dir) {
    const prefix = dir ? dir + '/' : '';
    const dirs = [];
    const files = [];
    for (const [p, e] of repo.entries) {
      if (!p.startsWith(prefix) || p.slice(prefix.length).includes('/')) continue;
      const name = p.slice(prefix.length);
      if (!isVisibleName(name)) continue;
      if (e.type === 'dir') dirs.push(p);
      else if (isAllowed(name)) files.push(p);
    }
    const byName = (a, b) => compareNames(nameOf(a), nameOf(b));
    return { dirs: dirs.sort(byName), files: files.sort(byName) };
  }

  function* walkVisible(dir) {
    const { dirs, files } = visibleChildren(dir);
    for (const d of dirs) {
      yield { path: d, type: 'dir' };
      yield* walkVisible(d);
    }
    for (const f of files) yield { path: f, type: 'file' };
  }

  async function prefetchTexts(entries) {
    const queue = entries.filter((e) => !blobCache.has(e.sha));
    const worker = async () => { while (queue.length) await readBlob(queue.shift().sha).catch(() => {}); };
    await Promise.all(Array.from({ length: 6 }, worker));
  }

  // ---------- Thùng rác = các commit "Xóa ..." gần đây trong lịch sử git ----------

  async function listTrash() {
    const since = new Date(Date.now() - TRASH_DAYS * 86400000).toISOString();
    const commits = await gh('GET', `/commits?sha=${encodeURIComponent(cfg.branch)}&since=${since}&per_page=100`, null, { noStore: true });
    const items = [];
    const seen = new Set();
    for (const c of commits) {
      const [first, ...rest] = c.commit.message.split('\n');
      const m = /^Xóa (.+)$/.exec(first);
      if (!m || !c.parents.length) continue;
      const path = m[1];
      // Đã có lại ở đúng chỗ cũ (đã khôi phục/tạo lại) thì không hiện nữa.
      if (seen.has(path) || exists(path)) continue;
      seen.add(path);
      const type = rest.some((l) => l.trim() === 'Kiểu: dir') ? 'dir' : 'file';
      items.push({ id: c.sha, name: nameOf(path), originalPath: path, type, deletedAt: c.commit.committer.date });
    }
    return items;
  }

  async function restoreTrash(id) {
    if (!/^[0-9a-f]{40}$/.test(id || '')) fail(404, 'Không tìm thấy trong thùng rác.');
    const deleted = await gh('GET', `/git/commits/${id}`);
    const m = /^Xóa (.+)$/.exec(deleted.message.split('\n')[0]);
    if (!m || !deleted.parents.length) fail(404, 'Không tìm thấy trong thùng rác.');
    const path = m[1];

    // Lấy lại file từ commit ngay trước lúc xóa.
    const parent = await gh('GET', `/git/commits/${deleted.parents[0].sha}`);
    const old = await gh('GET', `/git/trees/${parent.tree.sha}?recursive=1`);
    const restored = old.tree.filter((t) => t.type === 'blob' && (t.path === path || t.path.startsWith(path + '/')));
    if (!restored.length) fail(404, 'Không tìm thấy trong thùng rác.');

    await commit(`Khôi phục ${path}`, async () => {
      if (exists(path)) fail(409, `Đã có "${nameOf(path)}" ở chỗ cũ.`);
      // Thư mục cha không còn thì git tự tạo lại theo path.
      return { changes: restored.map((t) => ({ path: t.path, sha: t.sha, mode: t.mode })) };
    });
    return { path };
  }

  // ---------- Các endpoint ----------

  function buildTree(dir) {
    const { dirs, files } = visibleChildren(dir);
    return [
      ...dirs.map((d) => ({ name: nameOf(d), path: d, type: 'dir', children: buildTree(d) })),
      ...files.map((f) => ({ name: nameOf(f), path: f, type: 'file', children: null })),
    ];
  }

  function contentDisposition(name) {
    return `attachment; filename="${name.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;
  }

  async function loadJsZip() {
    if (window.JSZip) return window.JSZip;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Không tải được thư viện nén zip'));
      document.head.appendChild(s);
    });
    return window.JSZip;
  }

  const stamp = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  };

  const routes = {
    'GET /api/auth/me': async () => {
      try {
        await gh('GET', '', null, { noStore: true });
      } catch (err) {
        // Token không dùng được -> bỏ token và quay về trang đăng nhập kèm lý do.
        if (!(err instanceof HttpError)) throw err;
        clearToken();
        try { sessionStorage.setItem('savemd.loginError', err.message); } catch { /* bỏ qua */ }
        fail(401, err.message);
      }
      return json({ authenticated: true });
    },

    'GET /api/git/status': async () => json({
      enabled: true,
      appUrl: location.origin + location.pathname,
      webUrl: `https://github.com/${cfg.owner}/${cfg.repo}`,
      branch: cfg.branch,
    }),

    'GET /api/files/tree': async () => {
      await refreshHead();
      return json({ name: '', path: '', type: 'dir', children: buildTree('') });
    },

    'GET /api/files/read': async (q) => {
      await refreshHead();
      const path = cleanPath(q.get('path'));
      const entry = fileEntry(path);
      if (!entry || !isText(path)) fail(404, 'Không tìm thấy file.');
      if (entry.size > MAX_FILE_BYTES) fail(400, 'File quá lớn để hiển thị.');
      return new Response(await readText(entry.sha), {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-File-Version': entry.sha },
      });
    },

    'GET /api/files/download': async (q) => {
      await refreshHead();
      const path = cleanPath(q.get('path'));
      const entry = fileEntry(path);
      if (!entry || !isAllowed(path)) fail(404, 'Không tìm thấy file.');
      const type = IMAGE_TYPES[extOf(path)] || (extOf(path) === '.txt' ? 'text/plain; charset=utf-8' : 'text/markdown; charset=utf-8');
      return new Response(new Blob([await readBlob(entry.sha)], { type }), {
        status: 200,
        headers: { 'Content-Type': type, 'Content-Disposition': contentDisposition(nameOf(path)) },
      });
    },

    'GET /api/files/zip': async (q) => {
      await refreshHead();
      const path = cleanPath(q.get('path'));
      if (!dirExists(path)) fail(404, 'Không tìm thấy thư mục.');
      const JSZip = await loadJsZip();
      const zip = new JSZip();
      const files = [...walkVisible(path)].filter((e) => e.type === 'file').map((e) => ({ path: e.path, ...fileEntry(e.path) }));
      await prefetchTexts(files);
      const base = path ? path + '/' : '';
      for (const f of files) zip.file(f.path.slice(base.length), await readBlob(f.sha));
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      const name = `${path ? nameOf(path) : 'SaveMarkdown'}-${stamp()}.zip`;
      return new Response(blob, {
        status: 200,
        headers: { 'Content-Type': 'application/zip', 'Content-Disposition': contentDisposition(name) },
      });
    },

    'GET /api/files/search': async (q) => {
      const query = (q.get('q') || '').trim();
      if (!query) return json([]);
      await refreshHead();
      const needle = fold(query);
      const all = [...walkVisible('')];
      await prefetchTexts(all.filter((e) => e.type === 'file' && isText(e.path))
        .map((e) => fileEntry(e.path)).filter((e) => e.size <= MAX_SEARCH_FILE_BYTES));

      const nameHits = [];
      const contentHits = [];
      for (const e of all) {
        if (nameHits.length + contentHits.length >= MAX_SEARCH_HITS) break;
        const name = nameOf(e.path);
        const nameIndex = fold(name).indexOf(needle);
        if (nameIndex >= 0) {
          nameHits.push({ path: e.path, name, type: e.type, snippet: null, matchStart: nameIndex, matchLength: needle.length, line: 0 });
          continue;
        }
        const entry = e.type === 'file' && isText(e.path) ? fileEntry(e.path) : null;
        if (!entry || entry.size > MAX_SEARCH_FILE_BYTES || !blobCache.has(entry.sha)) continue;
        const hit = findInText(utf8Decoder.decode(blobCache.get(entry.sha)), needle);
        if (hit) contentHits.push({ path: e.path, name, type: 'file', snippet: hit.snippet, matchStart: hit.start, matchLength: needle.length, line: hit.line });
      }
      return json([...nameHits, ...contentHits]);
    },

    'POST /api/files/upload': async (q, body) => {
      if (!(body instanceof FormData)) fail(400, 'Yêu cầu không hợp lệ.');
      const folder = cleanPath(body.get('folder'));
      const overwrite = String(body.get('overwrite')).toLowerCase() === 'true';
      const files = body.getAll('files').filter((f) => f instanceof File);
      if (!files.length) fail(400, 'Chưa chọn file.');

      const targets = [];
      for (const file of files) {
        const name = nameOf(file.name.replace(/\\/g, '/'));
        validateName(name);
        if (!isAllowed(name)) fail(400, `"${name}": chỉ cho phép .md, .markdown, .txt và ảnh (png, jpg, gif, webp, svg).`);
        if (file.size > MAX_FILE_BYTES) fail(400, `"${name}" vượt quá 10 MB.`);
        targets.push({ file, path: join(folder, name) });
      }

      const shas = await Promise.all(targets.map(async (t) => createBlob(new Uint8Array(await t.file.arrayBuffer()))));
      await commit(`Tải lên ${targets.map((t) => t.path).join(', ')}`, async () => {
        if (!dirExists(folder)) fail(404, 'Thư mục đích không tồn tại.');
        const existing = targets.filter((t) => exists(t.path)).map((t) => nameOf(t.path));
        if (existing.length && !overwrite) fail(409, 'File đã tồn tại.', { existing });
        if (targets.some((t) => repo.entries.get(t.path)?.type === 'dir')) fail(409, 'Đã có thư mục cùng tên.');
        return { changes: targets.map((t, i) => ({ path: t.path, sha: shas[i] })) };
      });
      return json({ uploaded: targets.map((t) => t.path) });
    },

    'POST /api/files/file': async (q, body) => {
      const path = cleanPath(body?.path);
      if (!path || !isText(path)) fail(400, 'Tên file phải có đuôi .md, .markdown hoặc .txt.');
      const initial = extOf(path) === '.txt' ? '' : `# ${nameOf(path).replace(/\.[^.]+$/, '')}\n\n`;
      const sha = await createBlob(utf8.encode(initial));
      await commit(`Tạo ${path}`, async () => {
        if (exists(path)) fail(409, 'Đã tồn tại file hoặc thư mục cùng tên.');
        if (!dirExists(parentOf(path))) fail(404, 'Thư mục cha không tồn tại.');
        return { changes: [{ path, sha }] };
      });
      return json({ path });
    },

    'POST /api/files/folder': async (q, body) => {
      const path = cleanPath(body?.path);
      if (!path) fail(400, 'Chưa nhập tên thư mục.');
      const keep = await getEmptyBlob();
      await commit(`Tạo thư mục ${path}`, async () => {
        if (exists(path)) fail(409, 'Đã tồn tại file hoặc thư mục cùng tên.');
        if (!dirExists(parentOf(path))) fail(404, 'Thư mục cha không tồn tại.');
        return { changes: [{ path: join(path, KEEP_FILE), sha: keep }] };
      });
      return json({ path });
    },

    'PUT /api/files/content': async (q, body) => {
      const path = cleanPath(body?.path);
      if (!isText(path)) fail(400, 'Chỉ sửa được file văn bản.');
      const bytes = utf8.encode(body.content ?? '');
      if (bytes.length > MAX_FILE_BYTES) fail(400, 'Nội dung vượt quá 10 MB.');
      const sha = await createBlob(bytes);
      await commit(`Sửa ${path}`, async () => {
        const entry = fileEntry(path);
        if (!entry) fail(404, 'Không tìm thấy file.');
        if (!body.force && body.version && body.version !== entry.sha) {
          fail(409, 'File đã bị thay đổi ở nơi khác kể từ lúc bạn mở.');
        }
        return { changes: entry.sha === sha ? [] : [{ path, sha, mode: entry.mode }] };
      });
      return json({ version: sha });
    },

    'POST /api/files/move': async (q, body) => {
      const from = cleanPath(body?.from);
      const to = cleanPath(body?.to);
      if (!from || !to) fail(400, 'Không thể di chuyển thư mục gốc.');
      if (from === to) return json({ path: to });
      await commit(`Di chuyển ${from} → ${to}`, async () => {
        const isFile = !!fileEntry(from);
        if (!isFile && !dirExists(from)) fail(404, 'Không tìm thấy.');
        if (isFile && (!isAllowed(from) || !isAllowed(to))) fail(400, 'Đuôi file không được hỗ trợ (.md, .markdown, .txt hoặc ảnh).');
        if (!isFile && to.startsWith(from + '/')) fail(400, 'Không thể chuyển thư mục vào bên trong chính nó.');
        if (exists(to)) fail(409, `Đã có "${nameOf(to)}" ở thư mục đích.`);
        if (!dirExists(parentOf(to))) fail(404, 'Thư mục đích không tồn tại.');
        const changes = [];
        for (const [p, e] of filesUnder(from)) {
          changes.push({ path: to + p.slice(from.length), sha: e.sha, mode: e.mode });
          changes.push({ path: p, sha: null });
        }
        return { changes, removedRoot: from };
      });
      return json({ path: to });
    },

    'DELETE /api/files': async (q) => {
      const path = cleanPath(q.get('path'));
      if (!path) fail(400, 'Không thể xóa thư mục gốc.');
      let commitSha = null;
      await commit(`Xóa ${path}`, async () => {
        const isFile = !!fileEntry(path);
        if (isFile ? !isAllowed(path) : !dirExists(path)) fail(404, 'Không tìm thấy.');
        return {
          changes: filesUnder(path).map(([p]) => ({ path: p, sha: null })),
          removedRoot: path,
          // Ghi kiểu vào commit để thùng rác hiện đúng biểu tượng thư mục.
          message: isFile ? undefined : `Xóa ${path}\n\nKiểu: dir`,
        };
      }).then(() => { commitSha = repo.head; });
      // Commit xóa đứng tên "Xóa <path>" -> dùng sha của nó làm id để "Hoàn tác".
      return json({ trashId: commitSha });
    },

    'GET /api/trash': async () => {
      await refreshHead();
      return json(await listTrash());
    },

    'POST /api/trash/restore': async (q, body) => json(await restoreTrash(body?.id)),

    'DELETE /api/trash': async () => fail(400, 'Bản web giữ lịch sử trên GitHub nên không xóa vĩnh viễn được.'),
  };

  function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }

  async function handle(url, options = {}) {
    const u = new URL(url, location.href);
    const method = (options.method || 'GET').toUpperCase();
    let route = routes[`${method} ${u.pathname}`];
    // DELETE /api/trash/{id}: xóa vĩnh viễn một mục -> không hỗ trợ.
    if (!route && method === 'DELETE' && u.pathname.startsWith('/api/trash/')) route = routes['DELETE /api/trash'];
    if (!route) return json({ message: 'Không tìm thấy.' }, 404);

    let body = options.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return json({ message: 'Yêu cầu không hợp lệ.' }, 400); }
    }
    try {
      return await route(u.searchParams, body);
    } catch (err) {
      if (err instanceof HttpError) return json({ message: err.message, ...(err.extra || {}) }, err.status);
      throw err;
    }
  }

  // Ảnh trong repo private không gắn thẳng vào <img> được (cần token) -> tải về rồi tạo blob URL.
  const blobUrls = new Map();
  async function blobUrl(path) {
    if (!repo.head) await refreshHead();
    const clean = cleanPath(path);
    const entry = fileEntry(clean);
    if (!entry) throw new Error('not found');
    if (!blobUrls.has(entry.sha)) {
      const type = IMAGE_TYPES[extOf(clean)] || 'application/octet-stream';
      blobUrls.set(entry.sha, URL.createObjectURL(new Blob([await readBlob(entry.sha)], { type })));
    }
    return blobUrls.get(entry.sha);
  }

  window.SAVEMD_BACKEND = {
    // Nhớ tài liệu đang mở để đăng nhập xong quay lại đúng chỗ.
    get loginUrl() {
      try { if (location.hash.startsWith('#/')) sessionStorage.setItem('savemd.returnHash', location.hash); } catch { /* bỏ qua */ }
      return 'login.html';
    },
    trashNote: `Mục đã xóa trong ${TRASH_DAYS} ngày gần đây, lấy từ lịch sử commit trên GitHub.`,
    fetch: handle,
    blobUrl,
    logout: clearToken,
    // Dùng cho trang đăng nhập.
    async verifyToken(token) {
      await gh('GET', '', null, { noStore: true, token });
      return true;
    },
    setToken,
    hasToken: () => !!getToken(),
    repoLabel: `${cfg.owner}/${cfg.repo}`,
  };
})();

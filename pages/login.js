(() => {
  const backend = window.SAVEMD_BACKEND;
  const form = document.getElementById('login-form');
  const token = document.getElementById('password');
  const remember = document.getElementById('remember');
  const toggle = document.getElementById('toggle-password');
  const submit = document.getElementById('submit');
  const error = document.getElementById('login-error');

  document.getElementById('repo-label').textContent = backend.repoLabel;
  document.getElementById('token-link').href = 'https://github.com/settings/personal-access-tokens/new';

  // Quay lại đúng tài liệu đang mở dở (link chia sẻ dạng index.html#/thư-mục/file.md).
  const target = () => 'index.html' + (sessionStorage.getItem('savemd.returnHash') || '');

  // Đã có token thì vào thẳng app.
  if (backend.hasToken()) location.replace(target());

  // Lý do bị đưa về trang đăng nhập (token hết hạn, không có quyền...).
  try {
    const reason = sessionStorage.getItem('savemd.loginError');
    if (reason) {
      sessionStorage.removeItem('savemd.loginError');
      error.textContent = reason;
      error.hidden = false;
    }
  } catch { /* bỏ qua */ }

  const EYE = '<svg class="icon" viewBox="0 0 24 24"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg class="icon" viewBox="0 0 24 24"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>';
  toggle.innerHTML = EYE;

  toggle.addEventListener('click', () => {
    const show = token.type === 'password';
    token.type = show ? 'text' : 'password';
    toggle.innerHTML = show ? EYE_OFF : EYE;
    toggle.setAttribute('aria-label', show ? 'Ẩn token' : 'Hiện token');
    toggle.setAttribute('aria-pressed', String(show));
    token.focus();
  });

  function showError(message) {
    error.textContent = message;
    error.hidden = false;
    token.focus();
    token.select();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = token.value.trim();
    if (!value) {
      showError('Vui lòng nhập token');
      return;
    }

    submit.disabled = true;
    error.hidden = true;
    try {
      await backend.verifyToken(value);
      backend.setToken(value, remember.checked);
      location.replace(target());
      try { sessionStorage.removeItem('savemd.returnHash'); } catch { /* bỏ qua */ }
    } catch (err) {
      showError(err && err.status ? err.message : 'Không kết nối được tới GitHub');
    } finally {
      submit.disabled = false;
    }
  });
})();

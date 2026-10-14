(() => {
  const form = document.getElementById('login-form');
  const password = document.getElementById('password');
  const remember = document.getElementById('remember');
  const toggle = document.getElementById('toggle-password');
  const submit = document.getElementById('submit');
  const error = document.getElementById('login-error');

  // Đã đăng nhập rồi thì vào thẳng app.
  fetch('/api/auth/me', { credentials: 'same-origin' })
    .then(res => { if (res.ok) location.replace('/'); })
    .catch(() => {});

  const EYE = '<svg class="icon" viewBox="0 0 24 24"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg class="icon" viewBox="0 0 24 24"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>';
  toggle.innerHTML = EYE;

  toggle.addEventListener('click', () => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    toggle.innerHTML = show ? EYE_OFF : EYE;
    toggle.setAttribute('aria-label', show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
    toggle.setAttribute('aria-pressed', String(show));
    password.focus();
  });

  function showError(message) {
    error.textContent = message;
    error.hidden = false;
    password.focus();
    password.select();
  }

  // Submit bằng nút "Vào" hoặc Enter; không reload trang.
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!password.value) {
      showError('Vui lòng nhập mật khẩu');
      return;
    }

    submit.disabled = true;
    error.hidden = true;
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password.value, remember: remember.checked }),
      });
      if (res.ok) {
        location.replace('/');
        return;
      }
      let message = 'Mật khẩu không đúng';
      try {
        const body = await res.json();
        if (body && body.message) message = body.message;
      } catch { /* giữ thông báo mặc định */ }
      showError(message);
    } catch {
      showError('Không kết nối được tới server');
    } finally {
      submit.disabled = false;
    }
  });
})();

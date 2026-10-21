/* Verde Horizonte Admin — gedeelde helpers (vanilla JS, geen frameworks) */
window.VH = (function () {
  function get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  }
  function set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }
  function remove(key) {
    localStorage.removeItem(key);
  }

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ESC[c]);
  }

  function fmtEUR(n) {
    return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(Number(n) || 0);
  }
  function fmtNum(n, d) {
    d = d == null ? 2 : d;
    return new Intl.NumberFormat('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(n) || 0);
  }
  function today() {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  function uid(prefix) {
    return (prefix || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function fmtDuration(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return pad(h) + ':' + pad(m) + ':' + pad(sec);
  }
  function toast(msg, type) {
    const t = document.createElement('div');
    t.className = 'toast ' + (type || 'info');
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.remove(); }, 320);
    }, 2400);
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () {});
    });
  }

  return {
    get: get,
    set: set,
    remove: remove,
    esc: esc,
    fmtEUR: fmtEUR,
    fmtNum: fmtNum,
    today: today,
    uid: uid,
    fmtDuration: fmtDuration,
    toast: toast
  };
})();

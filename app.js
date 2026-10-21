/* Verde Horizonte Admin — gedeelde helpers (vanilla JS, geen frameworks) */
window.VH = (function () {
  // Koppeling van LocalStorage-sleutels naar Supabase-tabellen.
  const TABLES = {
    vh_customers: 'klanten',
    vh_quotes: 'offertes',
    vh_invoices: 'facturen',
    vh_projects: 'projecten',
    vh_leads: 'leads',
    vh_time_entries: 'uren',
    vh_card: 'kaartje'
  };
  // Sleutels die één enkel object opslaan (i.p.v. een array).
  const SINGLE = { vh_card: true };

  // In-memory cache zodat de bestaande synchrone API blijft werken.
  const cache = {};
  const loading = {};

  function tableFor(key) {
    return TABLES[key] || key;
  }

  // Haal het id van de ingelogde gebruiker op (null als niet ingelogd).
  async function currentUserId() {
    try {
      const { data } = await supabaseClient.auth.getUser();
      return data && data.user ? data.user.id : null;
    } catch (err) {
      console.error('VH.currentUserId', err);
      return null;
    }
  }

  // ---- Laad-indicator (spinner bovenaan) ----
  let loadCount = 0;
  function showLoading() {
    loadCount++;
    let el = document.getElementById('vh-loading');
    if (!el) {
      el = document.createElement('div');
      el.id = 'vh-loading';
      el.className = 'vh-loading';
      el.innerHTML = '<div class="vh-spinner"></div>';
      document.body.appendChild(el);
    }
    el.classList.add('show');
  }
  function hideLoading() {
    loadCount = Math.max(0, loadCount - 1);
    if (loadCount === 0) {
      const el = document.getElementById('vh-loading');
      if (el) el.classList.remove('show');
    }
  }

  function load(key) {
    if (loading[key]) return;
    loading[key] = true;
    showLoading();
    const table = tableFor(key);
    currentUserId()
      .then(function (user_id) {
        // Laad alleen de rijen van de ingelogde gebruiker.
        let query = supabaseClient.from(table).select('*');
        if (user_id) query = query.eq('user_id', user_id);
        return query;
      })
      .then(function (res) {
        loading[key] = false;
        hideLoading();
        if (res.error) { console.error('VH.load', key, res.error); toast('Laden mislukt', 'error'); return; }
        let data;
        if (SINGLE[key]) {
          data = (res.data && res.data[0]) ? res.data[0] : {};
        } else {
          data = res.data || [];
        }
        cache[key] = data;
        document.dispatchEvent(new CustomEvent('vh:data:' + key, { detail: data }));
      })
      .catch(function (err) {
        loading[key] = false;
        hideLoading();
        console.error('VH.load', key, err);
      });
  }

  function get(key, fallback) {
    if (key in cache) return cache[key];
    load(key);
    return fallback;
  }

  async function set(key, value) {
    cache[key] = value;

    const user_id = await currentUserId();
    const table = tableFor(key);

    if (SINGLE[key]) {
      const payload = Object.assign({ id: 'card' }, value);
      if (user_id) payload.user_id = user_id;
      const { error } = await supabaseClient.from(table).upsert(payload);
      if (error) { console.error('VH.set', key, error); toast('Opslaan mislukt', 'error'); return false; }
      return true;
    }

    // Arrays: upsert de rijen van de ingelogde gebruiker en verwijder alleen
    // diens rijen die niet meer in de lijst staan (nooit die van anderen).
    const rows = Array.isArray(value) ? value : [];
    const payload = rows.map(function (row) {
      const copy = Object.assign({}, row);
      if (user_id) copy.user_id = user_id;
      return copy;
    });

    if (payload.length) {
      const { error: upsertError } = await supabaseClient.from(table).upsert(payload);
      if (upsertError) { console.error('VH.set', key, upsertError); toast('Opslaan mislukt', 'error'); return false; }
    }

    // Verwijder alleen de rijen van deze gebruiker die niet meer bestaan.
    if (user_id) {
      let delQuery = supabaseClient.from(table).delete().eq('user_id', user_id);
      const ids = payload.map(function (row) { return row.id; }).filter(Boolean);
      if (ids.length) {
        const list = ids.map(function (id) {
          return '"' + String(id).replace(/"/g, '""') + '"';
        }).join(',');
        delQuery = delQuery.not('id', 'in', '(' + list + ')');
      }
      const { error: delError } = await delQuery;
      if (delError) { console.error('VH.set', key, delError); toast('Opslaan mislukt', 'error'); return false; }
    }

    return true;
  }

  async function remove(key) {
    delete cache[key];
    const table = tableFor(key);
    const user_id = await currentUserId();
    let query = supabaseClient.from(table).delete();
    if (user_id) query = query.eq('user_id', user_id);
    const { error } = await query;
    if (error) { console.error('VH.remove', key, error); toast('Verwijderen mislukt', 'error'); return false; }
    return true;
  }

  // Abonneer op asynchroon geladen data voor een sleutel.
  function onData(key, cb) {
    document.addEventListener('vh:data:' + key, function (e) { cb(e.detail); });
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

  // ---- Supabase Auth: inlog-controle en uitloggen ----
  function isLoginPage() {
    const p = (location.pathname || '').split('/').pop().toLowerCase();
    return p === 'login.html' || p === 'login';
  }

  // Stuur niet-ingelogde gebruikers door naar login.html (behalve op de login-pagina zelf).
  async function requireAuth() {
    if (isLoginPage()) return true;
    try {
      const { data } = await supabaseClient.auth.getSession();
      if (data && data.session && data.session.user) return true;
    } catch (err) {
      console.error('VH.requireAuth getSession', err);
    }
    location.replace('login.html');
    return false;
  }

  async function logout() {
    try { await supabaseClient.auth.signOut(); } catch (err) { console.error('VH.logout', err); }
    location.replace('login.html');
  }

  requireAuth();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () {});
    });
  }

  return {
    get: get,
    set: set,
    remove: remove,
    onData: onData,
    esc: esc,
    fmtEUR: fmtEUR,
    fmtNum: fmtNum,
    today: today,
    uid: uid,
    fmtDuration: fmtDuration,
    toast: toast,
    logout: logout,
    requireAuth: requireAuth
  };
})();

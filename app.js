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

  // Lokale opslag voor offline-modus (blijft beschikbaar zonder netwerk).
  const OFFLINE_PREFIX = 'vh-offline-';
  const SYNC_QUEUE_KEY = 'vh-sync-queue';

  function tableFor(key) {
    return TABLES[key] || key;
  }

  function offlineGet(key) {
    try {
      const raw = localStorage.getItem(OFFLINE_PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }
  function offlineSet(key, value) {
    try {
      localStorage.setItem(OFFLINE_PREFIX + key, JSON.stringify(value));
    } catch (err) {
      console.error('VH.offlineSet', key, err);
    }
  }

  // ---- Sync-wachtrij (offline acties die later naar Supabase moeten) ----
  function queueGet() {
    try {
      const raw = localStorage.getItem(SYNC_QUEUE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (err) {
      return [];
    }
  }
  function queueSave(arr) {
    try {
      localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(arr));
    } catch (err) {
      console.error('VH.queueSave', err);
    }
  }
  function queuePush(action) {
    const arr = queueGet();
    arr.push(action);
    queueSave(arr);
    updateOfflineBar();
  }
  function queueClear() {
    try { localStorage.removeItem(SYNC_QUEUE_KEY); } catch (err) {}
    updateOfflineBar();
  }
  function queueCount() {
    return queueGet().length;
  }

  // ---- Offline-indicator ----
  function updateOfflineBar() {
    const pending = queueCount();
    let el = document.getElementById('vh-offline');
    if (!pending) {
      // Geen wachtende wijzigingen: alleen tonen als de verbinding weg is.
      if (!navigator.onLine) {
        ensureOfflineBar('⚠ Offline');
      } else if (el) {
        el.classList.remove('show');
      }
      return;
    }
    ensureOfflineBar('⚠ ' + pending + ' wijziging(en) wachten op sync');
  }
  function ensureOfflineBar(text) {
    let el = document.getElementById('vh-offline');
    if (!el) {
      el = document.createElement('div');
      el.id = 'vh-offline';
      el.className = 'vh-offline';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('show');
  }
  function setOnline(online) {
    if (online) {
      const pending = queueCount();
      if (!pending) {
        const el = document.getElementById('vh-offline');
        if (el) el.classList.remove('show');
      }
      // Als we online zijn én er acties in de wachtrij staan, voer sync uit.
      if (pending) processSyncQueue();
    } else {
      updateOfflineBar();
    }
  }
  function refreshOnlineState() {
    updateOfflineBar();
    if (navigator.onLine !== false && queueCount()) processSyncQueue();
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
        setOnline(true);
        if (res.error) {
          return fallbackOffline(key, res.error);
        }
        let data;
        if (SINGLE[key]) {
          data = (res.data && res.data[0]) ? res.data[0] : {};
        } else {
          data = res.data || [];
        }
        cache[key] = data;
        // Bewaar een offline-kopie voor als het netwerk wegvalt.
        offlineSet(key, data);
        document.dispatchEvent(new CustomEvent('vh:data:' + key, { detail: data }));
      })
      .catch(function (err) {
        loading[key] = false;
        hideLoading();
        console.error('VH.load', key, err);
        fallbackOffline(key, err);
      });
  }

  // Netwerk onbereikbaar: serveer de laatst bekende lokale kopie.
  function fallbackOffline(key, cause) {
    setOnline(false);
    const local = offlineGet(key);
    if (local == null) {
      toast('Offline en geen lokale kopie beschikbaar', 'error');
      return;
    }
    cache[key] = local;
    document.dispatchEvent(new CustomEvent('vh:data:' + key, { detail: local }));
  }

  function get(key, fallback) {
    if (key in cache) return cache[key];
    load(key);
    return fallback;
  }

  // ---- Sync: speel de wachtrij af tegen Supabase zodra we online zijn. ----
  let syncing = false;
  async function processSyncQueue() {
    if (syncing) return;
    const queue = queueGet();
    if (!queue.length) return;
    syncing = true;
    try {
      for (let i = 0; i < queue.length; i++) {
        const action = queue[i];
        const table = action.table;
        if (action.type === 'upsert') {
          const { error } = await supabaseClient.from(table).upsert(action.payload, { onConflict: 'id' });
          if (error) throw error;
        } else if (action.type === 'delete') {
          let q = supabaseClient.from(table).delete().eq('id', action.id);
          if (action.user_id) q = q.eq('user_id', action.user_id);
          const { error } = await q;
          if (error) throw error;
        } else if (action.type === 'delete-all') {
          let q = supabaseClient.from(table).delete();
          if (action.user_id) q = q.eq('user_id', action.user_id);
          const { error } = await q;
          if (error) throw error;
        }
      }
      // Alles gelukt: gooi de wachtrij leeg en verberg de balk.
      queueClear();
      toast('Wijzigingen gesynchroniseerd', 'success');
    } catch (err) {
      console.error('VH.processSyncQueue', err);
      // Behoud de wachtrij voor een volgende poging.
    } finally {
      syncing = false;
      updateOfflineBar();
    }
  }

  async function set(key, value) {
    cache[key] = value;

    const user_id = await currentUserId();
    const table = tableFor(key);

    if (SINGLE[key]) {
      // id = user_id + '-card', zodat gebruikers elkaars kaartje nooit
      // kunnen overschrijven (geen vaste id 'card' meer).
      const id = user_id ? (user_id + '-card') : 'card';
      const payload = Object.assign({ id: id }, value);
      if (user_id) payload.user_id = user_id;
      try {
        const { error } = await supabaseClient.from(table).upsert(payload);
        if (error) {
          console.error('VH.set', key, error);
          queuePush({ type: 'upsert', key: key, table: table, payload: payload });
          toast('Offline — opgeslagen op dit apparaat', 'error');
        } else {
          setOnline(true);
        }
      } catch (err) {
        console.error('VH.set', key, err);
        queuePush({ type: 'upsert', key: key, table: table, payload: payload });
        toast('Offline — opgeslagen op dit apparaat', 'error');
      }
      offlineSet(key, value);
      return true;
    }

    // Arrays: pure upsert (onConflict op 'id'). Bestaande rijen worden bijgewerkt,
    // nieuwe rijen toegevoegd. Rijen van andere gebruikers worden nooit geraakt.
    const rows = Array.isArray(value) ? value : [];
    const payload = rows.map(function (row) {
      const copy = Object.assign({}, row);
      if (user_id) copy.user_id = user_id;
      return copy;
    });

    if (payload.length) {
      try {
        const { error: upsertError } = await supabaseClient.from(table).upsert(payload, { onConflict: 'id' });
        if (upsertError) {
          console.error('VH.set', key, upsertError);
          queuePush({ type: 'upsert', key: key, table: table, payload: payload });
          toast('Offline — opgeslagen op dit apparaat', 'error');
        } else {
          setOnline(true);
        }
      } catch (err) {
        console.error('VH.set', key, err);
        queuePush({ type: 'upsert', key: key, table: table, payload: payload });
        toast('Offline — opgeslagen op dit apparaat', 'error');
      }
    } else {
      // Lege array: niets te upserten.
      setOnline(true);
    }

    offlineSet(key, value);
    return true;
  }

  async function remove(key) {
    delete cache[key];
    try { localStorage.removeItem(OFFLINE_PREFIX + key); } catch (err) {}
    const table = tableFor(key);
    const user_id = await currentUserId();
    let query = supabaseClient.from(table).delete();
    if (user_id) query = query.eq('user_id', user_id);
    try {
      const { error } = await query;
      if (error) {
        console.error('VH.remove', key, error);
        queuePush({ type: 'delete-all', key: key, table: table, user_id: user_id });
        toast('Offline — verwijdering wordt gesynchroniseerd', 'error');
        return true;
      }
      setOnline(true);
    } catch (err) {
      console.error('VH.remove', key, err);
      queuePush({ type: 'delete-all', key: key, table: table, user_id: user_id });
      toast('Offline — verwijdering wordt gesynchroniseerd', 'error');
    }
    return true;
  }

  // Verwijder één rij (veilig: filtert op id én op de ingelogde gebruiker).
  // key = storage-sleutel (bepaalt de tabel via TABLES).
  async function removeRow(key, id) {
    const table = tableFor(key);
    const user_id = await currentUserId();
    let query = supabaseClient.from(table).delete().eq('id', id);
    if (user_id) query = query.eq('user_id', user_id);
    try {
      const { error } = await query;
      if (error) {
        console.error('VH.removeRow', key, id, error);
        queuePush({ type: 'delete', key: key, table: table, id: id, user_id: user_id });
        toast('Offline — verwijdering wordt gesynchroniseerd', 'error');
        return true;
      }
      setOnline(true);
    } catch (err) {
      console.error('VH.removeRow', key, id, err);
      queuePush({ type: 'delete', key: key, table: table, id: id, user_id: user_id });
      toast('Offline — verwijdering wordt gesynchroniseerd', 'error');
    }
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
    return p === 'login.html' || p === 'login' ||
           p === 'reset-password.html' || p === 'reset-password' ||
           p === 'update-password.html' || p === 'update-password';
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

  // Stuur een wachtwoord-reset e-mail naar de gebruiker.
  async function resetPassword(email) {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/update-password.html'
    });
    if (error) console.error('VH.resetPassword', error);
    return { error: error || null };
  }

  // Stel een nieuw wachtwoord in voor de ingelogde (herstel-)sessie.
  async function updatePassword(newPassword) {
    const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
    if (error) console.error('VH.updatePassword', error);
    return { error: error || null };
  }

  // Volg de online-status en toon/verberg de offline-indicator.
  window.addEventListener('online', function () { setOnline(true); });
  window.addEventListener('offline', function () { setOnline(false); });
  refreshOnlineState();

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
    removeRow: removeRow,
    onData: onData,
    esc: esc,
    fmtEUR: fmtEUR,
    fmtNum: fmtNum,
    today: today,
    uid: uid,
    fmtDuration: fmtDuration,
    toast: toast,
    logout: logout,
    requireAuth: requireAuth,
    resetPassword: resetPassword,
    updatePassword: updatePassword
  };
})();

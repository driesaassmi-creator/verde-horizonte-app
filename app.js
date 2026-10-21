/* Verde Horizonte Admin — gedeelde helpers (vanilla JS, geen frameworks) */
window.VH = (function () {
  const SUPABASE_URL = 'https://jfeicdnntthbxvthsriz.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_HJ_017xez-xq_oA76an6Kw_eb6b0-QL';
  const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  // --- Basis helpers ---
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

  // --- Escaping & formatting ---
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

  // --- Offline / Sync Queue ---
  const SYNC_KEY = 'vh-sync-queue';
  function queueGet() {
    try {
      const v = JSON.parse(localStorage.getItem(SYNC_KEY));
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function queueSave(arr) { localStorage.setItem(SYNC_KEY, JSON.stringify(arr)); }
  function queuePush(action) {
    const q = queueGet();
    q.push(action);
    queueSave(q);
    updateOfflineBar();
  }
  function queueClear() {
    localStorage.removeItem(SYNC_KEY);
    updateOfflineBar();
  }
  function queueCount() { return queueGet().length; }

  // --- Auth ---
  async function getCurrentUser() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    return user;
  }
  async function requireAuth() {
    const p = window.location.pathname.split('/').pop() || 'index.html';
    const publicPages = ['login.html', 'reset-password.html', 'update-password.html'];
    if (publicPages.includes(p)) return true;
    
    const user = await getCurrentUser();
    if (!user) {
      window.location.replace('login.html');
      return false;
    }
    return true;
  }

  // --- Database mapping ---
  function tableFor(key) {
    const map = {
      vh_customers: 'klanten',
      vh_quotes: 'offertes',
      vh_invoices: 'facturen',
      vh_projects: 'projecten',
      vh_leads: 'leads',
      vh_time_entries: 'uren',
      vh_card: 'kaartje'
    };
    return map[key] || key;
  }

  // --- Data load & save ---
  async function load(key, onData) {
    const table = tableFor(key);
    const user = await getCurrentUser();
    if (!user) return;
    
    // Update UI
    let { data, error } = await supabaseClient
      .from(table)
      .select('*')
      .eq('user_id', user.id);

    if (error) {
      console.error('Load error:', error);
      // Fallback offline
      const cached = get('cache_' + key, null);
      if (cached) {
        if (onData) onData(cached);
      } else {
        toast('Laden mislukt', 'error');
      }
      return;
    }

    // Cache data
    set('cache_' + key, data);
    if (onData) onData(data);
  }

  async function set(key, value) {
    const table = tableFor(key);
    const user = await getCurrentUser();
    if (!user) return false;

    const payload = Array.isArray(value) 
      ? value.map(v => ({ ...v, user_id: user.id }))
      : { ...value, user_id: user.id, id: user.id + '-card' };

    try {
      const { error } = await supabaseClient.from(table).upsert(payload, { onConflict: 'id' });
      if (error) throw error;
      
      // Update local cache
      set('cache_' + key, value);
      return true;
    } catch (err) {
      console.error('Save error:', err);
      // Offline mode
      set('cache_' + key, value);
      queuePush({ type: 'upsert', key, table, payload, user_id: user.id });
      toast('Offline — opgeslagen op dit apparaat', 'info');
      return true;
    }
  }

  async function removeRow(key, id) {
    const table = tableFor(key);
    const user = await getCurrentUser();
    if (!user) return false;

    try {
      const { error } = await supabaseClient.from(table).delete().eq('id', id).eq('user_id', user.id);
      if (error) throw error;
      
      // Remove from local cache
      const cached = get('cache_' + key, []);
      const newCache = cached.filter(item => item.id !== id);
      set('cache_' + key, newCache);
      return true;
    } catch (err) {
      console.error('Delete error:', err);
      // Offline mode
      queuePush({ type: 'delete', key, table, id, user_id: user.id });
      toast('Offline — verwijdering wordt gesynchroniseerd', 'info');
      return true;
    }
  }

  // --- Sync logic ---
  async function processSyncQueue() {
    const q = queueGet();
    if (!q.length) return;

    const syncBtn = document.getElementById('vh-sync-btn');
    if (syncBtn) { syncBtn.disabled = true; syncBtn.textContent = 'Bezig...'; }

    let success = true;
    for (const action of q) {
      try {
        if (action.type === 'upsert') {
          const { error } = await supabaseClient.from(action.table).upsert(action.payload, { onConflict: 'id' });
          if (error) throw error;
        } else if (action.type === 'delete') {
          const { error } = await supabaseClient.from(action.table).delete().eq('id', action.id).eq('user_id', action.user_id);
          if (error) throw error;
        }
      } catch (err) {
        console.error('Sync error:', err);
        success = false;
        break;
      }
    }

    if (success) {
      queueClear();
      toast('Wijzigingen gesynchroniseerd', 'success');
    } else {
      toast('Synchronisatie mislukt, probeer opnieuw', 'error');
    }

    if (syncBtn) { syncBtn.disabled = false; syncBtn.textContent = 'Sync nu'; }
    updateOfflineBar();
  }

  // --- Offline UI ---
  function ensureOfflineBar() {
    let bar = document.getElementById('vh-offline-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'vh-offline-bar';
      bar.className = 'vh-offline';
      document.body.prepend(bar);
    }
    return bar;
  }

  function updateOfflineBar() {
    const bar = ensureOfflineBar();
    const count = queueCount();
    
    if (count > 0) {
      bar.innerHTML = `
        <span>⚠ ${count} wijziging(en) wachten op sync</span>
        <button id="vh-sync-btn" class="vh-sync-btn">Sync nu</button>
      `;
      bar.style.display = 'flex';
      const btn = document.getElementById('vh-sync-btn');
      if (btn) btn.onclick = processSyncQueue;
    } else {
      bar.style.display = 'none';
    }
  }

  function logout() {
    supabaseClient.auth.signOut().then(() => {
      window.location.href = 'login.html';
    });
  }

  // --- Init ---
  // Controleer auth bij het laden
  requireAuth();
  // Toon de offline-balk als er iets in de wachtrij staat
  updateOfflineBar();

  return {
    get: get,
    set: set,
    remove: remove,
    removeRow: removeRow,
    esc: esc,
    fmtEUR: fmtEUR,
    fmtNum: fmtNum,
    today: today,
    uid: uid,
    fmtDuration: fmtDuration,
    toast: toast,
    logout: logout,
    processSyncQueue: processSyncQueue
  };
})();
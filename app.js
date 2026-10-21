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

  function tableFor(key) {
    return TABLES[key] || key;
  }

  function load(key) {
    const table = tableFor(key);
    supabase.from(table).select('*').then(function (res) {
      if (res.error) { console.error('VH.load', key, res.error); return; }
      let data;
      if (SINGLE[key]) {
        data = (res.data && res.data[0]) ? res.data[0] : {};
      } else {
        data = res.data || [];
      }
      cache[key] = data;
      document.dispatchEvent(new CustomEvent('vh:data:' + key, { detail: data }));
    });
  }

  function get(key, fallback) {
    if (key in cache) return cache[key];
    load(key);
    return fallback;
  }

  function set(key, value) {
    cache[key] = value;
    const table = tableFor(key);
    if (SINGLE[key]) {
      const row = Object.assign({ id: 'card' }, value);
      supabase.from(table).upsert(row).then(function (res) {
        if (res.error) console.error('VH.set', key, res.error);
      });
    } else {
      // Vervang de volledige inhoud: eerst alles verwijderen, daarna invoegen.
      supabase.from(table).delete().neq('id', '').then(function (delRes) {
        if (delRes.error) { console.error('VH.set', key, delRes.error); return; }
        if (value && value.length) {
          supabase.from(table).insert(value).then(function (insRes) {
            if (insRes.error) console.error('VH.set', key, insRes.error);
          });
        }
      });
    }
  }

  function remove(key) {
    delete cache[key];
    const table = tableFor(key);
    supabase.from(table).delete().neq('id', '').then(function (res) {
      if (res.error) console.error('VH.remove', key, res.error);
    });
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
    toast: toast
  };
})();

/* פאנל גבאי — תור אישורים, עריכה, ייצוא. */
(function () {
  'use strict';
  var CFG = window.CFG, TOK = null, T = 'sugg', DATA = {};

  var $ = function (i) { return document.getElementById(i); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  function H() {
    return {
      apikey: CFG.anon,
      Authorization: 'Bearer ' + (TOK || CFG.anon),
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    };
  }
  function isExpired(t) {
    return /JWT expired|PGRST303|invalid JWT|token is expired/i.test(t || '');
  }
  function saveToks(d) {
    TOK = d.access_token;
    try {
      sessionStorage.setItem('gm_tok', TOK);
      if (d.refresh_token) sessionStorage.setItem('gm_ref', d.refresh_token);
    } catch (x) {}
  }
  function clearToks() {
    TOK = null;
    try {
      sessionStorage.removeItem('gm_tok');
      sessionStorage.removeItem('gm_ref');
    } catch (e) {}
  }
  var _refP = null;
  function refresh() {
    if (_refP) return _refP;
    var rt = null;
    try { rt = sessionStorage.getItem('gm_ref'); } catch (e) {}
    if (!rt) return Promise.reject(new Error('no_refresh'));
    _refP = fetch(CFG.url + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { apikey: CFG.anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: rt })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.access_token) throw new Error('refresh_failed');
      saveToks(d);
    }).finally(function () { _refP = null; });
    return _refP;
  }
  function toLogin() {
    clearToks();
    var a = $('app'), l = $('login'), o = $('out');
    if (a) a.hidden = true;
    if (l) l.hidden = false;
    if (o) o.hidden = true;
    var m = $('lMsg');
    if (m) { m.textContent = 'פג תוקף החיבור, יש להיכנס מחדש.'; m.className = 'msg err'; }
  }
  function api(p, o, _retried) {
    o = o || {}; o.headers = H();
    return fetch(CFG.url + '/rest/v1/' + p, o).then(function (r) {
      if (!r.ok) return r.text().then(function (t) {
        if (!_retried && isExpired(t)) {
          return refresh().then(function () { return api(p, o, true); },
            function () { toLogin(); throw new Error('פג תוקף החיבור'); });
        }
        throw new Error(t);
      });
      return r.status === 204 ? null : r.json();
    });
  }

  /* ---------- כניסה ---------- */
  function login(e) {
    e.preventDefault();
    var ph = $('lPh').value.replace(/\D/g, '');
    fetch(CFG.url + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: CFG.anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ph + '@gmach.local', password: $('lPw').value })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.access_token) throw new Error();
      saveToks(d);
      show();
    }).catch(function () {
      $('lMsg').textContent = 'טלפון או סיסמה שגויים.';
      $('lMsg').className = 'msg err';
    });
  }

  function show() {
    $('login').hidden = true; $('app').hidden = false; $('out').hidden = false;
    load();
  }

  function load() {
    Promise.all([
      api('gmach_suggestions?select=*&order=created_at.desc&limit=200'),
      api('gmachim?select=*&order=code'),
      api('gmach_categories?select=*&order=sort'),
      api('gmach_searches?select=q,results,created_at&order=created_at.desc&limit=200'),
      api('gmach_items_stock?select=*&order=name'),
      api('gmach_loans_view?select=*&order=is_overdue.desc,due_date.asc,date_out.desc')
    ]).then(function (r) {
      DATA.sugg = r[0]; DATA.gm = r[1]; DATA.cats = r[2]; DATA.se = r[3];
      DATA.items = r[4] || []; DATA.loans = r[5] || [];
      var open = DATA.sugg.filter(function (s) { return s.status === 'new'; });
      var openLoans = DATA.loans.filter(function (l) { return !l.returned_at; });
      $('bSugg').textContent = open.length;
      var bl = $('bLoans'); if (bl) bl.textContent = openLoans.length;
      stats(); draw();
    }).catch(function (e) {
      $('pane').innerHTML = '<div class="empty"><b>שגיאת טעינה</b>' + esc(e.message) + '</div>';
    });
  }

  function stats() {
    var live = DATA.gm.filter(function (g) { return !g.is_wanted && g.status === 'approved'; });
    var want = DATA.gm.filter(function (g) { return g.is_wanted; });
    var open = DATA.sugg.filter(function (s) { return s.status === 'new'; });
    var noPhone = live.filter(function (g) { return !g.phone1; });
    var miss = {};
    DATA.se.forEach(function (s) { if (!s.results && s.q) miss[s.q] = (miss[s.q] || 0) + 1; });
    $('stat').innerHTML =
      box(live.length, 'גמ"חים פעילים') + box(open.length, 'ממתינים לאישור') +
      box(want.length, 'מבוקשים') + box(noPhone.length, 'בלי טלפון') +
      box(Object.keys(miss).length, 'חיפושים בלי תוצאה');
  }
  function box(n, t) { return '<div><b>' + n + '</b><span>' + t + '</span></div>'; }

  /* ---------- תצוגות ---------- */
  function draw() {
    if (T === 'sugg') return paneSugg();
    if (T === 'list') return paneList();
    if (T === 'loans') return paneLoans();
    if (T === 'items') return paneItems();
    if (T === 'search') return paneSearch();
    if (T === 'export') return paneExport();
  }

  /* ---------- השאלות ---------- */
  function fmtDate(d) {
    if (!d) return '—';
    try { return new Date(d).toLocaleDateString('he-IL'); } catch (e) { return d; }
  }
  function daysDiff(a, b) {
    if (!a || !b) return null;
    return Math.round((new Date(a) - new Date(b)) / 86400000);
  }

  function paneLoans() {
    var open = DATA.loans.filter(function (l) { return !l.returned_at; });
    var overdue = open.filter(function (l) { return l.is_overdue; });
    var soon = open.filter(function (l) {
      if (l.is_overdue || !l.due_date) return false;
      var d = daysDiff(l.due_date, new Date().toISOString().slice(0, 10));
      return d !== null && d >= 0 && d <= 2;
    });
    var closed = DATA.loans.filter(function (l) { return l.returned_at; }).slice(0, 30);

    var addBtn = '<button class="btn pri" id="loanNew" style="margin-bottom:14px">+ השאלה חדשה</button>';
    var summary = '<div class="stat">' +
      box(open.length, 'פתוחות') +
      box(overdue.length, 'באיחור') +
      box(soon.length, 'להחזרה השבוע') +
      '</div>';

    var makeRow = function (l) {
      var dueTxt = l.due_date ? fmtDate(l.due_date) : '—';
      var color = '';
      if (!l.returned_at && l.is_overdue) color = 'background:#FFE5E5';
      else if (!l.returned_at && soon.indexOf(l) >= 0) color = 'background:#FFF6E8';
      return '<tr style="' + color + '">' +
        '<td>' + esc(l.item_name || '—') +
          (l.gmach_name ? '<div style="font-size:12px;color:var(--muted)">' + esc(l.gmach_name) + '</div>' : '') +
        '</td>' +
        '<td>' + l.qty + '</td>' +
        '<td>' + esc(l.borrower_name || '') +
          (l.borrower_phone ? '<div style="font-size:12px;color:var(--muted)">' + esc(l.borrower_phone) + '</div>' : '') +
        '</td>' +
        '<td>' + fmtDate(l.date_out) + '</td>' +
        '<td>' + dueTxt + '</td>' +
        '<td>' + (l.returned_at ? fmtDate(l.returned_at) : '<b style="color:#B4400A">פתוח</b>') + '</td>' +
        '<td>' + (l.paid ? '✔' : (l.amount ? '<span style="color:#B4400A">₪' + l.amount + '</span>' : '—')) + '</td>' +
        '<td>' +
          (l.returned_at
            ? '<button class="btn sm js-loan-reopen" data-id="' + l.id + '">בטל החזרה</button>'
            : '<button class="btn sm pri js-loan-return" data-id="' + l.id + '">סמן כמוחזר</button> ' +
              '<button class="btn sm js-loan-edit" data-id="' + l.id + '">ערוך</button>') +
        '</td>' +
      '</tr>';
    };

    var openHTML = open.length
      ? '<div class="wrap"><table class="tbl"><thead><tr>' +
        '<th>פריט</th><th>כמות</th><th>שואל</th><th>יציאה</th><th>החזרה מתוכננת</th>' +
        '<th>הוחזר בפועל</th><th>שולם</th><th></th></tr></thead><tbody>' +
        open.map(makeRow).join('') + '</tbody></table></div>'
      : '<div class="empty"><b>אין השאלות פתוחות</b>הכל בבית.</div>';

    var closedHTML = closed.length
      ? '<h3 style="margin:24px 0 8px">30 השאלות אחרונות שהוחזרו</h3>' +
        '<div class="wrap"><table class="tbl"><thead><tr>' +
        '<th>פריט</th><th>כמות</th><th>שואל</th><th>יציאה</th><th>החזרה מתוכננת</th>' +
        '<th>הוחזר בפועל</th><th>שולם</th><th></th></tr></thead><tbody>' +
        closed.map(makeRow).join('') + '</tbody></table></div>'
      : '';

    $('pane').innerHTML = addBtn + summary +
      '<h3 style="margin:16px 0 8px">השאלות פתוחות</h3>' + openHTML + closedHTML;

    $('loanNew').onclick = function () { openLoanForm(null); };
  }

  function openLoanForm(existingId) {
    var l = existingId
      ? DATA.loans.filter(function (x) { return x.id === +existingId; })[0]
      : null;
    if (existingId && !l) return;

    if (!DATA.items.length) {
      alert('אין עדיין פריטים במלאי — קודם צריך להוסיף פריט בטאב "מלאי".');
      return;
    }
    var itemOpts = DATA.items.map(function (it) {
      var g = DATA.gm.filter(function (x) { return x.id === it.gmach_id; })[0];
      var lbl = it.name + (g ? ' · ' + g.name : '') +
                ' (זמין ' + it.avail_qty + '/' + it.total_qty + ')';
      return '<option value="' + it.id + '"' +
        (l && l.item_id === it.id ? ' selected' : '') + '>' + esc(lbl) + '</option>';
    }).join('');

    var today = new Date().toISOString().slice(0, 10);
    var dueDefault = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

    var html = '<div id="loanOv" class="ov on" style="position:fixed;inset:0;' +
      'background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;' +
      'justify-content:center;padding:14px;overflow:auto">' +
      '<div style="background:#fff;border-radius:14px;max-width:520px;width:100%;' +
      'padding:22px;max-height:92vh;overflow:auto">' +
      '<h3 style="margin:0 0 12px">' + (l ? 'עריכת השאלה' : 'השאלה חדשה') + '</h3>' +
      '<div class="f"><label>פריט</label><select data-k="item_id">' + itemOpts + '</select></div>' +
      '<div class="f"><label>כמות</label>' +
        '<input data-k="qty" type="number" min="1" value="' + (l ? l.qty : 1) + '"></div>' +
      '<div class="f"><label>שם השואל</label>' +
        '<input data-k="borrower_name" type="text" value="' + esc(l ? l.borrower_name : '') + '"></div>' +
      '<div class="f"><label>טלפון</label>' +
        '<input data-k="borrower_phone" type="tel" value="' + esc(l ? l.borrower_phone : '') + '"></div>' +
      '<div class="f"><label>תאריך יציאה</label>' +
        '<input data-k="date_out" type="date" value="' + (l ? l.date_out : today) + '"></div>' +
      '<div class="f"><label>תאריך החזרה מתוכנן</label>' +
        '<input data-k="due_date" type="date" value="' + (l && l.due_date ? l.due_date : dueDefault) + '"></div>' +
      '<div class="f"><label>עלות (אופציונלי)</label>' +
        '<input data-k="amount" type="number" step="0.5" value="' + (l && l.amount != null ? l.amount : '') + '"></div>' +
      '<div class="f"><label style="display:flex;align-items:center;gap:8px">' +
        '<input data-k="paid" type="checkbox"' + (l && l.paid ? ' checked' : '') + '> שולם</label></div>' +
      '<div class="f"><label>הערות</label>' +
        '<textarea data-k="notes" rows="2">' + esc(l ? l.notes : '') + '</textarea></div>' +
      '<div class="acts" style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap">' +
      '<button class="btn pri" id="loanSave">' + (l ? 'עדכן' : 'שמור השאלה') + '</button>' +
      (l ? '<button class="btn ghost" id="loanDel" style="color:#B4400A;border-color:#B4400A">מחק</button>' : '') +
      '<button class="btn ghost" id="loanCancel">ביטול</button>' +
      '</div><div class="msg" id="loanMsg"></div></div></div>';

    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap.firstChild);
    var close = function () { var o = $('loanOv'); if (o) o.parentNode.removeChild(o); };
    $('loanCancel').onclick = close;
    if ($('loanDel')) $('loanDel').onclick = function () {
      if (!confirm('למחוק את ההשאלה?')) return;
      api('gmach_loans?id=eq.' + l.id, { method: 'DELETE' })
        .then(function () { close(); load(); })
        .catch(function (e) {
          $('loanMsg').textContent = 'שגיאה: ' + e.message;
          $('loanMsg').className = 'msg err';
        });
    };
    $('loanSave').onclick = function () {
      var body = {};
      [].forEach.call(document.querySelectorAll('#loanOv [data-k]'), function (el) {
        var k = el.dataset.k;
        if (el.type === 'checkbox') body[k] = el.checked;
        else if (el.type === 'number') body[k] = el.value === '' ? null : Number(el.value);
        else if (el.type === 'date') body[k] = el.value || null;
        else body[k] = el.value.trim();
      });
      if (!body.borrower_name) {
        $('loanMsg').textContent = 'חסר שם שואל';
        $('loanMsg').className = 'msg err'; return;
      }
      if (!body.qty || body.qty < 1) body.qty = 1;
      $('loanSave').disabled = true;
      var call = l
        ? api('gmach_loans?id=eq.' + l.id, { method: 'PATCH', body: JSON.stringify(body) })
        : api('gmach_loans', { method: 'POST', body: JSON.stringify(body) });
      call.then(function (r) {
        if (!r || (Array.isArray(r) && !r.length)) throw new Error('לא נשמרה שורה');
        close(); load();
      }).catch(function (e) {
        $('loanMsg').textContent = 'שגיאה: ' + e.message;
        $('loanMsg').className = 'msg err';
        $('loanSave').disabled = false;
      });
    };
  }

  function returnLoan(id) {
    var today = new Date().toISOString().slice(0, 10);
    api('gmach_loans?id=eq.' + id, {
      method: 'PATCH',
      body: JSON.stringify({ returned_at: today, paid: true })
    }).then(function (r) {
      if (!r || !r.length) throw new Error('לא עודכנה שורה');
      load();
    }).catch(function (e) { alert('שגיאה: ' + e.message); });
  }
  function reopenLoan(id) {
    api('gmach_loans?id=eq.' + id, {
      method: 'PATCH', body: JSON.stringify({ returned_at: null })
    }).then(function (r) {
      if (!r || !r.length) throw new Error('לא עודכנה שורה');
      load();
    }).catch(function (e) { alert('שגיאה: ' + e.message); });
  }

  /* ---------- מלאי ---------- */
  function paneItems() {
    var addBtn = '<button class="btn pri" id="itemNew" style="margin-bottom:14px">+ פריט חדש</button>';
    var rows = DATA.items.map(function (it) {
      var g = DATA.gm.filter(function (x) { return x.id === it.gmach_id; })[0];
      var short = it.avail_qty <= 0;
      return '<tr' + (short ? ' style="background:#FFE5E5"' : '') + '>' +
        '<td>' + esc(it.name) + '</td>' +
        '<td>' + esc(g ? g.name : '—') + '</td>' +
        '<td>' + it.total_qty + '</td>' +
        '<td>' + it.out_qty + '</td>' +
        '<td><b>' + it.avail_qty + '</b></td>' +
        '<td>' + esc(it.unit || '') + '</td>' +
        '<td>' + esc(it.location || '') + '</td>' +
        '<td>' +
          '<button class="btn sm js-item-edit" data-id="' + it.id + '">ערוך</button> ' +
          '<button class="btn sm js-item-del" data-id="' + it.id + '" style="color:#B4400A">מחק</button>' +
        '</td></tr>';
    }).join('');

    var table = DATA.items.length
      ? '<div class="wrap"><table class="tbl"><thead><tr>' +
        '<th>פריט</th><th>גמ"ח</th><th>סה"כ</th><th>בחוץ</th><th>זמין</th>' +
        '<th>יחידה</th><th>מיקום</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<div class="empty"><b>אין עדיין פריטים במלאי</b>' +
        'לחץ "פריט חדש" כדי להתחיל.</div>';

    $('pane').innerHTML = addBtn + table;
    $('itemNew').onclick = function () { openItemForm(null); };
  }

  function openItemForm(existingId) {
    var it = existingId ? DATA.items.filter(function (x) { return x.id === +existingId; })[0] : null;
    if (existingId && !it) return;

    var gmachOpts = '<option value="">— בחר גמ"ח —</option>' + DATA.gm
      .filter(function (g) { return g.status === 'approved' && !g.is_wanted; })
      .map(function (g) {
        return '<option value="' + g.id + '"' +
          (it && it.gmach_id === g.id ? ' selected' : '') + '>' +
          esc('קוד ' + g.code + ' · ' + g.name) + '</option>';
      }).join('');

    var html = '<div id="itemOv" class="ov on" style="position:fixed;inset:0;' +
      'background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;' +
      'justify-content:center;padding:14px;overflow:auto">' +
      '<div style="background:#fff;border-radius:14px;max-width:520px;width:100%;' +
      'padding:22px;max-height:92vh;overflow:auto">' +
      '<h3 style="margin:0 0 12px">' + (it ? 'עריכת פריט' : 'פריט חדש') + '</h3>' +
      '<div class="f"><label>גמ"ח שייך</label>' +
        '<select data-k="gmach_id">' + gmachOpts + '</select></div>' +
      '<div class="f"><label>שם הפריט</label>' +
        '<input data-k="name" type="text" value="' + esc(it ? it.name : '') + '"></div>' +
      '<div class="f"><label>כמות כוללת</label>' +
        '<input data-k="total_qty" type="number" min="1" value="' + (it ? it.total_qty : 1) + '"></div>' +
      '<div class="f"><label>יחידה</label>' +
        '<input data-k="unit" type="text" value="' + esc(it ? it.unit : 'יחידה') + '" placeholder="יחידה / זוג / סט"></div>' +
      '<div class="f"><label>מיקום</label>' +
        '<input data-k="location" type="text" value="' + esc(it ? it.location : '') + '" placeholder="מחסן / בית ...">' + '</div>' +
      '<div class="f"><label>הערות</label>' +
        '<textarea data-k="notes" rows="2">' + esc(it ? it.notes : '') + '</textarea></div>' +
      '<div class="acts" style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap">' +
      '<button class="btn pri" id="itSave">' + (it ? 'עדכן' : 'שמור') + '</button>' +
      '<button class="btn ghost" id="itCancel">ביטול</button>' +
      '</div><div class="msg" id="itMsg"></div></div></div>';

    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap.firstChild);
    var close = function () { var o = $('itemOv'); if (o) o.parentNode.removeChild(o); };
    $('itCancel').onclick = close;
    $('itSave').onclick = function () {
      var body = {};
      [].forEach.call(document.querySelectorAll('#itemOv [data-k]'), function (el) {
        var k = el.dataset.k;
        if (el.type === 'number') body[k] = el.value === '' ? null : Number(el.value);
        else body[k] = el.value.trim() || null;
      });
      if (!body.name) {
        $('itMsg').textContent = 'חסר שם פריט';
        $('itMsg').className = 'msg err'; return;
      }
      if (!body.total_qty || body.total_qty < 1) body.total_qty = 1;
      $('itSave').disabled = true;
      var call = it
        ? api('gmach_items?id=eq.' + it.id, { method: 'PATCH', body: JSON.stringify(body) })
        : api('gmach_items', { method: 'POST', body: JSON.stringify(body) });
      call.then(function (r) {
        if (!r || (Array.isArray(r) && !r.length)) throw new Error('לא נשמרה שורה');
        close(); load();
      }).catch(function (e) {
        $('itMsg').textContent = 'שגיאה: ' + e.message;
        $('itMsg').className = 'msg err';
        $('itSave').disabled = false;
      });
    };
  }
  function delItem(id) {
    var it = DATA.items.filter(function (x) { return x.id === +id; })[0];
    if (!it) return;
    if (it.out_qty > 0) { alert('לא ניתן למחוק פריט שיש עליו השאלות פתוחות.'); return; }
    if (!confirm('למחוק את הפריט "' + it.name + '"?')) return;
    api('gmach_items?id=eq.' + id, { method: 'DELETE' })
      .then(load)
      .catch(function (e) { alert('שגיאה: ' + e.message); });
  }

  function paneSugg() {
    var rows = DATA.sugg.filter(function (s) { return s.status === 'new'; });
    if (!rows.length) {
      $('pane').innerHTML = '<div class="empty"><b>אין הצעות ממתינות</b>' +
        'כל מה שנשלח מהאתר או מהקו הטלפוני יופיע כאן.</div>';
      return;
    }
    $('pane').innerHTML = '<div class="grid">' + rows.map(function (s) {
      var p = s.payload || {};
      var kinds = { 'new': 'גמ"ח חדש', fix: 'תיקון', remove: 'בקשת הסרה' };
      if (s.kind === 'new' && p.activates_wanted) kinds['new'] = 'מפעיל גמ"ח מבוקש';
      var HIDE = { activates_wanted: 1 };      // שדות פנימיים
      var kv = Object.keys(p).map(function (k) {
        if (!p[k] || HIDE[k]) return '';
        var v = k === 'category' ? catName(p[k]) : p[k];
        return '<dt>' + esc(labelOf(k)) + '</dt><dd>' + esc(v) + '</dd>';
      }).join('');
      return '<div class="card"><div class="cat">' + esc(kinds[s.kind] || s.kind) +
        ' · ' + esc(s.source) + ' · ' + new Date(s.created_at).toLocaleDateString('he-IL') +
        '</div><h3>' + esc(p.name || ('דיווח על קוד ' + (p.code || '—'))) + '</h3>' +
        '<dl class="kv">' + kv + '</dl>' +
        (s.reporter_name || s.reporter_phone
          ? '<div class="meta"><span><b>מדווח:</b> ' + esc(s.reporter_name || '') + ' ' +
            esc(s.reporter_phone || '') + '</span></div>' : '') +
        '<div class="acts">' +
        (s.kind === 'new'
          ? '<button class="btn pri js-ok" data-id="' + s.id + '">אשר ופרסם</button>' : '') +
        '<button class="btn js-done" data-id="' + s.id + '">טופל ידנית</button>' +
        '<button class="btn ghost js-rej" data-id="' + s.id + '">דחייה</button>' +
        '</div></div>';
    }).join('') + '</div>';
  }

  var LBL = {
    name: 'שם', category: 'קטגוריה', description: 'תיאור', owner_name: 'אצל',
    address: 'כתובת', phone1: 'טלפון', phone2: 'טלפון 2', hours: 'שעות',
    price: 'עלות', what: 'הדיווח', code: 'קוד'
  };
  function labelOf(k) { return LBL[k] || k; }

  function paneList() {
    $('pane').innerHTML = '<div class="wrap"><table class="tbl"><thead><tr>' +
      '<th>קוד</th><th>שם</th><th>קטגוריה</th><th>אצל</th><th>טלפון</th>' +
      '<th>סטטוס</th><th></th></tr></thead><tbody>' +
      DATA.gm.map(function (g) {
        return '<tr><td>' + g.code + '</td><td>' + esc(g.name) + '</td><td>' +
          esc(catName(g.category)) + '</td><td>' + esc(g.owner_name || '') + '</td><td>' +
          esc(g.phone1 || '—') + '</td><td>' +
          (g.is_wanted ? 'מבוקש' : g.status === 'approved' ? 'פעיל' : esc(g.status)) +
          '</td><td>' +
          '<button class="btn sm js-edit" data-id="' + g.id + '">ערוך</button> ' +
          '<button class="btn sm js-hide" data-id="' + g.id + '" data-s="' +
          (g.status === 'approved' ? 'hidden' : 'approved') + '">' +
          (g.status === 'approved' ? 'הסתר' : 'הפעל') + '</button></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function openEdit(id) {
    var g = DATA.gm.filter(function (x) { return x.id === +id; })[0];
    if (!g) return;
    var catOpts = DATA.cats.map(function (c) {
      return '<option value="' + esc(c.key) + '"' +
        (c.key === g.category ? ' selected' : '') + '>' + esc(c.name) + '</option>';
    }).join('');
    var fieldsHTML = '';
    var fields = [
      ['name', 'שם', 'input'], ['owner_name', 'אצל', 'input'],
      ['phone1', 'טלפון', 'input'], ['phone2', 'טלפון 2', 'input'],
      ['address', 'כתובת', 'input'], ['hours', 'שעות', 'input'],
      ['price', 'עלות', 'input'], ['description', 'תיאור', 'textarea'],
      ['notes', 'הערות פנימיות', 'textarea']
    ];
    fields.forEach(function (r) {
      var val = g[r[0]] || '';
      fieldsHTML += '<div class="f"><label>' + r[1] + '</label>';
      if (r[2] === 'textarea') {
        fieldsHTML += '<textarea data-k="' + r[0] + '" rows="3">' + esc(val) + '</textarea>';
      } else {
        fieldsHTML += '<input data-k="' + r[0] + '" type="text" value="' + esc(val) + '">';
      }
      fieldsHTML += '</div>';
    });
    var html = '<div id="editOv" class="ov on" style="position:fixed;inset:0;' +
      'background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;' +
      'justify-content:center;padding:14px;overflow:auto">' +
      '<div style="background:#fff;border-radius:14px;max-width:520px;width:100%;' +
      'padding:22px;max-height:92vh;overflow:auto">' +
      '<h3 style="margin:0 0 12px">עריכת גמ"ח · ' + esc(g.name) + '</h3>' +
      '<div class="f"><label>קטגוריה</label>' +
      '<select data-k="category">' + catOpts + '</select></div>' +
      fieldsHTML +
      '<div class="acts" style="margin-top:16px;display:flex;gap:10px">' +
      '<button class="btn pri" id="edSave">שמור שינויים</button>' +
      '<button class="btn ghost" id="edCancel">ביטול</button>' +
      '</div><div class="msg" id="edMsg"></div></div></div>';
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap.firstChild);
    var close = function () { var o = $('editOv'); if (o) o.parentNode.removeChild(o); };
    $('edCancel').onclick = close;
    $('edSave').onclick = function () {
      var body = {};
      [].forEach.call(document.querySelectorAll('#editOv [data-k]'), function (el) {
        body[el.dataset.k] = el.value.trim();
      });
      $('edSave').disabled = true;
      api('gmachim?id=eq.' + g.id, { method: 'PATCH', body: JSON.stringify(body) })
        .then(function (r) {
          if (!r || !r.length) throw new Error('לא עודכנה שורה — בדוק הרשאות');
          close(); load();
        })
        .catch(function (e) {
          $('edMsg').textContent = 'שגיאה: ' + e.message;
          $('edMsg').className = 'msg err';
          $('edSave').disabled = false;
        });
    };
  }
  function catName(k) {
    var c = DATA.cats.filter(function (x) { return x.key === k; })[0];
    return c ? c.name : (k || '');
  }

  function paneSearch() {
    var agg = {};
    DATA.se.forEach(function (s) {
      if (!s.q) return;
      agg[s.q] = agg[s.q] || { n: 0, hits: 0 };
      agg[s.q].n++; agg[s.q].hits += s.results;
    });
    var rows = Object.keys(agg).map(function (q) {
      return { q: q, n: agg[q].n, avg: agg[q].hits / agg[q].n };
    }).sort(function (a, b) { return (a.avg - b.avg) || (b.n - a.n); });
    if (!rows.length) {
      $('pane').innerHTML = '<div class="empty"><b>עדיין לא חיפשו כלום</b>' +
        'כשתושבים יחפשו באתר, המילים יופיעו כאן — ובעיקר אלה שלא החזירו תוצאה.</div>';
      return;
    }
    $('pane').innerHTML = '<p style="color:var(--muted);font-size:14px">' +
      'מיון לפי הכי פחות תוצאות — אלה הגמ"חים שהיישוב מחפש ולא מוצא.</p>' +
      '<div class="wrap"><table class="tbl"><thead><tr><th>חיפוש</th><th>פעמים</th>' +
      '<th>תוצאות בממוצע</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr' + (r.avg === 0 ? ' style="background:#FFF6E8"' : '') + '><td>' +
          esc(r.q) + '</td><td>' + r.n + '</td><td>' + r.avg.toFixed(1) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function paneExport() {
    $('pane').innerHTML = '<div class="card"><h3>ייצוא הרשימה</h3>' +
      '<p>קובץ CSV עם כל הגמ"חים הפעילים — לפתיחה באקסל או להדבקה לגוגל שיטס.</p>' +
      '<div class="acts"><button class="btn pri" id="csv">הורדת CSV</button>' +
      '<button class="btn" id="copy">העתקה ללוח</button></div></div>';
    $('csv').onclick = function () {
      var b = new Blob(['﻿' + csv()], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = 'gmachim-maale-amos.csv'; a.click();
    };
    $('copy').onclick = function () {
      navigator.clipboard.writeText(csv()).then(function () {
        $('copy').textContent = 'הועתק ✓';
      });
    };
  }

  function csv() {
    var head = ['קוד', 'שם', 'קטגוריה', 'תיאור', 'אצל', 'טלפון', 'טלפון 2',
      'כתובת', 'שעות', 'עלות', 'הערות'];
    var q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    return [head.map(q).join(',')].concat(
      DATA.gm.filter(function (g) { return !g.is_wanted && g.status === 'approved'; })
        .map(function (g) {
          return [g.code, g.name, catName(g.category), g.description, g.owner_name,
            g.phone1, g.phone2, g.address, g.hours, g.price, g.notes].map(q).join(',');
        })).join('\r\n');
  }

  /* ---------- פעולות ---------- */
  function approve(id) {
    var s = DATA.sugg.filter(function (x) { return x.id === +id; })[0];
    if (!s) return;
    var p = s.payload || {};
    var body = {
      name: p.name, category: p.category || null, description: p.description || '',
      owner_name: p.owner_name || '', phone1: p.phone1 || '', phone2: p.phone2 || '',
      address: p.address || '', hours: p.hours || '', price: p.price || '',
      status: 'approved', is_wanted: false, source: s.source,
      verified_at: new Date().toISOString().slice(0, 10)
    };

    // אם ההצעה מפעילה גמ"ח שהיה "מבוקש" — לעדכן אותו, לא ליצור כפילות.
    // מזהים לפי activates_wanted מהאתר, או לפי שם זהה לרשומה מבוקשת.
    var target = DATA.gm.filter(function (g) {
      return g.is_wanted &&
        (g.name === p.activates_wanted || g.name === p.name);
    })[0];

    var call = target
      ? api('gmachim?id=eq.' + target.id, {
          method: 'PATCH',
          body: JSON.stringify(body)
        }).then(function (r) {
          if (!r || !r.length) throw new Error('לא עודכנה שורה — בדוק הרשאות');
        })
      : api('gmachim', { method: 'POST', body: JSON.stringify(body) });

    call.then(function () {
      return mark(id, 'done', target ? 'הפעיל גמ"ח מבוקש' : 'אושר ופורסם');
    }).then(load)
      .catch(function (e) { alert('שגיאה: ' + e.message); });
  }

  function mark(id, st, note) {
    return api('gmach_suggestions?id=eq.' + id, {
      method: 'PATCH',
      body: JSON.stringify({
        status: st, handled_note: note || '', handled_at: new Date().toISOString()
      })
    });
  }

  /* ---------- wiring ---------- */
  $('lForm').addEventListener('submit', login);
  $('out').addEventListener('click', function () {
    clearToks();
    location.reload();
  });
  $('tabs').addEventListener('click', function (e) {
    var b = e.target.closest('.tab'); if (!b) return;
    [].forEach.call(this.querySelectorAll('.tab'), function (x) { x.classList.remove('on'); });
    b.classList.add('on'); T = b.dataset.t; draw();
  });
  document.addEventListener('click', function (e) {
    var edit = e.target.closest && e.target.closest('.js-edit');
    if (edit) { openEdit(edit.dataset.id); return; }
    var loanE = e.target.closest && e.target.closest('.js-loan-edit');
    if (loanE) { openLoanForm(loanE.dataset.id); return; }
    var itE = e.target.closest && e.target.closest('.js-item-edit');
    if (itE) { openItemForm(itE.dataset.id); return; }
    var t = e.target;
    if (t.classList.contains('js-ok')) return approve(t.dataset.id);
    if (t.classList.contains('js-done')) return mark(t.dataset.id, 'done', 'טופל ידנית').then(load);
    if (t.classList.contains('js-rej')) return mark(t.dataset.id, 'rejected', '').then(load);
    if (t.classList.contains('js-loan-return')) return returnLoan(t.dataset.id);
    if (t.classList.contains('js-loan-reopen')) return reopenLoan(t.dataset.id);
    if (t.classList.contains('js-item-del')) return delItem(t.dataset.id);
    if (t.classList.contains('js-hide')) {
      return api('gmachim?id=eq.' + t.dataset.id, {
        method: 'PATCH', body: JSON.stringify({ status: t.dataset.s })
      }).then(load);
    }
  });

  try {
    var k = sessionStorage.getItem('gm_tok');
    if (k) { TOK = k; show(); }
  } catch (e) {}
})();

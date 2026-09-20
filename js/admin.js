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
      api('gmach_loans_view?select=*&order=is_overdue.desc,due_date.asc,date_out.desc'),
      api('residents?select=*&order=last_name,first_name')
    ]).then(function (r) {
      DATA.sugg = r[0]; DATA.gm = r[1]; DATA.cats = r[2]; DATA.se = r[3];
      DATA.items = r[4] || []; DATA.loans = r[5] || []; DATA.residents = r[6] || [];
      DATA.loanGroups = groupLoans(DATA.loans);
      var open = DATA.sugg.filter(function (s) { return s.status === 'new'; });
      var openGroups = DATA.loanGroups.filter(function (g) { return !g.returned_at; });
      $('bSugg').textContent = open.length;
      var bl = $('bLoans'); if (bl) bl.textContent = openGroups.length;
      var bb = $('bBorr'); if (bb) bb.textContent = DATA.residents.length;
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
    if (T === 'borrowers') return paneBorrowers();
    if (T === 'search') return paneSearch();
    if (T === 'export') return paneExport();
  }

  /* קיבוץ שורות ההשאלות: כל loan_group_id = השאלה אחת עם N פריטים */
  function groupLoans(rows) {
    var by = {};
    (rows || []).forEach(function (l) {
      var g = l.loan_group_id || ('_solo_' + l.id);
      if (!by[g]) {
        by[g] = {
          group_id: g,
          borrower_name: l.borrower_name || '',
          borrower_phone: l.borrower_phone || '',
          resident_id: l.resident_id,
          resident_full_name: l.resident_full_name,
          date_out: l.date_out,
          due_date: l.due_date,
          returned_at: l.returned_at,
          paid: l.paid,
          amount: 0,
          notes: l.notes || '',
          rows: [],
          is_overdue: false
        };
      }
      var grp = by[g];
      grp.rows.push(l);
      if (l.date_out && (!grp.date_out || l.date_out < grp.date_out)) grp.date_out = l.date_out;
      if (l.due_date && (!grp.due_date || l.due_date < grp.due_date)) grp.due_date = l.due_date;
      if (l.is_overdue) grp.is_overdue = true;
      grp.amount = (grp.amount || 0) + (Number(l.amount) || 0);
      if (l.returned_at && !grp.returned_at) grp.returned_at = l.returned_at;
      if (!l.returned_at) grp.returned_at = null; // אם שורה אחת עדיין פתוחה — הקבוצה פתוחה
    });
    return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) {
      if (a.is_overdue !== b.is_overdue) return a.is_overdue ? -1 : 1;
      if (!!a.returned_at !== !!b.returned_at) return a.returned_at ? 1 : -1;
      var da = a.due_date || a.date_out || '';
      var db = b.due_date || b.date_out || '';
      return db < da ? 1 : -1;
    });
  }

  function itemsSummary(rows) {
    return rows.map(function (l) {
      return esc((l.item_name || '—') + (l.qty > 1 ? ' × ' + l.qty : ''));
    }).join('<br>');
  }

  function loansOfBorrower(residentId, name, phone) {
    var norm = function (s) { return String(s || '').replace(/\D/g, ''); };
    return DATA.loanGroups.filter(function (g) {
      if (residentId && g.resident_id === residentId) return true;
      if (!residentId && name && g.borrower_name === name &&
          (!phone || norm(g.borrower_phone) === norm(phone))) return true;
      return false;
    });
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
    var groups = DATA.loanGroups;
    var open = groups.filter(function (g) { return !g.returned_at; });
    var overdue = open.filter(function (g) { return g.is_overdue; });
    var today = new Date().toISOString().slice(0, 10);
    var soon = open.filter(function (g) {
      if (g.is_overdue || !g.due_date) return false;
      var d = daysDiff(g.due_date, today);
      return d !== null && d >= 0 && d <= 2;
    });
    var closed = groups.filter(function (g) { return g.returned_at; }).slice(0, 30);

    var addBtn = '<button class="btn pri" id="loanNew" style="margin-bottom:14px">+ השאלה חדשה</button>';
    var summary = '<div class="stat">' +
      box(open.length, 'פתוחות') +
      box(overdue.length, 'באיחור') +
      box(soon.length, 'להחזרה השבוע') +
      '</div>';

    var makeRow = function (g) {
      var dueTxt = g.due_date ? fmtDate(g.due_date) : '—';
      var color = '';
      if (!g.returned_at && g.is_overdue) color = 'background:#FFE5E5';
      else if (!g.returned_at && soon.indexOf(g) >= 0) color = 'background:#FFF6E8';
      var borrowerCell =
        '<a href="#" class="js-borrower-card" data-name="' + esc(g.borrower_name) +
        '" data-phone="' + esc(g.borrower_phone || '') +
        '" data-rid="' + (g.resident_id || '') +
        '" style="color:#1E3A8A;text-decoration:underline">' + esc(g.borrower_name || '—') + '</a>' +
        (g.borrower_phone ? '<div style="font-size:12px;color:var(--muted)">' + esc(g.borrower_phone) + '</div>' : '');
      return '<tr style="' + color + '">' +
        '<td>' + itemsSummary(g.rows) + '</td>' +
        '<td>' + borrowerCell + '</td>' +
        '<td>' + fmtDate(g.date_out) + '</td>' +
        '<td>' + dueTxt + '</td>' +
        '<td>' + (g.returned_at ? fmtDate(g.returned_at) : '<b style="color:#B4400A">פתוח</b>') + '</td>' +
        '<td>' + (g.amount ? (g.paid ? '✔ ₪' + g.amount : '<span style="color:#B4400A">₪' + g.amount + '</span>') : '—') + '</td>' +
        '<td>' +
          (g.returned_at
            ? '<button class="btn sm js-loan-reopen" data-gid="' + g.group_id + '">בטל החזרה</button>'
            : '<button class="btn sm pri js-loan-return" data-gid="' + g.group_id + '">סמן כמוחזר</button> ' +
              '<button class="btn sm js-loan-edit" data-gid="' + g.group_id + '">ערוך</button>') +
        '</td>' +
      '</tr>';
    };

    var openHTML = open.length
      ? '<div class="wrap"><table class="tbl"><thead><tr>' +
        '<th>פריטים</th><th>שואל</th><th>יציאה</th><th>החזרה מתוכננת</th>' +
        '<th>הוחזר בפועל</th><th>עלות</th><th></th></tr></thead><tbody>' +
        open.map(makeRow).join('') + '</tbody></table></div>'
      : '<div class="empty"><b>אין השאלות פתוחות</b>הכל בבית.</div>';

    var closedHTML = closed.length
      ? '<h3 style="margin:24px 0 8px">30 השאלות אחרונות שהוחזרו</h3>' +
        '<div class="wrap"><table class="tbl"><thead><tr>' +
        '<th>פריטים</th><th>שואל</th><th>יציאה</th><th>החזרה מתוכננת</th>' +
        '<th>הוחזר בפועל</th><th>עלות</th><th></th></tr></thead><tbody>' +
        closed.map(makeRow).join('') + '</tbody></table></div>'
      : '';

    $('pane').innerHTML = addBtn + summary +
      '<h3 style="margin:16px 0 8px">השאלות פתוחות</h3>' + openHTML + closedHTML;

    $('loanNew').onclick = function () { openLoanForm(null); };
  }

  /* ---------- טופס השאלה (רב-פריטי + כרטיס משאיל) ---------- */
  var LOAN_EDIT_STATE = null; // {group_id, rows: [{id?, item_id, qty}], borrower_name, borrower_phone, resident_id, date_out, due_date, amount, paid, notes}

  function itemOptions(selectedId) {
    return '<option value="">— בחר פריט —</option>' + DATA.items.map(function (it) {
      var g = DATA.gm.filter(function (x) { return x.id === it.gmach_id; })[0];
      var lbl = it.name + (g ? ' · ' + g.name : '') +
                ' (זמין ' + it.avail_qty + '/' + it.total_qty + ')';
      return '<option value="' + it.id + '"' +
        (selectedId && selectedId === it.id ? ' selected' : '') + '>' + esc(lbl) + '</option>';
    }).join('');
  }

  function renderItemRows() {
    var box = $('loanItems'); if (!box) return;
    box.innerHTML = LOAN_EDIT_STATE.rows.map(function (row, i) {
      return '<div class="loan-item-row" data-i="' + i + '" ' +
        'style="display:flex;gap:6px;margin-bottom:6px;align-items:center">' +
        '<select data-k="item_id" style="flex:1">' + itemOptions(row.item_id) + '</select>' +
        '<input data-k="qty" type="number" min="1" value="' + (row.qty || 1) +
          '" style="width:72px" title="כמות">' +
        (LOAN_EDIT_STATE.rows.length > 1
          ? '<button class="btn sm js-item-row-del" data-i="' + i +
            '" style="color:#B4400A">✕</button>'
          : '<span style="width:32px"></span>') +
      '</div>';
    }).join('');
  }

  function readItemRowsFromDOM() {
    [].forEach.call(document.querySelectorAll('#loanItems .loan-item-row'), function (el) {
      var i = +el.dataset.i;
      var it = el.querySelector('[data-k="item_id"]');
      var qt = el.querySelector('[data-k="qty"]');
      LOAN_EDIT_STATE.rows[i].item_id = it.value ? +it.value : null;
      LOAN_EDIT_STATE.rows[i].qty = Math.max(1, Number(qt.value) || 1);
    });
  }

  function residentMatches(q) {
    q = String(q || '').trim();
    if (!q) return [];
    var digits = q.replace(/\D/g, '');
    var qLow = q.toLowerCase();
    return DATA.residents.filter(function (r) {
      var full = (r.full_name || (r.last_name + ' ' + r.first_name)).toLowerCase();
      if (full.indexOf(qLow) >= 0) return true;
      if (digits.length >= 3) {
        if ((r.phone_husband || '').replace(/\D/g, '').indexOf(digits) >= 0) return true;
        if ((r.phone_wife || '').replace(/\D/g, '').indexOf(digits) >= 0) return true;
      }
      return false;
    }).slice(0, 8);
  }

  function renderResidentSuggest() {
    var box = $('resSuggest'); if (!box) return;
    var q = $('borrName').value;
    var res = residentMatches(q);
    if (!res.length) { box.innerHTML = ''; box.style.display = 'none'; return; }
    box.style.display = 'block';
    box.innerHTML = res.map(function (r) {
      var subtitle = [r.phone_husband, r.phone_wife].filter(Boolean).join(' · ');
      return '<div class="js-res-pick" data-rid="' + r.id +
        '" data-name="' + esc(r.full_name) +
        '" data-p1="' + esc(r.phone_husband || '') +
        '" data-p2="' + esc(r.phone_wife || '') +
        '" style="padding:6px 8px;cursor:pointer;border-bottom:1px solid #eee">' +
        '<b>' + esc(r.full_name) + '</b>' +
        (subtitle ? '<div style="font-size:12px;color:#666">' + esc(subtitle) + '</div>' : '') +
      '</div>';
    }).join('');
  }

  function openLoanForm(existingGroupId) {
    if (!DATA.items.length) {
      alert('אין עדיין פריטים במלאי — קודם צריך להוסיף פריט בטאב "מלאי".');
      return;
    }
    var grp = existingGroupId
      ? DATA.loanGroups.filter(function (x) { return x.group_id === existingGroupId; })[0]
      : null;
    if (existingGroupId && !grp) return;

    var today = new Date().toISOString().slice(0, 10);
    var dueDefault = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

    LOAN_EDIT_STATE = grp
      ? {
          group_id: grp.group_id,
          rows: grp.rows.map(function (r) { return { id: r.id, item_id: r.item_id, qty: r.qty }; }),
          borrower_name: grp.borrower_name,
          borrower_phone: grp.borrower_phone,
          resident_id: grp.resident_id,
          date_out: grp.date_out,
          due_date: grp.due_date,
          amount: grp.amount,
          paid: !!grp.paid,
          notes: grp.notes
        }
      : {
          group_id: null,
          rows: [{ item_id: null, qty: 1 }],
          borrower_name: '',
          borrower_phone: '',
          resident_id: null,
          date_out: today,
          due_date: dueDefault,
          amount: '',
          paid: false,
          notes: ''
        };
    var S = LOAN_EDIT_STATE;

    var html = '<div id="loanOv" class="ov on" style="position:fixed;inset:0;' +
      'background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;' +
      'justify-content:center;padding:14px;overflow:auto">' +
      '<div style="background:#fff;border-radius:14px;max-width:560px;width:100%;' +
      'padding:22px;max-height:92vh;overflow:auto">' +
      '<h3 style="margin:0 0 12px">' + (grp ? 'עריכת השאלה' : 'השאלה חדשה') + '</h3>' +
      '<div class="f"><label>שם השואל</label>' +
        '<div style="position:relative">' +
        '<input id="borrName" type="text" autocomplete="off" value="' + esc(S.borrower_name) + '" placeholder="הקלד שם / טלפון">' +
        '<div id="resSuggest" style="position:absolute;top:100%;left:0;right:0;background:#fff;' +
        'border:1px solid #ddd;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.1);' +
        'z-index:10;max-height:220px;overflow:auto;display:none"></div>' +
        '</div>' +
        (S.resident_id
          ? '<div style="font-size:12px;color:#0A7B36;margin-top:4px" id="resTag">✓ מקושר לתושב מהמאגר</div>'
          : '<div style="font-size:12px;color:#999;margin-top:4px" id="resTag"></div>') +
      '</div>' +
      '<div class="f"><label>טלפון</label>' +
        '<input id="borrPhone" type="tel" value="' + esc(S.borrower_phone) + '"></div>' +
      '<div class="f"><label>פריטים בהשאלה</label>' +
        '<div id="loanItems"></div>' +
        '<button class="btn sm ghost" id="itemAddRow" style="margin-top:4px">+ פריט נוסף</button>' +
      '</div>' +
      '<div class="f" style="display:flex;gap:10px">' +
        '<div style="flex:1"><label>תאריך יציאה</label>' +
          '<input id="dateOut" type="date" value="' + (S.date_out || today) + '"></div>' +
        '<div style="flex:1"><label>תאריך החזרה מתוכנן</label>' +
          '<input id="dateDue" type="date" value="' + (S.due_date || dueDefault) + '"></div>' +
      '</div>' +
      '<div class="f"><label>עלות (אופציונלי, סה"כ להשאלה)</label>' +
        '<input id="amt" type="number" step="0.5" value="' + (S.amount || '') + '"></div>' +
      '<div class="f"><label style="display:flex;align-items:center;gap:8px">' +
        '<input id="paid" type="checkbox"' + (S.paid ? ' checked' : '') + '> שולם</label></div>' +
      '<div class="f"><label>הערות</label>' +
        '<textarea id="notes" rows="2">' + esc(S.notes) + '</textarea></div>' +
      '<div class="acts" style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap">' +
      '<button class="btn pri" id="loanSave">' + (grp ? 'עדכן' : 'שמור השאלה') + '</button>' +
      (grp ? '<button class="btn ghost" id="loanDel" style="color:#B4400A;border-color:#B4400A">מחק השאלה</button>' : '') +
      '<button class="btn ghost" id="loanCancel">ביטול</button>' +
      '</div><div class="msg" id="loanMsg"></div></div></div>';

    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap.firstChild);
    renderItemRows();

    var close = function () { var o = $('loanOv'); if (o) o.parentNode.removeChild(o); LOAN_EDIT_STATE = null; };
    $('loanCancel').onclick = close;

    $('itemAddRow').onclick = function () {
      readItemRowsFromDOM();
      LOAN_EDIT_STATE.rows.push({ item_id: null, qty: 1 });
      renderItemRows();
    };
    $('loanItems').addEventListener('click', function (e) {
      var d = e.target.closest && e.target.closest('.js-item-row-del');
      if (!d) return;
      readItemRowsFromDOM();
      LOAN_EDIT_STATE.rows.splice(+d.dataset.i, 1);
      renderItemRows();
    });

    $('borrName').addEventListener('input', function () {
      LOAN_EDIT_STATE.resident_id = null;
      var tag = $('resTag'); if (tag) { tag.textContent = ''; tag.style.color = '#999'; }
      renderResidentSuggest();
    });
    $('borrName').addEventListener('blur', function () {
      setTimeout(function () { var b = $('resSuggest'); if (b) b.style.display = 'none'; }, 200);
    });
    $('borrName').addEventListener('focus', renderResidentSuggest);
    $('resSuggest').addEventListener('mousedown', function (e) {
      var it = e.target.closest && e.target.closest('.js-res-pick');
      if (!it) return;
      e.preventDefault();
      $('borrName').value = it.dataset.name;
      var phoneEl = $('borrPhone');
      if (!phoneEl.value.trim()) {
        phoneEl.value = it.dataset.p1 || it.dataset.p2 || '';
      }
      LOAN_EDIT_STATE.resident_id = +it.dataset.rid;
      var tag = $('resTag');
      if (tag) { tag.textContent = '✓ מקושר לתושב מהמאגר'; tag.style.color = '#0A7B36'; }
      $('resSuggest').style.display = 'none';
    });

    if ($('loanDel')) $('loanDel').onclick = function () {
      if (!confirm('למחוק את ההשאלה כולה?')) return;
      api('gmach_loans?loan_group_id=eq.' + grp.group_id, { method: 'DELETE' })
        .then(function () { close(); load(); })
        .catch(function (e) {
          $('loanMsg').textContent = 'שגיאה: ' + e.message;
          $('loanMsg').className = 'msg err';
        });
    };

    $('loanSave').onclick = function () {
      readItemRowsFromDOM();
      var name = $('borrName').value.trim();
      var phone = $('borrPhone').value.trim();
      var dOut = $('dateOut').value || today;
      var dDue = $('dateDue').value || null;
      var amt  = $('amt').value === '' ? null : Number($('amt').value);
      var paid = $('paid').checked;
      var notes = $('notes').value.trim();

      if (!name) {
        $('loanMsg').textContent = 'חסר שם שואל';
        $('loanMsg').className = 'msg err'; return;
      }
      var rows = LOAN_EDIT_STATE.rows.filter(function (r) { return r.item_id; });
      if (!rows.length) {
        $('loanMsg').textContent = 'חסרים פריטים בהשאלה';
        $('loanMsg').className = 'msg err'; return;
      }
      // בדיקת זמינות (מלאי שלא כולל את השורות של הקבוצה הנוכחית אם עורכים)
      var editingRowIds = grp ? grp.rows.map(function (r) { return r.id; }) : [];
      var overflow = null;
      var totals = {};
      rows.forEach(function (r) {
        totals[r.item_id] = (totals[r.item_id] || 0) + r.qty;
      });
      Object.keys(totals).forEach(function (iid) {
        var it = DATA.items.filter(function (x) { return x.id === +iid; })[0];
        if (!it) return;
        var alreadyOutFromThisGroup = 0;
        if (grp) {
          grp.rows.forEach(function (rr) {
            if (rr.item_id === +iid && !rr.returned_at) alreadyOutFromThisGroup += rr.qty;
          });
        }
        var effectiveAvail = it.avail_qty + alreadyOutFromThisGroup;
        if (totals[iid] > effectiveAvail) {
          overflow = it.name + ' — מבוקש ' + totals[iid] + ', זמין ' + effectiveAvail;
        }
      });
      if (overflow) {
        $('loanMsg').textContent = 'אין מספיק במלאי: ' + overflow;
        $('loanMsg').className = 'msg err'; return;
      }

      $('loanSave').disabled = true;

      var shared = {
        borrower_name: name,
        borrower_phone: phone,
        resident_id: LOAN_EDIT_STATE.resident_id,
        date_out: dOut,
        due_date: dDue,
        paid: paid,
        notes: notes
      };
      // עלות: שומרים על השורה הראשונה בלבד; שאר השורות = null (למנוע ספירה כפולה)
      var perRow = function (i) {
        var r = Object.assign({}, shared);
        r.amount = i === 0 ? amt : null;
        return r;
      };

      var chain;
      if (!grp) {
        // חדשה: יוצרים group_id בצד השרת (default gen_random_uuid), אבל נעדיף לחלוק אחד ידני
        // ניצור UUID אקראי בצד הלקוח כדי לוודא שכל השורות משתפות group_id.
        var uuid = (crypto && crypto.randomUUID) ? crypto.randomUUID() :
          'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
          });
        var body = rows.map(function (row, i) {
          return Object.assign({
            item_id: row.item_id, qty: row.qty, loan_group_id: uuid
          }, perRow(i));
        });
        chain = api('gmach_loans', { method: 'POST', body: JSON.stringify(body) });
      } else {
        // עריכה: לזהות שורות למחיקה, לעדכון, ליצירה
        var origIds = grp.rows.map(function (r) { return r.id; });
        var keptIds = rows.filter(function (r) { return r.id; }).map(function (r) { return r.id; });
        var toDel = origIds.filter(function (id) { return keptIds.indexOf(id) < 0; });

        var promises = [];
        // עדכון פרטים משותפים לכל השורות של הקבוצה
        promises.push(api('gmach_loans?loan_group_id=eq.' + grp.group_id, {
          method: 'PATCH', body: JSON.stringify(shared)
        }));
        // עלות: PATCH רק על השורה הראשונה שנשמרת (או ליצור חדשה אם אין)
        // מחיקות
        toDel.forEach(function (id) {
          promises.push(api('gmach_loans?id=eq.' + id, { method: 'DELETE' }));
        });
        // עדכון qty לפריטים ששרדו
        rows.forEach(function (r, i) {
          if (r.id) {
            var patch = { item_id: r.item_id, qty: r.qty };
            if (i === 0) patch.amount = amt;
            promises.push(api('gmach_loans?id=eq.' + r.id, {
              method: 'PATCH', body: JSON.stringify(patch)
            }));
          } else {
            var newRow = Object.assign({
              item_id: r.item_id, qty: r.qty, loan_group_id: grp.group_id
            }, perRow(i));
            promises.push(api('gmach_loans', { method: 'POST', body: JSON.stringify(newRow) }));
          }
        });
        chain = Promise.all(promises);
      }

      chain.then(function () { close(); load(); })
        .catch(function (e) {
          $('loanMsg').textContent = 'שגיאה: ' + e.message;
          $('loanMsg').className = 'msg err';
          $('loanSave').disabled = false;
        });
    };
  }

  function returnLoanGroup(groupId) {
    var today = new Date().toISOString().slice(0, 10);
    api('gmach_loans?loan_group_id=eq.' + groupId, {
      method: 'PATCH',
      body: JSON.stringify({ returned_at: today, paid: true })
    }).then(function (r) {
      if (!r || !r.length) throw new Error('לא עודכנו שורות');
      load();
    }).catch(function (e) { alert('שגיאה: ' + e.message); });
  }
  function reopenLoanGroup(groupId) {
    api('gmach_loans?loan_group_id=eq.' + groupId, {
      method: 'PATCH', body: JSON.stringify({ returned_at: null })
    }).then(function (r) {
      if (!r || !r.length) throw new Error('לא עודכנו שורות');
      load();
    }).catch(function (e) { alert('שגיאה: ' + e.message); });
  }

  /* ---------- טאב משאילים ---------- */
  function paneBorrowers() {
    var q = ($('borrSearch') && $('borrSearch').value || '').trim();
    var filter = q.length >= 1 ? residentMatches(q) : DATA.residents;

    // סטטיסטיקה לכל תושב
    var byId = {};
    DATA.loanGroups.forEach(function (g) {
      if (!g.resident_id) return;
      var s = byId[g.resident_id] || (byId[g.resident_id] = { total: 0, open: 0, overdue: 0 });
      s.total += 1;
      if (!g.returned_at) s.open += 1;
      if (g.is_overdue) s.overdue += 1;
    });

    var rows = filter.map(function (r) {
      var s = byId[r.id] || { total: 0, open: 0, overdue: 0 };
      var phones = [r.phone_husband, r.phone_wife].filter(Boolean).join(' · ');
      var openHtml = s.open
        ? '<b style="color:' + (s.overdue ? '#B4400A' : '#0A7B36') + '">' + s.open +
          (s.overdue ? ' (' + s.overdue + ' באיחור)' : '') + '</b>'
        : '—';
      return '<tr class="js-borrower-card" data-rid="' + r.id + '" style="cursor:pointer">' +
        '<td><b>' + esc(r.full_name || (r.last_name + ' ' + r.first_name)) + '</b></td>' +
        '<td>' + esc(phones) + '</td>' +
        '<td>' + openHtml + '</td>' +
        '<td>' + s.total + '</td>' +
      '</tr>';
    }).join('');

    var searchBox = '<input id="borrSearch" type="search" placeholder="חיפוש: שם או טלפון" ' +
      'value="' + esc(q) + '" style="margin-bottom:10px;width:280px;max-width:100%">';

    var table = filter.length
      ? '<div class="wrap"><table class="tbl"><thead><tr>' +
        '<th>שם</th><th>טלפון</th><th>השאלות פתוחות</th><th>סה"כ השאלות</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<div class="empty"><b>לא נמצאו תושבים בחיפוש הזה</b></div>';

    $('pane').innerHTML = searchBox + table;
    $('borrSearch').oninput = function () { paneBorrowers(); };
    $('borrSearch').focus();
  }

  function openBorrowerCard(opts) {
    // opts: {rid?, name?, phone?}
    var r = opts.rid ? DATA.residents.filter(function (x) { return x.id === +opts.rid; })[0] : null;
    var displayName = r ? (r.full_name || (r.last_name + ' ' + r.first_name)) : (opts.name || '—');
    var phones = r
      ? [r.phone_husband, r.phone_wife].filter(Boolean).join(' · ')
      : (opts.phone || '');

    var groups = loansOfBorrower(r ? r.id : null, opts.name || displayName, opts.phone);
    var open = groups.filter(function (g) { return !g.returned_at; });
    var closed = groups.filter(function (g) { return g.returned_at; });

    var loanRow = function (g) {
      var color = '';
      if (!g.returned_at && g.is_overdue) color = 'background:#FFE5E5';
      return '<tr style="' + color + '">' +
        '<td>' + itemsSummary(g.rows) + '</td>' +
        '<td>' + fmtDate(g.date_out) + '</td>' +
        '<td>' + (g.due_date ? fmtDate(g.due_date) : '—') + '</td>' +
        '<td>' + (g.returned_at ? fmtDate(g.returned_at) : '<b style="color:#B4400A">פתוח</b>') + '</td>' +
        '<td>' + (g.amount ? '₪' + g.amount + (g.paid ? ' ✔' : '') : '—') + '</td>' +
        '<td>' + (!g.returned_at
          ? '<button class="btn sm js-loan-edit" data-gid="' + g.group_id + '">ערוך</button>'
          : '<button class="btn sm js-loan-reopen" data-gid="' + g.group_id + '">בטל החזרה</button>') +
        '</td></tr>';
    };
    var tbl = function (list, title) {
      if (!list.length) return '';
      return '<h4 style="margin:14px 0 6px">' + title + '</h4>' +
        '<div class="wrap"><table class="tbl"><thead><tr>' +
        '<th>פריטים</th><th>יציאה</th><th>החזרה מתוכננת</th><th>הוחזר</th><th>עלות</th><th></th>' +
        '</tr></thead><tbody>' + list.map(loanRow).join('') + '</tbody></table></div>';
    };

    var html = '<div id="borrOv" class="ov on" style="position:fixed;inset:0;' +
      'background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;' +
      'justify-content:center;padding:14px;overflow:auto">' +
      '<div style="background:#fff;border-radius:14px;max-width:820px;width:100%;' +
      'padding:22px;max-height:92vh;overflow:auto">' +
      '<div style="display:flex;justify-content:space-between;align-items:start;gap:10px">' +
        '<div>' +
          '<h3 style="margin:0">' + esc(displayName) + '</h3>' +
          (phones ? '<div style="color:#666">' + esc(phones) + '</div>' : '') +
        '</div>' +
        '<button class="btn ghost" id="borrCancel">סגור</button>' +
      '</div>' +
      '<div class="stat" style="margin-top:12px">' +
        box(open.length, 'פתוחות') +
        box(open.filter(function (g) { return g.is_overdue; }).length, 'באיחור') +
        box(closed.length, 'הוחזרו') +
      '</div>' +
      (groups.length
        ? tbl(open, 'השאלות פתוחות') + tbl(closed, 'היסטוריה')
        : '<div class="empty" style="margin-top:12px"><b>אין השאלות רשומות למשאיל הזה</b></div>') +
      '<div style="margin-top:16px">' +
        '<button class="btn pri" id="borrNewLoan">+ השאלה חדשה למשאיל הזה</button>' +
      '</div>' +
      '</div></div>';

    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap.firstChild);
    var close = function () { var o = $('borrOv'); if (o) o.parentNode.removeChild(o); };
    $('borrCancel').onclick = close;
    $('borrNewLoan').onclick = function () {
      close();
      openLoanForm(null);
      // מילוי מיידי של פרטי המשאיל בטופס החדש
      setTimeout(function () {
        if (!LOAN_EDIT_STATE) return;
        var n = $('borrName'), p = $('borrPhone');
        if (n) n.value = displayName;
        if (p && !p.value) p.value = r ? (r.phone_husband || r.phone_wife || '') : (opts.phone || '');
        if (r) {
          LOAN_EDIT_STATE.resident_id = r.id;
          var tag = $('resTag');
          if (tag) { tag.textContent = '✓ מקושר לתושב מהמאגר'; tag.style.color = '#0A7B36'; }
        }
      }, 0);
    };
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
    if (loanE) { openLoanForm(loanE.dataset.gid); return; }
    var itE = e.target.closest && e.target.closest('.js-item-edit');
    if (itE) { openItemForm(itE.dataset.id); return; }
    var bc = e.target.closest && e.target.closest('.js-borrower-card');
    if (bc) {
      e.preventDefault();
      openBorrowerCard({
        rid: bc.dataset.rid && bc.dataset.rid !== '' ? +bc.dataset.rid : null,
        name: bc.dataset.name || '',
        phone: bc.dataset.phone || ''
      });
      return;
    }
    var t = e.target;
    if (t.classList.contains('js-ok')) return approve(t.dataset.id);
    if (t.classList.contains('js-done')) return mark(t.dataset.id, 'done', 'טופל ידנית').then(load);
    if (t.classList.contains('js-rej')) return mark(t.dataset.id, 'rejected', '').then(load);
    if (t.classList.contains('js-loan-return')) return returnLoanGroup(t.dataset.gid);
    if (t.classList.contains('js-loan-reopen')) return reopenLoanGroup(t.dataset.gid);
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

/* БАС Тест — логика приложения (чистый JavaScript, без библиотек) */
(function () {
  'use strict';

  /* ================= Константы ================= */
  var STORE_KEY = 'bas-test-state-v1';
  var DISC_ORDER = ['МДК 01.01', 'МДК 01.02', 'МДК 02.01', 'МДК 02.02', 'ОП.14'];
  var COMPS = ['ПК 1.2', 'ПК 1.4', 'ПК 2.1', 'ПК 2.2', 'ПК 2.4'];
  var COMP_TITLES = {
    'ПК 1.2': 'Эксплуатация БВС самолётного типа, в том числе в особых случаях',
    'ПК 1.4': 'Выявление и устранение неисправностей БВС самолётного типа',
    'ПК 2.1': 'Предварительная и предполётная подготовка БВС вертолётного типа',
    'ПК 2.2': 'Эксплуатация БВС вертолётного типа, в том числе в особых случаях',
    'ПК 2.4': 'Выявление и устранение неисправностей БВС вертолётного типа'
  };
  var TYPE_GROUPS = [
    { key: 'match', title: 'Соответствие', sub: 'Составьте пары', test: function (q) { return q.source === 'match'; } },
    { key: 'order', title: 'Последовательность', sub: 'Расставьте шаги по порядку', test: function (q) { return q.source === 'order'; } },
    { key: 'open', title: 'Бывшие письменные', sub: 'Термины и определения', test: function (q) { return q.source === 'open-short' || q.source === 'open-long'; } },
    { key: 'choice', title: 'Выбор ответа', sub: 'Один или несколько вариантов', test: function (q) { return q.source === 'choice'; } }
  ];
  var PAIR_COLORS = ['#2563EB', '#7C3AED', '#C2410C', '#0F766E', '#BE123C', '#15803D'];
  var LETTERS = 'АБВГДЕЖЗ';
  var EXAM_SIZE = 20;
  var EXAM_MINUTES = 20;
  var TICKET_COUNT = 7;

  var Q = QUESTIONS;
  var byId = {};
  Q.forEach(function (q) { byId[q.id] = q; });

  /* ================= Иконки ================= */
  function svg(path, extra) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (extra || '') + '>' + path + '</svg>';
  }
  var I = {
    back: svg('<path d="M15 18l-6-6 6-6"/>'),
    gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    star: svg('<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>'),
    starFill: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/></svg>',
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', ' stroke-width="3"'),
    cross: svg('<path d="M18 6L6 18M6 6l12 12"/>'),
    tickets: svg('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
    topics: svg('<path d="M4 6h16M4 12h16M4 18h10"/>'),
    exam: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>'),
    marathon: svg('<path d="M4 20c4 0 4-16 8-16s4 16 8 16"/>'),
    mistakes: svg('<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>'),
    fav: svg('<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>'),
    stats: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    chevron: svg('<path d="M9 6l6 6-6 6"/>'),
    play: svg('<path d="M7 4.5v15l12-7.5z"/>', ' fill="currentColor"'),
    info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
    hand: svg('<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V11m0-.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3.6 15a1.5 1.5 0 0 1 2.5-1.7L9 16"/>')
  };
  var DRONE = '<svg class="drone" viewBox="0 0 200 200" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" aria-hidden="true">' +
    '<path d="M62 62l76 76M138 62l-76 76"/><rect x="80" y="80" width="40" height="40" rx="12" fill="#fff" fill-opacity=".25"/>' +
    '<circle cx="52" cy="52" r="30"/><circle cx="148" cy="52" r="30"/><circle cx="52" cy="148" r="30"/><circle cx="148" cy="148" r="30"/>' +
    '<circle cx="52" cy="52" r="5" fill="#fff"/><circle cx="148" cy="52" r="5" fill="#fff"/><circle cx="52" cy="148" r="5" fill="#fff"/><circle cx="148" cy="148" r="5" fill="#fff"/></svg>';
  var KIND = { single: 'Один ответ', multi: 'Несколько ответов', match: 'Соответствие', order: 'Последовательность' };

  /* ================= Хранилище ================= */
  function defaultSettings() { return { theme: 'system', shuffle: true, extra: true, font: 'normal', autoNext: false }; }
  function defaultState() {
    return {
      stats: {},        // id -> { a: попыток, c: верных, last: 1/0 }
      mistakes: {},     // id -> сколько раз подряд верно
      fav: [],
      tickets: {},      // номер -> { errors, date }
      marathon: null,   // { order, answers, cur }
      exams: [],
      totalAnswers: 0,
      totalCorrect: 0,
      iosHintClosed: false,
      settings: defaultSettings()
    };
  }
  function load() {
    var def = defaultState();
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var d = JSON.parse(raw);
        var st = Object.assign(def, d);
        st.settings = Object.assign(defaultSettings(), d.settings || {});
        return st;
      }
    } catch (e) { /* хранилище недоступно */ }
    return def;
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* игнор */ }
  }
  var S = load();

  /* ================= Утилиты ================= */
  function $(sel) { return document.querySelector(sel); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function range(n) { var r = []; for (var i = 0; i < n; i++) r.push(i); return r; }
  function shuffledPerm(n, avoidIdentity) {
    var p, tries = 0;
    do {
      p = shuffle(range(n)); tries++;
    } while (avoidIdentity && n > 1 && tries < 30 && p.every(function (v, i) { return v === i; }));
    return p;
  }
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }
  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function fmtDate(ts) {
    var d = new Date(ts);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function vibrate() { try { if (navigator.vibrate) navigator.vibrate(30); } catch (e) { /* нет */ } }
  function isOpen(q) { return q.source === 'open-short' || q.source === 'open-long'; }

  /* ================= Билеты: фиксированное сбалансированное разбиение ================= */
  var TICKETS = (function () {
    var g = { match: [], order: [], open: [], choice: [] };
    Q.forEach(function (q) { g[isOpen(q) ? 'open' : q.source].push(q.id); });
    var byD = {};
    g.choice.forEach(function (id) { var d = byId[id].discipline; (byD[d] = byD[d] || []).push(id); });
    var inter = [], added = true;
    while (added) {
      added = false;
      DISC_ORDER.forEach(function (d) { if (byD[d] && byD[d].length) { inter.push(byD[d].shift()); added = true; } });
    }
    var list = g.match.concat(g.order, g.open, inter);
    var t = []; for (var i = 0; i < TICKET_COUNT; i++) t.push([]);
    list.forEach(function (id, i) { t[i % TICKET_COUNT].push(id); });
    return t;
  })();

  /* ================= Настройки внешнего вида ================= */
  function applySettings() {
    var r = document.documentElement;
    if (S.settings.theme === 'system') r.removeAttribute('data-theme');
    else r.setAttribute('data-theme', S.settings.theme);
    r.setAttribute('data-font', S.settings.font);
  }
  applySettings();

  /* ================= Навигация ================= */
  var route = { name: 'home', params: {} };
  var session = null;
  var lastResult = null;
  var leavingExam = false;

  function go(name, params, replace) {
    route = { name: name, params: params || {} };
    try {
      if (replace) history.replaceState(route, '');
      else history.pushState(route, '');
    } catch (e) { /* file:// и т.п. */ }
    render();
    window.scrollTo(0, 0);
  }
  window.addEventListener('popstate', function (e) {
    if (!leavingExam && route.name === 'quiz' && session && session.mode === 'exam' && !session.finished) {
      try { history.pushState(route, ''); } catch (err) { /* игнор */ }
      confirmLeaveExam();
      return;
    }
    leavingExam = false;
    route = (e.state && e.state.name) ? e.state : { name: 'home', params: {} };
    render();
    window.scrollTo(0, 0);
  });
  function confirmLeaveExam() {
    showModal({
      title: 'Прервать экзамен?',
      text: 'Результат этой попытки не сохранится.',
      buttons: [
        { label: 'Продолжить экзамен' },
        { label: 'Прервать', cls: 'danger', fn: function () { stopTimer(); session.finished = true; session = null; leavingExam = true; history.back(); } }
      ]
    });
  }

  /* ================= Отрисовка ================= */
  var SCREENS = {};
  var AFTER = {};

  function render() {
    var name = route.name;
    if ((name === 'quiz' && (!session || session.finished)) || (name === 'result' && !lastResult)) {
      route = { name: 'home', params: {} };
      try { history.replaceState(route, ''); } catch (e) { /* игнор */ }
      name = 'home';
    }
    var fn = SCREENS[name] || SCREENS.home;
    var noTabs = name === 'quiz' || name === 'result';
    var v = $('#view');
    v.className = 'view' + (noTabs ? ' no-tabs' : '');
    v.innerHTML = fn(route.params);
    $('#tabbar').classList.toggle('hidden', noTabs);
    var tabs = document.querySelectorAll('#tabbar [data-tab]');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('on', tabs[i].getAttribute('data-tab') === name);
    var mc = Object.keys(S.mistakes).length;
    var dot = $('#mistakesDot');
    dot.textContent = mc > 99 ? '99+' : String(mc);
    dot.classList.toggle('hidden', mc === 0);
    if (AFTER[name]) AFTER[name]();
  }

  function head(title, right, noBack) {
    return '<header class="topbar">' +
      (noBack ? '' : '<button class="icon-btn" data-act="back" aria-label="Назад">' + I.back + '</button>') +
      '<h1>' + esc(title) + '</h1>' + (right || '') + '</header>';
  }

  function countStudied() { return Object.keys(S.stats).filter(function (id) { return byId[id]; }).length; }
  function groupProgress(ids) {
    var studied = 0, right = 0;
    ids.forEach(function (id) { var st = S.stats[id]; if (st) { studied++; if (st.last) right++; } });
    return { studied: studied, right: right, total: ids.length };
  }

  /* ---------- Главная ---------- */
  var deferredPrompt = null;
  function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function isStandalone() { return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }

  function installBanner() {
    if (isStandalone()) return '';
    if (deferredPrompt) {
      return '<div class="banner"><p>Установите тренажёр на телефон — он будет открываться как приложение и работать без интернета.</p>' +
        '<button class="btn small-btn" data-act="install">Установить</button></div>';
    }
    if (isIOS() && !S.iosHintClosed) {
      return '<div class="banner"><p>Чтобы установить на iPhone: нажмите «Поделиться», затем «На экран Домой».</p>' +
        '<button class="icon-btn" data-act="closeIos" aria-label="Закрыть">' + I.cross + '</button></div>';
    }
    return '';
  }

  function ring(pct) {
    var c = 2 * Math.PI * 40;
    return '<div class="ring"><svg viewBox="0 0 92 92"><circle class="trk" cx="46" cy="46" r="40" fill="none" stroke-width="10"/>' +
      '<circle class="arc" cx="46" cy="46" r="40" fill="none" stroke-width="10" stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + (c * (1 - pct / 100)).toFixed(1) + '"/></svg>' +
      '<div class="val">' + pct + '%</div></div>';
  }

  function tile(act, to, icon, title, sub, cls, cnt) {
    return '<button class="row" data-act="' + act + '" data-to="' + to + '"><span class="ri">' + icon + '</span>' +
      '<div class="grow"><b>' + title + '</b><span>' + sub + '</span></div>' +
      (cnt ? '<em class="cnt">' + cnt + '</em>' : '') + I.chevron + '</button>';
  }
  function firstTicketToDo() {
    for (var i = 1; i <= TICKET_COUNT; i++) { var r = S.tickets[i]; if (!r || r.errors) return i; }
    return 0;
  }

  SCREENS.home = function () {
    var studied = countStudied();
    var pct = S.totalAnswers ? Math.round(S.totalCorrect / S.totalAnswers * 100) : 0;
    var mc = Object.keys(S.mistakes).length;
    var m = S.marathon;
    var mAnswered = m ? Object.keys(m.answers).length : 0;
    var mSub = m && mAnswered < Q.length ? 'Пройдено ' + mAnswered + ' из ' + Q.length : 'Все ' + Q.length + ' ' + plural(Q.length, 'вопрос', 'вопроса', 'вопросов') + ' подряд';
    var cta;
    if (m && mAnswered > 0 && mAnswered < Q.length) {
      cta = ['marathonContinue', '', 'Продолжить марафон', 'Отвечено ' + mAnswered + ' из ' + Q.length];
    } else {
      var t = firstTicketToDo();
      cta = t ? ['ticket', t, 'Решать билет ' + t, S.tickets[t] ? 'Исправить ошибки в билете' : '12 вопросов с пояснениями']
              : ['examStart', '', 'Пройти экзамен', 'Все билеты решены без ошибок'];
    }
    var sPct = Math.round(studied / Q.length * 100);
    return '<header class="home-head"><div class="grow"><p class="eyebrow">25.02.08 · Диагностическая работа</p><h1>БАС Тест</h1></div>' +
      '<button class="icon-btn" data-act="nav" data-to="settings" aria-label="Настройки">' + I.gear + '</button></header>' +
      '<div class="overview"><div class="ov-num"><b>' + studied + '</b><span>из ' + Q.length + ' изучено</span></div>' +
      '<div class="bar"><i style="width:' + sPct + '%"></i></div>' +
      '<div class="ov-meta"><span>Верных ответов <b>' + pct + '%</b></span><span>Всего ответов <b>' + S.totalAnswers + '</b></span></div></div>' +
      '<button class="btn cta" data-act="' + cta[0] + '" data-n="' + cta[1] + '"><span>' + cta[2] + '</span><small>' + cta[3] + '</small></button>' +
      installBanner() +
      '<div class="section-title">Режимы</div>' +
      '<div class="menu">' +
      tile('nav', 'tickets', I.tickets, 'Билеты', TICKET_COUNT + ' билетов по 12 вопросов', 'c-blue') +
      tile('nav', 'examIntro', I.exam, 'Экзамен', EXAM_SIZE + ' вопросов, ' + EXAM_MINUTES + ' минут', 'c-violet') +
      tile('nav', 'topics', I.topics, 'Темы', 'По дисциплинам, ПК и типам', 'c-teal') +
      tile('nav', 'marathon', I.marathon, 'Марафон', mSub, 'c-orange') +
      tile('nav', 'mistakes', I.mistakes, 'Ошибки', mc ? 'Повторите их' : 'Пока нет', 'c-red', mc) +
      tile('nav', 'favorites', I.fav, 'Избранное', S.fav.length ? 'Сохранённые вопросы' : 'Отмечайте звёздочкой', 'c-amber', S.fav.length) +
      tile('nav', 'stats', I.stats, 'Статистика', 'Прогресс и история экзаменов', 'wide c-slate') +
      '</div>';
  };

  /* ---------- Билеты ---------- */
  SCREENS.tickets = function () {
    return head('Билеты') + '<div class="ticket-grid">' + TICKETS.map(function (ids, i) {
      var r = S.tickets[i + 1], cls = '', st = 'Не решён';
      if (r) {
        if (r.errors === 0) { cls = 'ok'; st = 'Без ошибок'; }
        else { cls = 'bad'; st = r.errors + ' ' + plural(r.errors, 'ошибка', 'ошибки', 'ошибок'); }
      }
      return '<button class="ticket ' + cls + '" data-act="ticket" data-n="' + (i + 1) + '"><div><span class="tn">' + (i + 1) + '</span></div>' +
        '<div><b>Билет ' + (i + 1) + '</b><div class="muted small">' + ids.length + ' вопросов</div></div><span><span class="badge ' + cls + '">' + st + '</span></span></button>';
    }).join('') + '</div>';
  };

  /* ---------- Темы ---------- */
  function groupIds(kind, key) {
    if (kind === 'disc') return Q.filter(function (q) { return q.discipline === key; }).map(function (q) { return q.id; });
    if (kind === 'comp') return Q.filter(function (q) { return q.competence === key; }).map(function (q) { return q.id; });
    var g = TYPE_GROUPS.filter(function (t) { return t.key === key; })[0];
    return Q.filter(g.test).map(function (q) { return q.id; });
  }
  function groupTitle(kind, key) {
    if (kind === 'type') return TYPE_GROUPS.filter(function (t) { return t.key === key; })[0].title;
    return key;
  }
  SCREENS.topics = function (p) {
    var tab = p.tab || 'disc';
    var items;
    if (tab === 'disc') items = DISC_ORDER.map(function (d) { return { key: d, title: d, sub: DISCIPLINE_SHORT[d] }; });
    else if (tab === 'comp') items = COMPS.map(function (c) { return { key: c, title: c, sub: COMP_TITLES[c] }; });
    else items = TYPE_GROUPS.map(function (t) { return { key: t.key, title: t.title, sub: t.sub }; });
    function segBtn(k, label) { return '<button class="' + (tab === k ? 'on' : '') + '" data-act="topicTab" data-tab="' + k + '">' + label + '</button>'; }
    return head('Темы') +
      '<div class="seg">' + segBtn('disc', 'Дисциплины') + segBtn('comp', 'Компетенции') + segBtn('type', 'Типы') + '</div>' +
      items.map(function (it) {
        var ids = groupIds(tab, it.key), gp = groupProgress(ids);
        return '<button class="list-item" data-act="group" data-kind="' + tab + '" data-key="' + esc(it.key) + '"><div class="grow"><b>' + esc(it.title) + '</b>' +
          '<div class="sub">' + esc(it.sub) + '</div>' +
          '<div class="sub">Изучено ' + gp.studied + ' из ' + gp.total + ' · верно ' + gp.right + '</div>' +
          '<div class="bar"><i style="width:' + Math.round(gp.studied / gp.total * 100) + '%"></i></div></div>' +
          '<span class="badge">' + ids.length + '</span></button>';
      }).join('');
  };

  /* ---------- Марафон ---------- */
  SCREENS.marathon = function () {
    var m = S.marathon;
    var h = head('Марафон');
    if (!m) {
      return h + '<div class="card"><p style="margin-top:0">Все ' + Q.length + ' вопросов подряд в случайном порядке. Прогресс сохраняется: можно закрыть приложение и продолжить с того же места.</p>' +
        '<button class="btn" data-act="marathonStart">Начать марафон</button></div>';
    }
    var answered = 0, wrong = 0;
    Object.keys(m.answers).forEach(function (k) { answered++; if (!m.answers[k].ok) wrong++; });
    var done = answered >= m.order.length;
    return h + '<div class="card"><div class="big" style="font-weight:700;font-size:calc(20px*var(--fs))">' + (done ? 'Марафон пройден' : 'Отвечено ' + answered + ' из ' + m.order.length) + '</div>' +
      '<div class="muted small">Верно: ' + (answered - wrong) + ' · ошибок: ' + wrong + '</div>' +
      '<div class="bar ok"><i style="width:' + Math.round(answered / m.order.length * 100) + '%"></i></div>' +
      '<div class="stack" style="margin-top:16px">' +
      (done ? '' : '<button class="btn" data-act="marathonContinue">Продолжить</button>') +
      '<button class="btn ' + (done ? '' : 'secondary') + '" data-act="marathonRestart">Начать заново</button></div></div>';
  };

  /* ---------- Ошибки и избранное ---------- */
  function questionList(ids, mode) {
    return ids.map(function (id, i) {
      var q = byId[id];
      return '<button class="list-item" data-act="listq" data-mode="' + mode + '" data-i="' + i + '"><div class="grow"><b style="font-weight:600">' + esc(q.text) + '</b>' +
        '<div class="sub">' + esc(q.discipline + ' · ' + q.competence) + '</div></div>' + I.chevron.replace('<svg', '<svg width="20" height="20"') + '</button>';
    }).join('');
  }
  function mistakeIds() { return Object.keys(S.mistakes).map(Number).filter(function (id) { return byId[id]; }).sort(function (a, b) { return a - b; }); }
  function favIds() { return S.fav.filter(function (id) { return byId[id]; }); }

  SCREENS.mistakes = function () {
    var ids = mistakeIds();
    var h = head('Ошибки');
    if (!ids.length) return h + '<div class="empty"><div class="ei">' + I.check + '</div><b>Ошибок нет</b>Здесь появятся вопросы, на которые вы ответили неверно.</div>';
    return h + '<div class="card"><div style="font-weight:700;font-size:calc(18px*var(--fs))">' + ids.length + ' ' + plural(ids.length, 'вопрос', 'вопроса', 'вопросов') + '</div>' +
      '<p class="muted small" style="margin:4px 0 14px">Ответьте на вопрос правильно 2 раза подряд — и он уйдёт из списка.</p>' +
      '<div class="btn-row" style="margin-top:0"><button class="btn" data-act="solveMistakes">Решать</button><button class="btn danger" data-act="clearMistakes">Очистить</button></div></div>' +
      questionList(ids, 'mistakes');
  };
  SCREENS.favorites = function () {
    var ids = favIds();
    var h = head('Избранное');
    if (!ids.length) return h + '<div class="empty"><div class="ei">' + I.star + '</div><b>Избранное пусто</b>Нажмите звёздочку на карточке вопроса, чтобы сохранить его сюда.</div>';
    return h + '<button class="btn" data-act="solveFav" style="margin-bottom:12px">Решать подряд</button>' + questionList(ids, 'favorites');
  };

  /* ---------- Статистика ---------- */
  SCREENS.stats = function () {
    var pct = S.totalAnswers ? Math.round(S.totalCorrect / S.totalAnswers * 100) : 0;
    var never = Q.length - countStudied();
    var h = head('Статистика') +
      '<div class="stat-grid"><div class="stat"><b>' + S.totalAnswers + '</b><span>ответов</span></div>' +
      '<div class="stat"><b>' + pct + '%</b><span>верных</span></div>' +
      '<div class="stat"><b>' + never + '</b><span>ни разу не решены</span></div></div>' +
      '<div class="section-title">По дисциплинам</div><div class="card">';
    h += DISC_ORDER.map(function (d) {
      var gp = groupProgress(groupIds('disc', d));
      return '<div style="padding:8px 0"><div style="display:flex;justify-content:space-between;gap:8px"><b>' + d + '</b><span class="muted small">верно ' + gp.right + ' из ' + gp.total + '</span></div>' +
        '<div class="muted small">' + DISCIPLINE_SHORT[d] + '</div><div class="bar ok"><i style="width:' + Math.round(gp.right / gp.total * 100) + '%"></i></div></div>';
    }).join('') + '</div>';
    h += '<div class="section-title">История экзаменов</div>';
    if (!S.exams.length) h += '<div class="card muted">Экзаменов пока не было.</div>';
    else h += S.exams.slice().reverse().slice(0, 30).map(function (e) {
      return '<div class="list-item"><div class="grow"><b>' + fmtDate(e.date) + '</b><div class="sub">Верно ' + e.correct + ' из ' + e.total + ' · ошибок ' + e.errors + ' · ' + fmtTime(e.time) + '</div></div>' +
        '<span class="badge ' + (e.passed ? 'ok' : 'bad') + '">' + (e.passed ? 'Сдано' : 'Не сдано') + '</span></div>';
    }).join('');
    h += '<button class="btn danger" data-act="resetAll" style="margin-top:20px">Сбросить весь прогресс</button>';
    return h;
  };

  /* ---------- Настройки ---------- */
  SCREENS.settings = function () {
    function seg(k, opts) {
      return '<div class="seg" style="margin:8px 0 4px">' + opts.map(function (o) {
        return '<button class="' + (S.settings[k] === o[0] ? 'on' : '') + '" data-act="set" data-k="' + k + '" data-v="' + o[0] + '">' + o[1] + '</button>';
      }).join('') + '</div>';
    }
    function sw(k, title, sub) {
      return '<div class="setting"><div class="grow"><b>' + title + '</b><div class="muted small">' + sub + '</div></div>' +
        '<button class="switch ' + (S.settings[k] ? 'on' : '') + '" role="switch" aria-checked="' + !!S.settings[k] + '" aria-label="' + title + '" data-act="toggle" data-k="' + k + '"></button></div>';
    }
    return head('Настройки') +
      '<div class="card"><b>Тема</b>' + seg('theme', [['system', 'Системная'], ['light', 'Светлая'], ['dark', 'Тёмная']]) + '</div>' +
      '<div class="card"><b>Размер шрифта</b>' + seg('font', [['normal', 'Обычный'], ['large', 'Крупный']]) + '</div>' +
      '<div class="card">' +
      sw('shuffle', 'Перемешивать варианты', 'Варианты ответа в новом порядке при каждом показе') +
      sw('autoNext', 'Автопереход при верном ответе', 'После правильного ответа сразу открывается следующий вопрос') +
      sw('extra', 'Дополнительные вопросы за ошибки', 'В экзамене: +5 вопросов и +5 минут за каждую ошибку') +
      '</div>' +
      '<p class="muted small" style="text-align:center">В базе ' + Q.length + ' вопросов. Прогресс хранится только на этом устройстве.</p>';
  };

  /* ---------- Экзамен: вступление ---------- */
  SCREENS.examIntro = function () {
    var last = S.exams.slice(-3).reverse();
    return head('Экзамен') +
      '<div class="card"><div class="info"><span class="ii">' + I.exam + '</span><div><b style="font-size:calc(18px*var(--fs))">' + EXAM_SIZE + ' случайных вопросов</b><div class="muted small">Как на диагностической работе</div></div></div>' +
      '<ul class="rules">' +
      '<li><b>1</b><span>На решение ' + EXAM_MINUTES + ' минут</span></li>' +
      '<li><b>2</b><span>Обязательно будут соответствие, последовательность и бывшие письменные вопросы</span></li>' +
      '<li><b>3</b><span>Правильность ответов видна только в конце, изменить ответ нельзя</span></li>' +
      '<li><b>4</b><span>Больше двух ошибок — экзамен не сдан</span></li>' +
      (S.settings.extra ? '<li><b>5</b><span>За каждую ошибку +5 вопросов и +5 минут, в них ошибаться нельзя</span></li>' : '') +
      '</ul>' +
      '<button class="btn" data-act="examStart">Начать экзамен</button></div>' +
      (last.length ? '<div class="section-title">Последние попытки</div>' + last.map(function (e) {
        return '<div class="list-item"><div class="grow"><b>' + fmtDate(e.date) + '</b><div class="sub">Верно ' + e.correct + ' из ' + e.total + ' · ' + fmtTime(e.time) + '</div></div>' +
          '<span class="badge ' + (e.passed ? 'ok' : 'bad') + '">' + (e.passed ? 'Сдано' : 'Не сдано') + '</span></div>';
      }).join('') : '');
  };

  /* ================= Сессии решения ================= */
  function startSession(o) {
    session = {
      mode: o.mode, title: o.title, ids: o.ids.slice(), answers: o.answers || {}, perm: {}, pending: {},
      cur: o.cur || 0, ticket: o.ticket || null, finished: false, startedAt: Date.now()
    };
    go('quiz');
  }

  function getPerm(q) {
    if (session.perm[q.id]) return session.perm[q.id];
    var p;
    if (q.type === 'single' || q.type === 'multi') p = S.settings.shuffle ? shuffledPerm(q.options.length) : range(q.options.length);
    else if (q.type === 'match') p = shuffledPerm(q.pairs.length, true);
    else p = shuffledPerm(q.sequence.length, true);
    session.perm[q.id] = p;
    return p;
  }

  function isCorrect(q, given) {
    if (q.type === 'single') return given === q.correct[0];
    if (q.type === 'multi') {
      var a = given.slice().sort(), b = q.correct.slice().sort();
      return a.length === b.length && a.every(function (v, i) { return v === b[i]; });
    }
    return given.every(function (v, i) { return v === i; });
  }

  function phaseRange() {
    var s = session;
    if (s.mode !== 'exam') return [0, s.ids.length];
    return s.phase === 'extra' ? [s.extraStart, s.ids.length] : [0, s.mainCount];
  }
  function nextUnanswered(from) {
    var r = phaseRange(), lo = r[0], n = r[1] - lo;
    for (var k = 1; k <= n; k++) {
      var i = lo + ((from - lo + k) % n);
      if (!session.answers[i]) return i;
    }
    return -1;
  }

  function recordStat(id, ok, silent) {
    var st = S.stats[id] || (S.stats[id] = { a: 0, c: 0, last: 0 });
    st.a++; if (ok) st.c++; st.last = ok ? 1 : 0;
    S.totalAnswers++; if (ok) S.totalCorrect++;
    if (!ok) S.mistakes[id] = 0;
    else if (S.mistakes[id] !== undefined) {
      S.mistakes[id]++;
      if (S.mistakes[id] >= 2) {
        delete S.mistakes[id];
        if (!silent) toast('Вопрос убран из ошибок');
      }
    }
    save();
  }

  function setCur(i) {
    session.cur = i;
    if (session.mode === 'marathon' && S.marathon) { S.marathon.cur = i; save(); }
    renderQuiz(true);
  }

  function submitAnswer(given) {
    var s = session, pos = s.cur, q = byId[s.ids[pos]];
    if (s.answers[pos] || s.finished) return;
    var ok = isCorrect(q, given);
    s.answers[pos] = { given: given, ok: ok };
    delete s.pending[pos];
    if (s.mode === 'exam') {
      renderQuiz(false);
      setTimeout(function () {
        if (session !== s || s.finished) return;
        var i = nextUnanswered(pos);
        if (i < 0) examCheck(false);
        else setCur(i);
      }, 350);
      return;
    }
    recordStat(q.id, ok);
    if (!ok) vibrate();
    if (s.mode === 'marathon' && S.marathon) { S.marathon.answers = s.answers; save(); }
    renderQuiz(false);
    if (ok && S.settings.autoNext) {
      /* автопереход: короткая пауза, чтобы был виден зелёный ответ */
      setTimeout(function () {
        if (session !== s || s.finished || s.cur !== pos || route.name !== 'quiz') return;
        ACT.next();
      }, 900);
      return;
    }
    scrollToFeedback(!ok);
  }

  /* Прокрутка к правильному ответу и пояснению */
  function scrollToFeedback(wrong) {
    var ex = document.querySelector('.explain');
    if (!ex) return;
    var target = ex;
    if (wrong) {
      var cards = document.querySelectorAll('#qwrap > .card');
      if (cards.length) target = cards[0]; /* соответствие / последовательность: сначала разбор ответа */
    }
    var bar = document.querySelector('.topbar');
    var off = (bar ? bar.offsetHeight : 56) + 12;
    var top = target.getBoundingClientRect().top + window.pageYOffset - off;
    if (!wrong) {
      var btn = document.querySelector('[data-act="next"]');
      var bottom = btn ? btn.getBoundingClientRect().bottom + window.pageYOffset + 16 : 0;
      if (bottom <= window.pageYOffset + window.innerHeight) return; /* всё и так видно */
      top = Math.min(top, bottom - window.innerHeight);
    }
    setTimeout(function () {
      try { window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' }); } catch (e) { window.scrollTo(0, Math.max(0, top)); }
    }, 60);
  }

  /* ---------- Экран вопроса ---------- */
  function renderQuiz(scrollTop) {
    if (route.name !== 'quiz') return;
    $('#view').innerHTML = SCREENS.quiz();
    AFTER.quiz();
    if (scrollTop) window.scrollTo(0, 0);
  }

  function correctText(q) {
    if (q.type === 'single' || q.type === 'multi') return q.correct.map(function (i) { return esc(q.options[i]); }).join('<br>');
    if (q.type === 'match') return q.pairs.map(function (p, i) { return (i + 1) + '. ' + esc(p.left) + ' — ' + esc(p.right); }).join('<br>');
    return q.sequence.map(function (t, i) { return (i + 1) + '. ' + esc(t); }).join('<br>');
  }

  function remainingSec() { return Math.max(0, (session.deadline - Date.now()) / 1000); }

  SCREENS.quiz = function () {
    var s = session, pos = s.cur, q = byId[s.ids[pos]], ans = s.answers[pos];
    var exam = s.mode === 'exam', fb = !exam;
    var r = phaseRange();
    var right = exam
      ? '<div class="timer' + (remainingSec() < 60 ? ' low' : '') + '" id="timer">' + fmtTime(remainingSec()) + '</div>'
      : '<div class="counter">' + (pos + 1) + '/' + s.ids.length + '</div>';
    var title = exam && s.phase === 'extra' ? 'Доп. вопросы' : s.title;
    var h = head(title, right);

    /* прогресс */
    var done = 0;
    for (var j = r[0]; j < r[1]; j++) if (s.answers[j]) done++;
    h += '<div class="qprog"><i style="width:' + Math.round(done / (r[1] - r[0]) * 100) + '%"></i></div>';
    /* полоса номеров */
    h += '<div class="strip" id="strip">';
    for (var i = r[0]; i < r[1]; i++) {
      var a = s.answers[i], cls = '';
      if (a) cls = exam ? 'done' : (a.ok ? 'ok' : 'bad');
      if (i === pos) cls += ' cur';
      h += '<button class="' + cls + '" data-act="jump" data-i="' + i + '" aria-label="Вопрос ' + (i - r[0] + 1) + '">' + (i - r[0] + 1) + '</button>';
    }
    h += '</div>';

    /* карточка вопроса */
    var fav = S.fav.indexOf(q.id) >= 0;
    var hint = '';
    if (!ans) {
      if (q.type === 'single') hint = 'Выберите один правильный ответ';
      else if (q.type === 'multi') hint = 'Выберите все правильные варианты и нажмите «Ответить»';
      else if (q.type === 'match') hint = 'Нажмите пункт, затем подходящее описание';
      else if (q.type === 'order') hint = 'Нажимайте шаги в правильном порядке';
    }
    h += '<div id="qwrap"><div class="qcard"><div class="qmeta"><span class="chip kind">' + KIND[q.type] + '</span><span class="chip">' + esc(q.discipline + ' · ' + q.competence) + '</span>' +
      (isOpen(q) ? '<span class="chip was-open">Был письменный вопрос</span>' : '') +
      '<button class="star ' + (fav ? 'on' : '') + '" data-act="fav" aria-label="В избранное">' + (fav ? I.starFill : I.star) + '</button></div>' +
      '<div class="qnum">Вопрос ' + (pos - r[0] + 1) + ' из ' + (r[1] - r[0]) + '</div>' +
      '<p class="qtext">' + esc(q.text) + '</p>' + (hint ? '<p class="hint">' + I.hand + hint + '</p>' : '') + '</div>';

    if (q.type === 'single' || q.type === 'multi') h += renderChoice(q, ans, exam);
    else if (q.type === 'match') h += renderMatch(q, ans, exam);
    else h += renderOrder(q, ans, exam);

    if (ans && fb) {
      h += '<div class="explain ' + (ans.ok ? 'ok' : 'bad') + '"><div class="verdict"><i>' + (ans.ok ? I.check : I.cross) + '</i>' + (ans.ok ? 'Правильно!' : 'Неправильно') + '</div>' +
        (ans.ok || q.type === 'match' || q.type === 'order' ? '' : '<div class="rightans"><b>Правильный ответ</b>' + correctText(q) + '</div>') +
        '<h3>Комментарий к вопросу</h3><p>' + esc(q.explanation) + '</p></div>';
      var more = nextUnanswered(pos) >= 0;
      h += '<button class="btn" data-act="next" style="margin-top:12px">' + (more ? 'Далее' : 'Завершить') + '</button>';
    }
    if (ans && exam) h += '<p class="muted small" style="text-align:center;margin:12px 0 0">Ответ принят</p>';
    if (exam) h += '<button class="btn ghost" data-act="examFinish" style="margin-top:16px">Завершить экзамен</button>';
    h += '</div>';
    return h;
  };

  function renderChoice(q, ans, exam) {
    var perm = getPerm(q), s = session, pend = s.pending[s.cur] || [];
    var given = ans ? (q.type === 'single' ? [ans.given] : ans.given) : [];
    var h = '<div class="opts">' + perm.map(function (oi, k) {
      var cls = '', isG = given.indexOf(oi) >= 0, isC = q.correct.indexOf(oi) >= 0;
      if (ans) {
        if (exam) cls = isG ? 'sel' : 'dim';
        else if (isC && isG) cls = 'ok';
        else if (isG) cls = 'bad';
        else if (isC) cls = q.type === 'multi' ? 'miss' : 'ok';
        else cls = 'dim';
        cls += ' locked';
      } else if (q.type === 'multi' && pend.indexOf(oi) >= 0) cls = 'sel';
      var lead = q.type === 'multi'
        ? '<span class="check">' + ((ans ? isG : pend.indexOf(oi) >= 0) ? I.check : '') + '</span>'
        : '<span class="num">' + (ans && !exam && (cls.indexOf('ok') === 0 || cls.indexOf('bad') === 0) ? (cls.indexOf('ok') === 0 ? I.check : I.cross) : LETTERS[k]) + '</span>';
      return '<button class="opt ' + cls + '" data-act="opt" data-o="' + oi + '"' + (ans ? ' tabindex="-1"' : '') + '>' + lead + '<span class="txt">' + esc(q.options[oi]) + '</span></button>';
    }).join('') + '</div>';
    if (!ans && q.type === 'multi') h += '<button class="btn" data-act="submitMulti" style="margin-top:12px"' + (pend.length ? '' : ' disabled') + '>Ответить</button>';
    return h;
  }

  function renderMatch(q, ans, exam) {
    var perm = getPerm(q), s = session;
    if (ans) {
      var lines = q.pairs.map(function (p, i) {
        var g = ans.given[i], ok = g === i;
        if (exam) return '<div class="res-line"><b>' + (i + 1) + '. ' + esc(p.left) + '</b> — ' + esc(q.pairs[g].right) + '</div>';
        return '<div class="res-line ' + (ok ? 'ok' : 'bad') + '"><span class="mark">' + (ok ? '✓' : '✗') + '</span><b>' + (i + 1) + '. ' + esc(p.left) + '</b> — ' + esc(q.pairs[g].right) +
          (ok ? '' : '<div class="right">Правильно: ' + esc(p.right) + '</div>') + '</div>';
      }).join('');
      return '<div class="card">' + lines + '</div>';
    }
    var p = s.pending[s.cur] || (s.pending[s.cur] = { sel: null, map: {} });
    var owner = {};
    Object.keys(p.map).forEach(function (li) { owner[p.map[li]] = Number(li); });
    var h = '<div class="match-label">Пункты</div><div class="opts">' + q.pairs.map(function (pr, i) {
      var c = PAIR_COLORS[i % PAIR_COLORS.length], paired = p.map[i] !== undefined;
      return '<button class="opt ' + (paired ? 'picked ' : '') + (p.sel === i ? 'active' : '') + '" style="--pc:' + c + '" data-act="mleft" data-i="' + i + '">' +
        '<span class="tag" style="background:' + c + '">' + (i + 1) + '</span><span class="txt">' + esc(pr.left) + '</span>' +
        (paired ? '<span class="tag" style="background:' + c + '">' + LETTERS[perm.indexOf(p.map[i])] + '</span>' : '') + '</button>';
    }).join('') + '</div>';
    h += '<div class="match-label">Описания</div><div class="opts">' + perm.map(function (ri, k) {
      var li = owner[ri], has = li !== undefined, c = has ? PAIR_COLORS[li % PAIR_COLORS.length] : '';
      return '<button class="opt ' + (has ? 'picked' : '') + '"' + (has ? ' style="--pc:' + c + '"' : '') + ' data-act="mright" data-r="' + ri + '">' +
        '<span class="tag' + (has ? '' : ' plain') + '"' + (has ? ' style="background:' + c + '"' : '') + '>' + (has ? (li + 1) : LETTERS[k]) + '</span>' +
        '<span class="txt">' + esc(q.pairs[ri].right) + '</span></button>';
    }).join('') + '</div>';
    var full = Object.keys(p.map).length === q.pairs.length;
    h += '<button class="btn" data-act="submitMatch" style="margin-top:12px"' + (full ? '' : ' disabled') + '>Ответить</button>';
    return h;
  }

  function renderOrder(q, ans, exam) {
    var perm = getPerm(q), s = session;
    if (ans) {
      var h1 = '<div class="card"><b>Ваш порядок</b>' + ans.given.map(function (si, k) {
        var ok = si === k;
        if (exam) return '<div class="res-line">' + (k + 1) + '. ' + esc(q.sequence[si]) + '</div>';
        return '<div class="res-line ' + (ok ? 'ok' : 'bad') + '"><span class="mark">' + (ok ? '✓' : '✗') + '</span>' + (k + 1) + '. ' + esc(q.sequence[si]) + '</div>';
      }).join('') + '</div>';
      if (!exam && !ans.ok) {
        h1 += '<div class="card"><b>Правильный порядок</b>' + q.sequence.map(function (t, k) {
          return '<div class="res-line ok"><span class="mark">' + (k + 1) + '.</span>' + esc(t) + '</div>';
        }).join('') + '</div>';
      }
      return h1;
    }
    var p = s.pending[s.cur] || (s.pending[s.cur] = []);
    var h = '<div class="opts">' + perm.map(function (si) {
      var n = p.indexOf(si);
      return '<button class="opt ' + (n >= 0 ? 'sel' : '') + '" data-act="ostep" data-s="' + si + '"><span class="num">' + (n >= 0 ? n + 1 : '') + '</span><span class="txt">' + esc(q.sequence[si]) + '</span></button>';
    }).join('') + '</div>';
    h += '<div class="btn-row"><button class="btn secondary" data-act="oreset"' + (p.length ? '' : ' disabled') + '>Сбросить</button>' +
      '<button class="btn" data-act="submitOrder"' + (p.length === q.sequence.length ? '' : ' disabled') + '>Ответить</button></div>';
    return h;
  }

  AFTER.quiz = function () {
    var strip = $('#strip');
    var cur = strip && strip.querySelector('.cur');
    if (cur) strip.scrollLeft = cur.offsetLeft - strip.clientWidth / 2 + cur.clientWidth / 2;
  };

  /* ---------- Завершение ---------- */
  function finishSession() {
    var s = session;
    s.finished = true;
    var wrong = [], correct = 0;
    s.ids.forEach(function (id, i) {
      var a = s.answers[i];
      if (a && a.ok) correct++;
      else if (a) wrong.push(id);
    });
    if (s.mode === 'ticket') { S.tickets[s.ticket] = { errors: wrong.length, date: Date.now() }; save(); }
    lastResult = { kind: 'practice', mode: s.mode, ticket: s.ticket, title: s.title, ids: s.ids.slice(), correct: correct, total: s.ids.length, wrong: wrong };
    go('result', {}, true);
  }

  /* ---------- Экзамен ---------- */
  var timerId = null;
  function startTimer() {
    stopTimer();
    timerId = setInterval(function () {
      if (!session || session.mode !== 'exam' || session.finished) { stopTimer(); return; }
      var rem = remainingSec();
      var t = $('#timer');
      if (t) { t.textContent = fmtTime(rem); t.classList.toggle('low', rem < 60); }
      if (rem <= 0) examCheck(true);
    }, 500);
  }
  function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

  function startExam() {
    function pick(arr, n) { return shuffle(arr).slice(0, n); }
    var match = Q.filter(function (q) { return q.type === 'match'; }).map(function (q) { return q.id; });
    var order = Q.filter(function (q) { return q.type === 'order'; }).map(function (q) { return q.id; });
    var open = Q.filter(isOpen).map(function (q) { return q.id; });
    var chosen = pick(match, 1).concat(pick(order, 1), pick(open, 2));
    var rest = Q.map(function (q) { return q.id; }).filter(function (id) { return chosen.indexOf(id) < 0; });
    chosen = shuffle(chosen.concat(pick(rest, EXAM_SIZE - chosen.length)));
    session = {
      mode: 'exam', title: 'Экзамен', ids: chosen, answers: {}, perm: {}, pending: {}, cur: 0,
      finished: false, startedAt: Date.now(), deadline: Date.now() + EXAM_MINUTES * 60000,
      phase: 'main', mainCount: chosen.length, extraStart: chosen.length
    };
    go('quiz');
    startTimer();
  }

  function errorsIn(a, b) {
    var e = [];
    for (var i = a; i < b; i++) if (!session.answers[i] || !session.answers[i].ok) e.push(i);
    return e;
  }

  function examCheck(timeout) {
    var s = session;
    if (!s || s.finished || s.mode !== 'exam') return;
    if (s.phase === 'main') {
      var e = errorsIn(0, s.mainCount);
      if (timeout) return endExam(false, 'Время вышло');
      if (e.length === 0) return endExam(true, '');
      if (e.length > 2) return endExam(false, 'Допущено больше двух ошибок');
      if (!S.settings.extra) return endExam(true, '');
      var used = {};
      s.ids.forEach(function (id) { used[id] = 1; });
      var pool = shuffle(Q.filter(function (q) { return !used[q.id]; }).map(function (q) { return q.id; })).slice(0, 5 * e.length);
      s.extraStart = s.ids.length;
      s.ids = s.ids.concat(pool);
      s.phase = 'extra';
      s.deadline = Date.now() + 5 * e.length * 60000;
      s.cur = s.extraStart;
      renderQuiz(true);
      showModal({
        title: e.length + ' ' + plural(e.length, 'ошибка', 'ошибки', 'ошибок') + ' в основной части',
        text: 'Добавлено ' + pool.length + ' дополнительных вопросов и ' + (5 * e.length) + ' минут. В них ошибаться нельзя.',
        buttons: [{ label: 'Продолжить' }]
      });
    } else {
      if (timeout) return endExam(false, 'Время на дополнительные вопросы вышло');
      var e2 = errorsIn(s.extraStart, s.ids.length);
      endExam(e2.length === 0, e2.length ? 'Ошибка в дополнительных вопросах' : '');
    }
  }

  function endExam(passed, reason) {
    var s = session;
    s.finished = true;
    stopTimer();
    closeModal();
    var spent = Math.round((Date.now() - s.startedAt) / 1000);
    var wrong = [], correct = 0, unanswered = 0;
    s.ids.forEach(function (id, i) {
      var a = s.answers[i];
      if (a) { recordStat(id, a.ok, true); if (a.ok) correct++; else wrong.push(id); }
      else { unanswered++; wrong.push(id); }
    });
    S.exams.push({ date: Date.now(), passed: passed, correct: correct, total: s.ids.length, errors: wrong.length, time: spent });
    if (S.exams.length > 50) S.exams = S.exams.slice(-50);
    save();
    lastResult = { kind: 'exam', passed: passed, reason: reason, correct: correct, total: s.ids.length, wrong: wrong, unanswered: unanswered, time: spent, title: 'Экзамен' };
    go('result', {}, true);
  }

  /* ---------- Экран результата ---------- */
  SCREENS.result = function () {
    var r = lastResult;
    var ok = r.kind === 'exam' ? r.passed : r.wrong.length === 0;
    var h = head(r.title, '', true);
    h += '<div class="card result-hero ' + (ok ? 'ok' : 'bad') + '"><div class="result-icon">' + (ok ? I.check : I.cross) + '</div>';
    if (r.kind === 'exam') {
      h += '<div class="big">' + (r.passed ? 'Сдано' : 'Не сдано') + '</div>' +
        (r.reason ? '<div class="muted">' + esc(r.reason) + '</div>' : '') +
        '<div class="muted small" style="margin-top:6px">Верно ' + r.correct + ' из ' + r.total + ' · время ' + fmtTime(r.time) +
        (r.unanswered ? ' · без ответа ' + r.unanswered : '') + '</div>';
    } else {
      h += '<div class="big">' + r.correct + ' из ' + r.total + '</div><div class="muted">' +
        (ok ? 'Без ошибок' : r.wrong.length + ' ' + plural(r.wrong.length, 'ошибка', 'ошибки', 'ошибок')) + '</div>';
    }
    h += '</div><div class="stack">';
    if (r.wrong.length) h += '<button class="btn" data-act="retryWrong">Повторить ошибки</button>';
    if (r.kind === 'practice' && r.mode === 'ticket') h += '<button class="btn secondary" data-act="retryTicket">Решить билет ещё раз</button>';
    if (r.kind === 'exam') h += '<button class="btn secondary" data-act="examStart">Новый экзамен</button>';
    h += '<button class="btn ghost" data-act="home">На главную</button></div>';
    if (r.wrong.length) {
      h += '<div class="section-title">Ошибки</div>' + r.wrong.map(function (id) {
        var q = byId[id];
        return '<div class="err-item"><div class="q">' + esc(q.text) + '</div><div class="a"><b>Правильный ответ:</b><br>' + correctText(q) + '</div>' +
          '<div class="e">' + esc(q.explanation) + '</div></div>';
      }).join('');
    }
    return h;
  };

  /* ================= Модальное окно и тост ================= */
  var modalEl = null;
  function showModal(o) {
    closeModal();
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = '<div class="modal" role="dialog" aria-modal="true"><h2>' + esc(o.title) + '</h2>' + (o.text ? '<p>' + esc(o.text) + '</p>' : '') + '<div class="stack"></div></div>';
    var st = back.querySelector('.stack');
    o.buttons.forEach(function (b) {
      var el = document.createElement('button');
      el.className = 'btn ' + (b.cls || '');
      el.textContent = b.label;
      el.addEventListener('click', function () { closeModal(); if (b.fn) b.fn(); });
      st.appendChild(el);
    });
    back.addEventListener('click', function (e) { if (e.target === back) closeModal(); });
    document.body.appendChild(back);
    modalEl = back;
  }
  function closeModal() { if (modalEl) { modalEl.remove(); modalEl = null; } }
  var toastTimer = null;
  function toast(text) {
    var old = document.querySelector('.toast');
    if (old) old.remove();
    var t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = text;
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.remove(); }, 2200);
  }

  /* ================= Действия ================= */
  var ACT = {
    back: function () { history.back(); },
    home: function () { go('home'); },
    nav: function (d) { go(d.to); },
    install: function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      var p = deferredPrompt.userChoice;
      deferredPrompt = null;
      if (p && p.then) p.then(render, render); else render();
    },
    closeIos: function () { S.iosHintClosed = true; save(); render(); },
    ticket: function (d) {
      var n = Number(d.n);
      startSession({ mode: 'ticket', title: 'Билет ' + n, ids: TICKETS[n - 1], ticket: n });
    },
    retryTicket: function () { var n = lastResult.ticket; startSession({ mode: 'ticket', title: 'Билет ' + n, ids: TICKETS[n - 1], ticket: n }); },
    topicTab: function (d) { route.params = { tab: d.tab }; try { history.replaceState(route, ''); } catch (e) { /* игнор */ } render(); },
    group: function (d) { startSession({ mode: 'practice', title: groupTitle(d.kind, d.key), ids: groupIds(d.kind, d.key) }); },
    marathonStart: function () { S.marathon = { order: shuffle(Q.map(function (q) { return q.id; })), answers: {}, cur: 0 }; save(); ACT.marathonContinue(); },
    marathonRestart: function () {
      if (!S.marathon) return ACT.marathonStart();
      showModal({ title: 'Начать марафон заново?', text: 'Текущий прогресс марафона будет сброшен.', buttons: [
        { label: 'Начать заново', fn: ACT.marathonStart }, { label: 'Отмена', cls: 'ghost' }] });
    },
    marathonContinue: function () {
      var m = S.marathon;
      var cur = m.cur || 0;
      if (m.answers[cur]) {
        for (var i = 0; i < m.order.length; i++) { if (!m.answers[(cur + i) % m.order.length]) { cur = (cur + i) % m.order.length; break; } }
      }
      startSession({ mode: 'marathon', title: 'Марафон', ids: m.order, answers: m.answers, cur: cur });
    },
    solveMistakes: function () { var ids = mistakeIds(); if (ids.length) startSession({ mode: 'mistakes', title: 'Работа над ошибками', ids: ids }); },
    solveFav: function () { var ids = favIds(); if (ids.length) startSession({ mode: 'favorites', title: 'Избранное', ids: ids }); },
    listq: function (d) {
      var ids = d.mode === 'mistakes' ? mistakeIds() : favIds();
      startSession({ mode: d.mode, title: d.mode === 'mistakes' ? 'Работа над ошибками' : 'Избранное', ids: ids, cur: Number(d.i) });
    },
    clearMistakes: function () {
      showModal({ title: 'Очистить ошибки?', text: 'Список ошибок будет удалён. Статистика ответов сохранится.', buttons: [
        { label: 'Очистить', cls: 'danger', fn: function () { S.mistakes = {}; save(); render(); toast('Ошибки очищены'); } },
        { label: 'Отмена', cls: 'ghost' }] });
    },
    resetAll: function () {
      showModal({ title: 'Сбросить весь прогресс?', text: 'Удалятся статистика, ошибки, избранное, результаты билетов, марафон и история экзаменов. Настройки останутся.', buttons: [
        { label: 'Сбросить', cls: 'danger', fn: function () { var st = S.settings; S = defaultState(); S.settings = st; save(); render(); toast('Прогресс сброшен'); } },
        { label: 'Отмена', cls: 'ghost' }] });
    },
    set: function (d) { S.settings[d.k] = d.v; save(); applySettings(); render(); },
    toggle: function (d) { S.settings[d.k] = !S.settings[d.k]; save(); render(); },
    examStart: function () { startExam(); },

    /* внутри вопроса */
    jump: function (d) { setCur(Number(d.i)); },
    next: function () {
      var i = nextUnanswered(session.cur);
      if (i < 0) finishSession(); else setCur(i);
    },
    fav: function (d, el) {
      var id = session.ids[session.cur], k = S.fav.indexOf(id);
      if (k >= 0) S.fav.splice(k, 1); else S.fav.push(id);
      save();
      var on = k < 0;
      el.classList.toggle('on', on);
      el.innerHTML = on ? I.starFill : I.star;
      toast(on ? 'Добавлено в избранное' : 'Убрано из избранного');
    },
    opt: function (d) {
      var s = session, q = byId[s.ids[s.cur]];
      if (s.answers[s.cur]) return;
      var oi = Number(d.o);
      if (q.type === 'single') return submitAnswer(oi);
      var p = s.pending[s.cur] || (s.pending[s.cur] = []);
      var k = p.indexOf(oi);
      if (k >= 0) p.splice(k, 1); else p.push(oi);
      renderQuiz(false);
    },
    submitMulti: function () { var p = session.pending[session.cur]; if (p && p.length) submitAnswer(p.slice()); },
    mleft: function (d) {
      var p = session.pending[session.cur], i = Number(d.i);
      if (p.map[i] !== undefined) { delete p.map[i]; p.sel = i; }
      else p.sel = p.sel === i ? null : i;
      renderQuiz(false);
    },
    mright: function (d) {
      var p = session.pending[session.cur], ri = Number(d.r);
      var ownerKey = Object.keys(p.map).filter(function (k) { return p.map[k] === ri; })[0];
      if (ownerKey !== undefined) {
        delete p.map[ownerKey];
        if (p.sel === null) { renderQuiz(false); return; }
      }
      if (p.sel === null) {
        var free = byId[session.ids[session.cur]].pairs.map(function (_, i) { return i; }).filter(function (i) { return p.map[i] === undefined; });
        if (!free.length) return;
        p.sel = free[0];
      }
      p.map[p.sel] = ri;
      var q = byId[session.ids[session.cur]];
      var nextFree = q.pairs.map(function (_, i) { return i; }).filter(function (i) { return p.map[i] === undefined; });
      p.sel = nextFree.length ? nextFree[0] : null;
      renderQuiz(false);
    },
    submitMatch: function () {
      var q = byId[session.ids[session.cur]], p = session.pending[session.cur];
      if (Object.keys(p.map).length !== q.pairs.length) return;
      submitAnswer(q.pairs.map(function (_, i) { return p.map[i]; }));
    },
    ostep: function (d) {
      var p = session.pending[session.cur], si = Number(d.s), k = p.indexOf(si);
      if (k >= 0) p.splice(k, 1); else p.push(si);
      renderQuiz(false);
    },
    oreset: function () { session.pending[session.cur] = []; renderQuiz(false); },
    submitOrder: function () {
      var q = byId[session.ids[session.cur]], p = session.pending[session.cur];
      if (p.length === q.sequence.length) submitAnswer(p.slice());
    },
    examFinish: function () {
      var r = phaseRange(), left = 0;
      for (var i = r[0]; i < r[1]; i++) if (!session.answers[i]) left++;
      if (!left) return examCheck(false);
      showModal({
        title: 'Завершить экзамен?',
        text: 'Без ответа: ' + left + ' ' + plural(left, 'вопрос', 'вопроса', 'вопросов') + '. Они будут засчитаны как ошибки.',
        buttons: [{ label: 'Вернуться к вопросам' }, { label: 'Завершить', cls: 'danger', fn: function () { examCheck(false); } }]
      });
    },
    retryWrong: function () {
      var ids = lastResult.wrong.filter(function (id, i, a) { return a.indexOf(id) === i; });
      startSession({ mode: 'practice', title: 'Работа над ошибками', ids: ids });
    }
  };

  document.getElementById('view').addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]');
    if (!t || t.disabled) return;
    var fn = ACT[t.getAttribute('data-act')];
    if (fn) fn(t.dataset, t, e);
  });
  document.getElementById('tabbar').addEventListener('click', function (e) {
    var t = e.target.closest('[data-tab]');
    if (!t) return;
    var tab = t.getAttribute('data-tab');
    if (route.name !== tab) go(tab);
  });

  /* Свайпы влево/вправо между вопросами */
  var sx = 0, sy = 0, st = 0;
  document.addEventListener('touchstart', function (e) {
    if (route.name !== 'quiz' || modalEl || e.touches.length !== 1) return;
    if (e.target.closest('.strip')) { st = 0; return; }
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now();
  }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (!st || route.name !== 'quiz' || !session || modalEl) return;
    var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    var dt = Date.now() - st; st = 0;
    if (dt > 600 || Math.abs(dx) < 60 || Math.abs(dy) > 45) return;
    var r = phaseRange(), i = session.cur + (dx < 0 ? 1 : -1);
    if (i >= r[0] && i < r[1]) setCur(i);
  }, { passive: true });

  /* ================= PWA ================= */
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (route.name === 'home') render();
  });
  window.addEventListener('appinstalled', function () { deferredPrompt = null; if (route.name === 'home') render(); });
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () { /* офлайн-режим недоступен */ });
    });
  }

  /* ================= Старт ================= */
  try { history.replaceState(route, ''); } catch (e) { /* игнор */ }
  render();
})();

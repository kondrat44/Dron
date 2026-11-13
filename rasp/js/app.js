/* Расписание для студентов и преподавателей: только просмотр. Данные — один файл data/schedule.json. */
(() => {
  const C = window.RASP;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const LS = {
    get(k) {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
      } catch {}
    },
    json(k, d) {
      try {
        return JSON.parse(localStorage.getItem(k)) ?? d;
      } catch {
        return d;
      }
    },
  };
  const DAY = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
  const DAY_S = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  const MON = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const HUE = { 1: 211, 2: 145, 3: 28 };
  const TYPE = { g: "Группа", t: "Преподаватель" };
  const iso = (d) => d.toLocaleDateString("sv");
  const at = (s) => new Date(s + "T12:00:00");
  const dm = (s) => s.slice(8, 10) + "." + s.slice(5, 7);
  const addDays = (s, n) => {
    const d = at(s);
    d.setDate(d.getDate() + n);
    return iso(d);
  };
  const hm = (d) => d.toTimeString().slice(0, 5);
  const now = () => (window.__now ? new Date(window.__now) : new Date());

  const S = {
    file: null, // опубликованный файл
    offline: false,
    weeks: [],
    nextFlip: null,
    wi: 0, // выбранная неделя
    day: "", // выбранный день
    mode: LS.get("rasp-mode") === "week" ? "week" : "day",
    who: ((w) => (w && TYPE[w.type] ? w : null))(LS.json("rasp-who", null)), // выбор «кабинет» больше не поддерживается
    lessons: new Map(), // id издания -> занятия
    userPicked: false,
  };
  window.__S = S;

  /* ---------- данные ---------- */
  const lessonsOf = (ed) => {
    if (!ed) return [];
    if (!S.lessons.has(ed.id)) S.lessons.set(ed.id, Pack.unpack(ed));
    return S.lessons.get(ed.id);
  };
  async function cachePut(text) {
    LS.set("rasp-data-at", new Date().toISOString());
    try {
      const c = await caches.open("rasp-data");
      await c.put("schedule", new Response(text, { headers: { "content-type": "application/json" } }));
    } catch {
      if (text.length < 1500000) LS.set("rasp-data", text);
    }
  }
  async function cacheGet() {
    try {
      const c = await caches.open("rasp-data");
      const r = await c.match("schedule");
      if (r) return await r.text();
    } catch {}
    return LS.get("rasp-data");
  }
  async function load(silent) {
    let text = null;
    try {
      const r = await fetch(C.data + "?t=" + Math.floor(Date.now() / 60000), { cache: "no-store" });
      if (!r.ok) throw Error(r.status);
      text = await r.text();
      JSON.parse(text);
      S.offline = false;
      cachePut(text);
    } catch {
      S.offline = true;
      text = await cacheGet();
    }
    if (text) {
      const next = JSON.parse(text);
      const changed = JSON.stringify((next.editions || []).map((e) => e.id)) !== JSON.stringify(((S.file && S.file.editions) || []).map((e) => e.id));
      S.file = next;
      if (changed) S.lessons.clear();
    }
    compute();
    render();
    if (!silent && S.offline && S.file) toast("Нет интернета — показано сохранённое расписание");
  }
  let flipTimer = null;
  function compute() {
    const before = S.weeks.map((w) => w.cur.id).join();
    const v = Pack.view(S.file, now());
    S.weeks = v.weeks;
    S.nextFlip = v.nextFlip;
    clearTimeout(flipTimer);
    if (v.nextFlip) {
      const ms = new Date(v.nextFlip) - now();
      if (ms > 0 && ms < 2147000000)
        flipTimer = setTimeout(() => {
          compute();
          render();
        }, ms + 500);
    }
    /* приложение открыто, а учебная часть опубликовала изменения */
    if (before && before !== S.weeks.map((w) => w.cur.id).join()) toast("Расписание изменилось");
    if (!S.weeks.length) return;
    const today = iso(now());
    if (!S.userPicked || !S.weeks[S.wi] || before !== S.weeks.map((w) => w.cur.id).join()) {
      if (!S.userPicked || !S.weeks[S.wi]) {
        /* неделя: та, где сегодня; иначе ближайшая будущая; иначе последняя */
        let wi = S.weeks.findIndex((w) => w.week <= today && today <= addDays(w.week, 6));
        if (wi < 0) wi = S.weeks.findIndex((w) => w.week > today);
        if (wi < 0) wi = S.weeks.length - 1;
        /* неделя закончилась (например, суббота вечером) — сразу показываем следующую, если она уже опубликована */
        if (S.weeks[wi + 1] && S.weeks[wi].week <= today) {
          const t = hm(now());
          const left = mine(lessonsOf(S.weeks[wi].cur)).some((l) => l.date > today || (l.date === today && l.end > t));
          if (!left) wi++;
        }
        S.wi = wi;
        S.day = defaultDay();
      }
    }
    if (!stripDays().includes(S.day)) S.day = defaultDay();
  }
  const week = () => S.weeks[S.wi];
  const stripDays = () => {
    const w = week();
    if (!w) return [];
    const ds = [0, 1, 2, 3, 4, 5].map((i) => addDays(w.week, i));
    const sun = addDays(w.week, 6);
    if (w.dates.includes(sun)) ds.push(sun);
    return ds;
  };
  const mine = (ls) => {
    const w = S.who;
    if (!w) return [];
    return ls.filter((l) => (w.type === "g" ? l.groups.includes(w.v) : w.type === "t" ? l.teacher === w.v : l.room === w.v));
  };
  function defaultDay() {
    const w = week();
    if (!w) return "";
    const ds = stripDays();
    const today = iso(now());
    const has = (d) => mine(lessonsOf(w.cur)).some((l) => l.date === d);
    if (ds.includes(today)) {
      /* вечером, когда пары закончились, удобнее сразу видеть завтра */
      const left = mine(lessonsOf(w.cur)).filter((l) => l.date === today && l.end > hm(now()));
      if (!left.length && now().getHours() >= 15) {
        const next = ds.find((d) => d > today && has(d));
        if (next) return next;
      }
      return today;
    }
    return ds.find((d) => d >= today && has(d)) || ds.find(has) || ds[0];
  }
  /* изменения между прошлым и нынешним изданием недели, только для выбранной группы/преподавателя */
  function changes(w) {
    if (!w || !w.prev || !S.who) return [];
    const d = Pack.diff(lessonsOf(w.prev), lessonsOf(w.cur));
    const ids = new Set(mine(d.map((x) => x.l)).concat(mine(d.filter((x) => x.old).map((x) => x.old))));
    return d.filter((x) => ids.has(x.l) || (x.old && ids.has(x.old)));
  }

  /* ---------- отрисовка ---------- */
  const pairName = (p) => (p ? p + " пара" : "до первой пары");
  const where = (l) => (l.room ? "ауд. " + l.room + (l.bld ? " · корпус " + l.bld : "") : "кабинет не указан");
  const brief = (l) => [l.subject, S.who.type === "t" ? l.groups.join(", ") : l.teacher, l.room ? "ауд. " + l.room : ""].filter(Boolean).join(", ");
  function lessonHtml(l, mark, live) {
    const w = S.who;
    const meta = [];
    if (w.type !== "g") meta.push(l.groups.join(", "));
    if (w.type !== "t" && l.teacher) meta.push(l.teacher);
    if (w.type !== "r") meta.push(where(l));
    const gone = mark && mark.type === "removed";
    const tags = [];
    if (l.sub) tags.push(`<span class="tag sg">${l.sub} подгруппа</span>`);
    if (live) tags.push(`<span class="tag ${live.cls}">${esc(live.text)}</span>`);
    if (gone) tags.push('<span class="tag off">Пара снята</span>');
    else if (mark && mark.type === "new") tags.push('<span class="tag new">Новая пара</span>');
    else if (mark && mark.type === "changed") tags.push('<span class="tag ch">Изменено</span>');
    return `<div class="les${gone ? " gone" : ""}" style="--h:${HUE[l.bld] ?? 265}"><h3>${esc(l.subject)}</h3><p>${esc(meta.join(" · "))}</p>${
      mark && mark.type === "changed" ? `<p class="was">Было: ${esc(brief(mark.old))}</p>` : ""
    }<div class="tags">${tags.join("")}</div></div>`;
  }
  function dayHtml(date, w, ch) {
    const all = lessonsOf(w.cur);
    const ls = mine(all).filter((l) => l.date === date);
    const marks = new Map();
    for (const x of ch) if (x.l.date === date) marks.set(x.l, x);
    const gone = ch.filter((x) => x.type === "removed" && x.l.date === date).map((x) => x.l);
    const times = new Map();
    for (const l of all) if (l.date === date && l.start && !times.has(l.period || 0)) times.set(l.period || 0, [l.start, l.end]);
    const slots = new Map();
    for (const l of [...ls, ...gone]) {
      const k = l.period || 0;
      if (!slots.has(k)) slots.set(k, []);
      slots.get(k).push(l);
    }
    if (!slots.size) return `<div class="free"><b>Пар нет</b>${S.who.type === "g" ? "В этот день у группы занятий нет." : "В этот день занятий нет."}</div>`;
    /* окна между парами — только у группы */
    if (S.who.type === "g") {
      const nums = [...slots.keys()].filter((k) => k > 0 && slots.get(k).some((l) => !gone.includes(l)));
      for (let p = Math.min(...nums) + 1; p < Math.max(...nums); p++) if (!slots.has(p)) slots.set(p, null);
    }
    const today = iso(now()) === date;
    const t = hm(now());
    let soonUsed = false;
    const keys = [...slots.keys()].sort((a, b) => a - b);
    return keys
      .map((k) => {
        const list = slots.get(k);
        const tm = (list && list.find((l) => l.start) && [list.find((l) => l.start).start, list.find((l) => l.start).end]) || times.get(k) || ["", ""];
        const num = `<div class="num"><b>${k || "•"}</b><span>${esc(tm[0])}</span><span>${esc(tm[1])}</span></div>`;
        if (!list) return `<div class="row gap">${num}<div class="body">Окно</div></div>`;
        let live = null;
        const real = list.some((l) => !gone.includes(l));
        if (today && real && tm[0]) {
          if (tm[0] <= t && t < tm[1]) live = { cls: "live", text: "Идёт сейчас · до " + tm[1] };
          else if (t < tm[0] && !soonUsed) {
            const [h, m] = tm[0].split(":").map(Number);
            const [h2, m2] = t.split(":").map(Number);
            const min = h * 60 + m - (h2 * 60 + m2);
            if (min <= 90) live = { cls: "soon", text: min >= 60 ? "Через 1 ч " + (min - 60) + " мин" : "Через " + min + " мин" };
            soonUsed = true;
          }
        }
        list.sort((a, b) => a.sub - b.sub || a.subject.localeCompare(b.subject, "ru"));
        return `<article class="row${live && live.cls === "live" ? " now" : ""}" aria-label="${esc(pairName(k))}">${num}<div class="body">${list
          .map((l, i) => lessonHtml(l, marks.get(l) || (gone.includes(l) ? { type: "removed" } : null), i === 0 || gone.includes(l) ? (gone.includes(l) ? null : live) : null))
          .join("")}</div></article>`;
      })
      .join("");
  }
  const weekLabel = (w) => {
    const a = at(w.week),
      b = at(addDays(w.week, 5));
    return a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${MON[b.getMonth()]}` : `${a.getDate()} ${MON[a.getMonth()]} – ${b.getDate()} ${MON[b.getMonth()]}`;
  };
  const whenText = (isoTime) => {
    const d = new Date(isoTime);
    return `${DAY_S[d.getDay()].toLowerCase()} ${dm(iso(d))} в ${hm(d)}`;
  };
  function render() {
    const app = $("app");
    $("who-btn").textContent = S.who ? S.who.v : "Выбрать";
    $("who-btn").title = S.who ? TYPE[S.who.type] + ": " + S.who.v + " — нажмите, чтобы сменить" : "Выбрать группу";
    if (!S.file || !S.weeks.length) {
      app.innerHTML = `<div class="empty"><b>Расписание ещё не опубликовано</b>${
        S.offline ? "Нет интернета. Подключитесь и откройте ещё раз." : "Загляните позже."
      }</div>${foot()}`;
      bindFoot();
      return;
    }
    if (!S.who) {
      app.innerHTML = `<div class="empty"><b>Чьё расписание показать?</b>Выберите группу или преподавателя — приложение запомнит выбор.<div class="foot-actions"><button class="btn blue" id="pick-now">Выбрать</button></div></div>${foot()}`;
      $("pick-now").onclick = () => picker();
      bindFoot();
      return;
    }
    const w = week();
    const ch = changes(w);
    const days = stripDays();
    const today = iso(now());
    const my = mine(lessonsOf(w.cur));
    const seenKey = "rasp-seen:" + S.who.type + ":" + S.who.v;
    const fresh = w.prev && LS.get(seenKey) !== w.cur.id; // учебная часть изменила расписание, а этот человек ещё не видел
    const showBanner = fresh && ch.length;
    const showQuiet = fresh && !ch.length;
    const line = (x) => {
      const head = `${DAY_S[at(x.l.date).getDay()]} ${dm(x.l.date)}, ${pairName(x.l.period)}${x.l.sub ? ", " + x.l.sub + " подгр." : ""}: `;
      if (x.type === "removed") return `${esc(head)}<b>пара снята</b> — <s>${esc(brief(x.l))}</s>`;
      if (x.type === "new") return `${esc(head)}<b>новая пара</b> — ${esc(brief(x.l))}`;
      return `${esc(head)}${esc(brief(x.l))} <s>было: ${esc(brief(x.old))}</s>`;
    };
    const unknown = !lessonsOf(w.cur).some((l) => (S.who.type === "g" ? l.groups.includes(S.who.v) : S.who.type === "t" ? l.teacher === S.who.v : l.room === S.who.v));
    app.innerHTML =
      (S.offline ? '<div class="note">Нет интернета — показано сохранённое расписание.</div>' : "") +
      installNote() +
      pushNote() +
      (showBanner
        ? `<section class="banner" aria-label="Изменения в расписании"><h2>Изменения в расписании</h2><ul>${ch
            .slice(0, 6)
            .map((x) => `<li>${line(x)}</li>`)
            .join("")}</ul>${ch.length > 6 ? `<p class="hint">…и ещё ${ch.length - 6}. Изменённые пары отмечены в расписании.</p>` : ""}<div class="row-actions"><button class="btn" id="seen">Понятно</button></div></section>`
        : showQuiet
          ? `<section class="banner quiet" aria-label="Расписание изменилось"><h2>Расписание изменилось</h2><p>${
              S.who.type === "g" ? "У группы " + esc(S.who.v) : "У преподавателя " + esc(S.who.v)
            } на этой неделе ничего не поменялось.</p><div class="row-actions"><button class="btn" id="seen">Понятно</button></div></section>`
          : "") +
      `<div class="weekbar"><div class="weeknav">${
        S.weeks.length > 1 ? `<button class="nav-btn" id="wk-prev" aria-label="Прошлая неделя" ${S.wi === 0 ? "disabled" : ""}>‹</button>` : ""
      }<b>${esc(weekLabel(w))}</b>${
        S.weeks.length > 1 ? `<button class="nav-btn" id="wk-next" aria-label="Следующая неделя" ${S.wi === S.weeks.length - 1 ? "disabled" : ""}>›</button>` : ""
      }</div><div class="seg" role="group" aria-label="Вид">${[
        ["day", "День"],
        ["week", "Неделя"],
      ]
        .map(([m, t]) => `<button data-mode="${m}" aria-pressed="${S.mode === m}">${t}</button>`)
        .join("")}</div></div>` +
      `<nav class="days" aria-label="Дни недели">${days
        .map((d) => {
          const n = my.some((l) => l.date === d);
          const c = ch.some((x) => x.l.date === d);
          return `<button class="day-btn${d === S.day && S.mode === "day" ? " on" : ""}${n ? "" : " none"}${d === today ? " today" : ""}${c ? " chg" : ""}" data-day="${d}" aria-pressed="${d === S.day && S.mode === "day"}" aria-label="${DAY[at(d).getDay()]}, ${dm(d)}${d === today ? ", сегодня" : ""}${c ? ", есть изменения" : ""}"><b>${DAY_S[at(d).getDay()]}</b><small>${dm(d)}</small></button>`;
        })
        .join("")}</nav>` +
      (unknown ? `<div class="note">В расписании этой недели нет: ${esc(TYPE[S.who.type].toLowerCase())} «${esc(S.who.v)}». Проверьте выбор — нажмите на название вверху.</div>` : "") +
      `<div id="list">${
        S.mode === "day"
          ? dayTitle(S.day, today) + dayHtml(S.day, w, ch)
          : days
              .filter((d) => my.some((l) => l.date === d) || ch.some((x) => x.l.date === d))
              .map((d) => `<section class="week-day" id="d-${d}">${dayTitle(d, today)}${dayHtml(d, w, ch)}</section>`)
              .join("") || '<div class="free"><b>Пар нет</b>На этой неделе занятий нет.</div>'
      }</div>` +
      foot(w);
    if ($("seen"))
      $("seen").onclick = () => {
        LS.set(seenKey, w.cur.id);
        render();
      };
    if ($("wk-prev")) $("wk-prev").onclick = () => setWeek(S.wi - 1);
    if ($("wk-next")) $("wk-next").onclick = () => setWeek(S.wi + 1);
    app.querySelectorAll("[data-mode]").forEach(
      (b) =>
        (b.onclick = () => {
          S.mode = b.dataset.mode;
          LS.set("rasp-mode", S.mode);
          render();
        }),
    );
    app.querySelectorAll(".day-btn").forEach(
      (b) =>
        (b.onclick = () => {
          S.userPicked = true;
          S.day = b.dataset.day;
          if (S.mode === "week") {
            const el = $("d-" + S.day);
            if (el) return el.scrollIntoView({ behavior: "smooth", block: "start" });
            S.mode = "day";
          }
          render();
        }),
    );
    bindFoot();
    bindInstall();
  }
  const dayTitle = (d, today) =>
    `<div class="day-title"><h2>${d === today ? "Сегодня" : d === addDays(today, 1) ? "Завтра" : DAY[at(d).getDay()][0].toUpperCase() + DAY[at(d).getDay()].slice(1)}</h2><span>${
      d === today || d === addDays(today, 1) ? DAY[at(d).getDay()] + ", " : ""
    }${at(d).getDate()} ${MON[at(d).getMonth()]}</span></div>`;
  function setWeek(i) {
    if (i < 0 || i >= S.weeks.length) return;
    S.userPicked = true;
    S.wi = i;
    S.day = defaultDay();
    render();
  }
  function foot(w) {
    return `<footer class="foot">${w ? `<p>Расписание от ${esc(whenText(w.cur.publishedAt))}</p>` : ""}<div class="foot-actions"><button class="btn" id="refresh">Обновить</button>${
      S.who ? '<button class="btn" id="change-who">Сменить группу</button>' : ""
    }</div>${pushFoot()}<button class="link" id="help-link">Инструкция для iPhone и Android</button><br><button class="link" id="admin-link">Вход для учебной части</button></footer>`;
  }
  function bindFoot() {
    if ($("refresh"))
      $("refresh").onclick = async () => {
        $("refresh").disabled = true;
        await load(true);
        toast(S.offline ? "Нет интернета — показано сохранённое расписание" : "Расписание актуальное");
      };
    if ($("change-who")) $("change-who").onclick = () => picker();
    if ($("admin-link")) $("admin-link").onclick = () => admin();
    if ($("help-link")) $("help-link").onclick = () => help();
    bindPush();
  }

  /* ---------- установка на экран ---------- */
  let installEvt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installEvt = e;
    if (S.who) render();
  });
  window.addEventListener("appinstalled", () => {
    installEvt = null;
    LS.set("rasp-install", "done");
    render();
  });
  const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  function installNote() {
    if (standalone() || LS.get("rasp-install")) return "";
    if (installEvt) return '<div class="note install"><p><b>Установите приложение</b> — значок появится на экране телефона.</p><button class="btn blue" id="install">Установить</button><button class="x-btn" id="install-x" aria-label="Скрыть">×</button></div>';
    if (isIos()) return '<div class="note install"><p><b>Добавьте на экран «Домой»:</b> нажмите «Поделиться» внизу Safari, затем «На экран „Домой“».</p><button class="x-btn" id="install-x" aria-label="Скрыть">×</button></div>';
    return "";
  }
  function bindInstall() {
    if ($("install"))
      $("install").onclick = async () => {
        installEvt.prompt();
        await installEvt.userChoice.catch(() => {});
        installEvt = null;
        render();
      };
    if ($("install-x"))
      $("install-x").onclick = () => {
        LS.set("rasp-install", "hidden");
        render();
      };
  }

  /* ---------- лист снизу ---------- */
  let lastFocus = null;
  function openSheet(html) {
    lastFocus = document.activeElement;
    $("sheet").innerHTML = html;
    $("scrim").hidden = false;
    requestAnimationFrame(() => $("scrim").classList.add("open"));
    $("sheet").scrollTop = 0;
    $("sheet").focus({ preventScroll: true });
    document.body.style.overflow = "hidden";
  }
  function closeSheet() {
    $("scrim").classList.remove("open");
    document.body.style.overflow = "";
    setTimeout(() => {
      if (!$("scrim").classList.contains("open")) $("scrim").hidden = true;
    }, 320);
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  $("scrim").addEventListener("click", (e) => {
    if (e.target === $("scrim") && S.who) closeSheet();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("scrim").hidden && S.who) closeSheet();
  });

  /* выбор группы / преподавателя / кабинета */
  function picker(type) {
    type = type || (S.who && S.who.type) || "g";
    const all = S.weeks.flatMap((w) => lessonsOf(w.cur));
    const sortRu = (a, b) => a.localeCompare(b, "ru", { numeric: true });
    const lists = {
      g: [...new Set(all.flatMap((l) => l.groups))].sort(sortRu),
      t: [...new Set(all.map((l) => l.teacher).filter(Boolean))].sort(sortRu),
    };
    const recent = LS.json("rasp-recent", []).filter((x) => lists[x.type] && lists[x.type].includes(x.v));
    const item = (t, v) => `<button class="pick${S.who && S.who.type === t && S.who.v === v ? " on" : ""}" data-t="${t}" data-v="${esc(v)}">${esc(v)}</button>`;
    openSheet(
      `<div class="sheet-head"><h2>Чьё расписание?</h2>${S.who ? '<button class="x-btn" id="sheet-x" aria-label="Закрыть">×</button>' : ""}</div><div class="seg" role="group">${Object.entries(TYPE)
        .map(([t, name]) => `<button data-type="${t}" aria-pressed="${t === type}">${name}</button>`)
        .join("")}</div><input class="inp" id="pick-q" type="search" inputmode="search" autocomplete="off" placeholder="${
        type === "g" ? "Поиск: 23-БС" : "Поиск по фамилии"
      }" aria-label="Поиск">${
        recent.length ? `<p class="sub-h">Недавние</p><div class="pick-grid" id="pick-recent">${recent.map((x) => item(x.type, x.v)).join("")}</div><p class="sub-h">Все</p>` : ""
      }<div class="${type === "g" ? "pick-grid" : "pick-list"}" id="pick-all">${lists[type].map((v) => item(type, v)).join("")}</div><p class="hint" id="pick-none" hidden>Ничего не найдено.</p>`,
    );
    if ($("sheet-x")) $("sheet-x").onclick = closeSheet;
    $("sheet").querySelectorAll("[data-type]").forEach((b) => (b.onclick = () => picker(b.dataset.type)));
    const norm = (s) => s.toLowerCase().replace(/ё/g, "е").replace(/[\s.\-]+/g, "");
    $("pick-q").oninput = () => {
      const q = norm($("pick-q").value);
      let n = 0;
      $("pick-all").querySelectorAll(".pick").forEach((b) => {
        const ok = !q || norm(b.textContent).includes(q);
        b.hidden = !ok;
        n += ok;
      });
      $("pick-none").hidden = n > 0;
    };
    $("sheet").querySelectorAll(".pick").forEach(
      (b) =>
        (b.onclick = () => {
          S.who = { type: b.dataset.t, v: b.dataset.v };
          LS.set("rasp-who", JSON.stringify(S.who));
          LS.set("rasp-recent", JSON.stringify([S.who, ...LS.json("rasp-recent", []).filter((x) => !(x.type === S.who.type && x.v === S.who.v))].slice(0, 4)));
          S.userPicked = false;
          if (Push.on()) Push.sync();
          compute();
          closeSheet();
          render();
          window.scrollTo(0, 0);
        }),
    );
  }

  /* ---------- инструкция: при первом заходе и по кнопке «?» ---------- */
  const ICON = {
    share: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M6 11H5v10h14V11h-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    plus: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    dots: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="19" r="2" fill="currentColor"/></svg>',
  };
  const HELP = {
    ios: {
      name: "iPhone",
      steps: [
        ["Откройте сайт в Safari", "Лучше именно в Safari — из него проще всего добавить расписание на экран «Домой»."],
        [`Нажмите «Поделиться» ${ICON.share}`, "Кнопка внизу экрана. Если её не видно, сначала нажмите «•••» справа от адресной строки."],
        [`Выберите «На экран „Домой“» ${ICON.plus}`, "Пункт может быть ниже — пролистайте список. Затем нажмите «Добавить» вверху справа."],
        ["Откройте «Расписание» со значка", "Значок появится на экране телефона. Дальше открывайте расписание только с него — так работают уведомления."],
        ["Выберите группу", "Или преподавателя. Приложение запомнит выбор, сменить можно кнопкой вверху."],
        ["Включите уведомления", "Нажмите «🔔 Уведомления о заменах» и затем «Разрешить»."],
        ["Проверьте", "Внизу нажмите «Проверить» и сверните приложение — через 15 секунд придёт пробное уведомление."],
      ],
      fix: "Настройки → Уведомления → «Расписание»: включите «Допуск уведомлений», «Заблокированный экран», «Центр уведомлений» и «Баннеры». Выключите «Не беспокоить» (Фокусирование). Нужна iOS 16.4 или новее.",
    },
    android: {
      name: "Android",
      steps: [
        ["Откройте сайт в Chrome", "В других браузерах уведомления тоже могут работать, но проверено в Chrome."],
        ["Установите приложение", `Нажмите «Установить» в синей плашке. Если её нет — меню ${ICON.dots} вверху справа → «Добавить на гл. экран» или «Установить приложение».`],
        ["Откройте «Расписание» со значка", "Значок появится на экране телефона, приложение откроется без адресной строки."],
        ["Выберите группу", "Или преподавателя. Приложение запомнит выбор, сменить можно кнопкой вверху."],
        ["Включите уведомления", "Нажмите «🔔 Уведомления о заменах» и затем «Разрешить»."],
        ["Проверьте", "Внизу нажмите «Проверить» и сверните приложение — через 15 секунд придёт пробное уведомление."],
      ],
      fix: "Настройки → Приложения → Chrome → Уведомления — включить. Там же «Батарея» → «Без ограничений» (на Xiaomi ещё «Автозапуск»), иначе телефон усыпляет Chrome и уведомления приходят только при открытии.",
    },
    use: {
      name: "Просмотр",
      steps: [
        ["День или неделя", "Переключатель над днями. Дни листаются пальцем влево-вправо."],
        ["Изменения видно сразу", "Если учебная часть поменяла пары, сверху появится жёлтая плашка, а изменённые пары отмечены «изменено», «новая» или «снята»."],
        ["Когда меняется расписание", "Новое расписание и срочные изменения — сразу. Обычные правки — ночью, в 00:00."],
        ["Без интернета", "Показывается последнее сохранённое расписание. Обновится само, когда появится интернет."],
      ],
      fix: "",
    },
  };
  function help(tab) {
    tab = tab || (isIos() ? "ios" : "android");
    const h = HELP[tab],
      inst = standalone();
    const first = !LS.get("rasp-help");
    openSheet(
      `<div class="sheet-head"><h2>Как пользоваться</h2>${S.who ? '<button class="x-btn" id="sheet-x" aria-label="Закрыть">×</button>' : ""}</div><div class="seg" role="group" aria-label="Телефон">${Object.entries(HELP)
        .map(([k, x]) => `<button data-help="${k}" aria-pressed="${k === tab}">${x.name}</button>`)
        .join("")}</div>${
        inst && tab !== "use" ? '<div class="card ok"><p>✓ Приложение уже на экране телефона — осталось выбрать группу и включить уведомления.</p></div>' : ""
      }<ol class="steps">${h.steps
        .map(([t, d], i) => `<li class="${inst && tab !== "use" && i < (tab === "ios" ? 4 : 3) ? "done" : ""}"><span class="step-n">${i + 1}</span><div><b>${t}</b><p>${d}</p></div></li>`)
        .join("")}</ol>${
        h.fix ? `<details class="card"><summary>Уведомления не приходят?</summary><p>${h.fix}</p></details>` : ""
      }<div class="actions"><button class="btn blue" id="help-ok">${S.who ? "Понятно" : "Понятно — выбрать группу"}</button><a class="btn" href="instrukciya.docx" download="Инструкция для студентов - Расписание КузТАГиС.docx">📄 Инструкция в Word</a></div>`,
    );
    $("sheet").querySelectorAll("[data-help]").forEach((b) => (b.onclick = () => help(b.dataset.help)));
    const done = () => {
      LS.set("rasp-help", "seen");
      closeSheet();
      if (!S.who && S.weeks.length) setTimeout(() => picker(), 340);
    };
    $("help-ok").onclick = done;
    if ($("sheet-x")) $("sheet-x").onclick = done;
    if (first) LS.set("rasp-help", "seen");
  }

  /* ---------- уведомления о заменах (Web Push, сервер — папка push/) ---------- */
  const Push = {
    can: () => !!(C.push && C.pushKey && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && window.isSecureContext),
    state: () => LS.json("rasp-push", null),
    on: () => Push.can() && !!Push.state() && Notification.permission === "granted",
    key: () => {
      const s = C.pushKey.replace(/-/g, "+").replace(/_/g, "/");
      return Uint8Array.from(atob(s + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
    },
    async send(path, body) {
      let r = null;
      try {
        r = await fetch(C.push + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      } catch {}
      /* сервер упал (у Cloudflare без нужных заголовков — iPhone пишет «Load failed») или нет сети */
      if (!r || r.status >= 500) throw Error(navigator.onLine === false ? "нет интернета" : "сервер уведомлений сейчас недоступен. Попробуйте позже");
      if (!r.ok) throw Error("сервер уведомлений ответил " + r.status);
    },
    async sub() {
      const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((_, bad) => setTimeout(() => bad(Error("приложение ещё загружается, попробуйте через минуту")), 10000))]);
      return (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Push.key() }));
    },
    async enable() {
      try {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          toast(perm === "denied" ? "Уведомления запрещены. Разрешите их в настройках браузера." : "Уведомления не включены");
          return render();
        }
        const sub = await Push.sub();
        await Push.send("/sub", { sub: sub.toJSON(), who: S.who });
        LS.set("rasp-push", JSON.stringify({ who: S.who, at: Date.now() }));
        toast("Уведомления включены: " + S.who.v);
      } catch (e) {
        toast("Не получилось включить уведомления: " + (e.message || e));
      }
      render();
    },
    async disable() {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await Push.send("/unsub", { endpoint: sub.endpoint }).catch(() => {});
          await sub.unsubscribe();
        }
      } catch {}
      LS.set("rasp-push", null);
      toast("Уведомления выключены");
      render();
    },
    /* при смене группы и раз в 3 дня — напомнить серверу о подписке */
    async sync() {
      try {
        const sub = await Push.sub();
        await Push.send("/sub", { sub: sub.toJSON(), who: S.who });
        LS.set("rasp-push", JSON.stringify({ who: S.who, at: Date.now() }));
      } catch {}
    },
  };
  function pushFoot() {
    if (!S.who) return "";
    if (isIos() && !standalone()) return '<p class="push-line">🔔 Уведомления о заменах на iPhone: добавьте сайт на экран «Домой» и откройте оттуда.</p>';
    if (!Push.can()) return "";
    if (Notification.permission === "denied") return '<p class="push-line">🔔 Уведомления о заменах запрещены в настройках браузера для этого сайта.</p>';
    if (Push.on()) return `<p class="push-line">🔔 Уведомления о заменах включены: ${esc(S.who.v)}. <button class="link" id="push-test">Проверить</button> · <button class="link" id="push-off">Выключить</button></p>`;
    return '<div class="foot-actions"><button class="btn blue" id="push-on">🔔 Уведомления о заменах</button></div>';
  }
  function pushNote() {
    if (!S.who || !Push.can() || Push.on() || Notification.permission === "denied" || LS.get("rasp-push-hint")) return "";
    if (isIos() && !standalone()) return "";
    return `<div class="note install push-note"><p><b>Уведомления о заменах</b> — телефон сообщит, если у ${S.who.type === "g" ? "группы " : ""}${esc(S.who.v)} поменяются пары.</p><button class="btn blue" id="push-on2">Включить</button><button class="x-btn" id="push-x" aria-label="Скрыть">×</button></div>`;
  }
  function bindPush() {
    for (const id of ["push-on", "push-on2"])
      if ($(id))
        $(id).onclick = () => {
          $(id).disabled = true;
          Push.enable();
        };
    if ($("push-off")) $("push-off").onclick = () => Push.disable();
    if ($("push-test"))
      $("push-test").onclick = async () => {
        try {
          const sub = await Push.sub();
          const r = await fetch(C.push + "/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
          if (r.status === 404) {
            await Push.sync();
            return toast("Подписка обновлена — нажмите «Проверить» ещё раз");
          }
          toast(r.ok ? "Пробное уведомление придёт через 15 секунд. Сверните приложение и выключите экран — оно должно появиться как обычное уведомление" : r.status === 429 ? "Проверять можно раз в минуту" : "Сервер уведомлений ответил " + r.status);
        } catch (e) {
          toast("Не получилось: " + (e.message || e));
        }
      };
    if ($("push-x"))
      $("push-x").onclick = () => {
        LS.set("rasp-push-hint", "hidden");
        render();
      };
  }
  if ("serviceWorker" in navigator)
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data === "rasp-reload") load(true);
    });

  /* вход учебной части: код подгружается только по нажатию */
  let adminLoading = null;
  const script = (src) =>
    new Promise((ok, bad) => {
      const s = document.createElement("script");
      s.src = src + "?v=" + (C.v || "");
      s.onload = ok;
      s.onerror = () => bad(Error("Не удалось загрузить " + src));
      document.head.append(s);
    });
  async function admin() {
    openSheet('<div class="sheet-head"><h2>Учебная часть</h2><button class="x-btn" id="sheet-x" aria-label="Закрыть">×</button></div><p class="hint">Загружаю…</p>');
    $("sheet-x").onclick = closeSheet;
    try {
      if (!window.Admin) {
        adminLoading =
          adminLoading ||
          (async () => {
            for (const f of ["vendor/xlsx.full.min.js", "vendor/exceljs.min.js", "lib/xlsx-compat.js", "lib/rooms.js", "lib/model.js", "lib/reader.js", "js/admin.js"]) await script(f);
          })();
        await adminLoading;
      }
      window.Admin.open({ $, esc, LS, openSheet, closeSheet, toast, reload: () => load(true), state: S, whenText, weekLabel, dm, DAY_S, at, now });
    } catch (e) {
      adminLoading = null;
      $("sheet").querySelector(".hint").textContent = "Не получилось открыть: " + e.message + ". Проверьте интернет и попробуйте ещё раз.";
    }
  }

  /* ---------- мелочи ---------- */
  let toastTimer = null;
  function toast(text) {
    const t = $("toast");
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 3800);
  }
  $("who-btn").onclick = () => (S.weeks.length ? picker() : toast("Расписание ещё не опубликовано"));
  $("theme-btn").onclick = () => {
    const dark = document.documentElement.dataset.theme !== "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    LS.set("rasp-theme", dark ? "dark" : "light");
    themeColor();
  };
  const themeColor = () => document.querySelector('meta[name="theme-color"]').setAttribute("content", document.documentElement.dataset.theme === "dark" ? "#161618" : "#ffffff");
  themeColor();
  /* листание дней пальцем */
  let tx = 0,
    ty = 0;
  $("app").addEventListener("touchstart", (e) => {
    tx = e.touches[0].clientX;
    ty = e.touches[0].clientY;
  }, { passive: true });
  $("app").addEventListener("touchend", (e) => {
    if (S.mode !== "day" || !e.target.closest("#list")) return;
    const dx = e.changedTouches[0].clientX - tx,
      dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) < 70 || Math.abs(dy) > 50) return;
    const ds = stripDays();
    const i = ds.indexOf(S.day) + (dx < 0 ? 1 : -1);
    if (i >= 0 && i < ds.length) {
      S.userPicked = true;
      S.day = ds[i];
      render();
    }
  }, { passive: true });
  /* само обновляется: при открытии, при возврате в приложение и раз в 5 минут */
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      S.userPicked = false;
      load(true);
    }
  });
  setInterval(() => document.visibilityState === "visible" && load(true), 5 * 60 * 1000);
  setInterval(() => document.visibilityState === "visible" && $("scrim").hidden && S.who && S.weeks.length && render(), 60 * 1000);
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
  window.Rasp = { load, render, picker, admin, toast, help };
  load(true).then(() => {
    const ps = Push.state();
    if (Push.on() && S.who && (Date.now() - ps.at > 3 * 86400e3 || JSON.stringify(ps.who) !== JSON.stringify(S.who))) Push.sync();
    if (location.hash === "#admin") admin();
    else if (location.hash === "#help" || !LS.get("rasp-help")) help();
    else if (S.weeks.length && !S.who) picker();
  });
})();

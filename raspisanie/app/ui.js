/* UI retains the original application's cards, weekly grid, chips and animated sheet. */
const $ = (id) => document.getElementById(id),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
/* The program opens empty: the schedule appears only after the user loads a file.
   Unfinished work from last time is offered as «Продолжить», never shown by itself. */
let saved = null;
try {
  saved = JSON.parse(localStorage.getItem("kuztagis-viewer-1"));
} catch {}
if (saved?.version !== 1 || !saved.lessons?.length) saved = null;
let state = Model.initial({ lessons: [], dates: [], issues: [], source: "" });
if (saved) {
  state.settings = saved.settings;
  state.departments = saved.departments;
  state.catalog = saved.catalog;
  state.rooms = saved.rooms;
}
/* Полный список кабинетов техникума всегда под рукой. */
for (const s of [state, saved])
  if (s) s.rooms = [...new Set([...Model.allRooms(), ...(s.rooms || [])])];
/* Каждый запуск — только своё отделение; все отделения включаются галочкой вручную. */
for (const s of [state, saved]) if (s?.settings) s.settings.allDepartments = false;
if (saved)
  saved.catalog = Model.fillCatalog(
    saved.catalog,
    [...new Set(saved.lessons.flatMap((l) => l.groups))],
    saved.settings,
  );
const ui = {
  tab: "schedule",
  filters: {
    group: "",
    teacher: "",
    room: "",
    building: "",
    specialty: "",
    department: "",
    date: "",
  },
  q: "",
  moving: null,
  freePeriod: 1,
};
const history = [];
/* Original Excel files, kept so the download looks exactly like the upload. */
const ORIG_KEY = "kuztagis-viewer-originals";
const toB64 = (u8) => {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000)
    s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
/* Исходный файл: в памяти на время работы и в IndexedDB браузера (там много места),
   чтобы «Excel» всегда выдавал тот же файл, а не таблицу. */
let current = null;
const idb = (mode, fn) =>
  new Promise((res, rej) => {
    let req;
    try {
      req = indexedDB.open("kuztagis-viewer", 1);
    } catch (e) {
      return rej(e);
    }
    req.onupgradeneeded = () => req.result.createObjectStore("files");
    req.onerror = () => rej(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction("files", mode),
        r = fn(tx.objectStore("files"));
      tx.oncomplete = () => res(r?.result);
      tx.onerror = () => rej(tx.error);
    };
  });
async function keepOriginal(name, u8) {
  current = { name, bytes: u8 };
  try {
    localStorage.removeItem(ORIG_KEY);
  } catch {}
  try {
    await idb("readwrite", (st) => st.put({ name, bytes: u8 }, "original"));
  } catch {}
}
async function originalFor(name) {
  if (current?.name === name) return current.bytes;
  try {
    const rec = await idb("readonly", (st) => st.get("original"));
    if (rec?.name === name) {
      current = { name, bytes: new Uint8Array(rec.bytes) };
      return current.bytes;
    }
  } catch {}
  try {
    const old = JSON.parse(localStorage.getItem(ORIG_KEY) || "{}")[name];
    if (old) return (current = { name, bytes: fromB64(old) }).bytes;
  } catch {}
  return null;
}
/* Если исходника нет (другой компьютер, очищен браузер) — просим выбрать его, а не выдаём другой файл. */
function askOriginal() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx";
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return resolve(null);
      try {
        const u8 = new Uint8Array(await f.arrayBuffer());
        const data = Reader.matrix(XlsxCompat.workbook(u8), f.name);
        const ids = new Set(data.lessons.map((l) => l.id));
        const same =
          data.lessons.length === state.baseline.length &&
          state.baseline.every((b) => ids.has(b.id));
        if (!same) {
          notify("Это другой файл. Выберите тот же файл, который загружали: «" + state.source + "».");
          return resolve(null);
        }
        await keepOriginal(state.source, u8);
        resolve(u8);
      } catch {
        notify("Не удалось прочитать файл. Выберите исходный .xlsx «" + state.source + "».");
        resolve(null);
      }
    };
    input.click();
  });
}
let visible = [],
  analysis = [];
function notify(s) {
  $("message").textContent = s;
  clearTimeout(notify.t);
  notify.t = setTimeout(() => ($("message").textContent = ""), 4500);
}
function persist() {
  try {
    localStorage.setItem("kuztagis-viewer-1", JSON.stringify(state));
  } catch {
    notify(
      "Не удалось сохранить в браузере. Скачайте резервную копию в настройках.",
    );
  }
}
function commit(fn) {
  history.push(Model.copy(state));
  if (history.length > 40) history.shift();
  fn();
  persist();
  render();
}
function undo() {
  if (history.length) {
    state = history.pop();
    persist();
    render();
    notify("Действие отменено");
  }
}
const scope = (l) => Model.inScope(l, state.settings);
const scopeName = () =>
  Model.withDefaults(state.settings).allDepartments
    ? "Все отделения (бета-тестирование)"
    : Model.withDefaults(state.settings).scopePattern
      ? Model.withDefaults(state.settings).scopeName
      : "Весь техникум";
function betaToggle() {
  const on = !!Model.withDefaults(state.settings).allDepartments;
  return `<label class="beta-toggle"><input type="checkbox" id="all-deps" ${on ? "checked" : ""}><span>Работа со всеми отделениями</span><span class="beta-tag">бета-тестирование</span></label>${on ? '<p class="hint beta-note">Бета-версия: основная работа программы — Дорожное отделение. Для остальных отделений возможны неточности (специальности, правила конфликтов ещё не уточнены).</p>' : ""}`;
}
function bindBeta() {
  const box = $("all-deps");
  if (!box) return;
  box.onchange = () => {
    state.settings = {
      ...Model.withDefaults(state.settings),
      allDepartments: box.checked,
    };
    Object.keys(ui.filters).forEach((k) => (ui.filters[k] = ""));
    ui.q = "";
    ui.moving = null;
    render();
    notify(
      box.checked
        ? "Включены все отделения (бета-тестирование)"
        : "Снова только " + Model.withDefaults(state.settings).scopeName,
    );
  };
}
function list(key) {
  const ls = state.lessons.filter(scope);
  return [
    ...new Set(
      key === "group"
        ? ls.flatMap((l) => l.groups)
        : key === "teacher"
          ? ls.map((l) => l.teacher)
          : key === "room"
            ? ls.map((l) => l.room)
            : key === "building"
              ? ["1", "2", "3"]
              : Object.values(state.catalog).map((x) => x[key]),
    ),
  ]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "ru", { numeric: true }));
}
function matches(l) {
  const f = ui.filters;
  return (
    scope(l) &&
    (!f.group || l.groups.includes(f.group)) &&
    (!f.teacher || l.teacher === f.teacher) &&
    (!f.room || l.room === f.room) &&
    (!f.building || Model.building(l.room, state.settings) === f.building) &&
    (!f.date || l.date === f.date) &&
    l.groups.some(
      (g) =>
        (!f.specialty || state.catalog[g]?.specialty === f.specialty) &&
        (!f.department || state.catalog[g]?.department === f.department),
    )
  );
}
const labels = {
  group: "Группа",
  teacher: "Преподаватель",
  room: "Кабинет",
  building: "Корпус",
  specialty: "Специальность",
};
function select(key, values, value, label) {
  return `<label class="filter">${esc(label)}<select class="inp" data-filter="${key}"><option value="">Все</option>${values.map((v) => `<option ${v === value ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>`;
}
function time(l) {
  return Model.times(l, state.settings)?.join("–") || "Звонки не заданы";
}
/* Почему пара красная: понятное объяснение каждого конфликта. */
let baseKeys = null,
  baseFor = null;
function baselineConflicts() {
  if (baseFor !== state.baseline) {
    baseFor = state.baseline;
    baseKeys = new Set(
      Model.conflicts(state.baseline, state.settings).map((c) => [...c.ids].sort().join("|")),
    );
  }
  return baseKeys;
}
function conflictReasons(l, list = analysis, lessons = state.lessons, max = 45) {
  const cut = (x) => (x.length > max ? x.slice(0, max - 1).trimEnd() + "…" : x);
  const byId = new Map(lessons.map((x) => [x.id, x]));
  const base = baselineConflicts();
  const out = [];
  for (const c of list) {
    if (!c.ids.includes(l.id)) continue;
    const o = byId.get(c.ids.find((x) => x !== l.id));
    if (!o) continue;
    const og = o.groups.join(", ") + (o.subgroup ? " (" + o.subgroup + " подгр.)" : "");
    const was = base.has([...c.ids].sort().join("|")) ? " — так было в исходном файле" : "";
    for (const t of c.types) {
      if (t === "Кабинет")
        out.push({ t, text: `Кабинет ${o.room} в это время занят: ${og}, «${cut(o.subject)}», ${o.teacher || "без преподавателя"}${was}` });
      if (t === "Преподаватель")
        out.push({ t, text: `${o.teacher} в это же время ведёт пару у ${og}: «${cut(o.subject)}», ауд. ${o.room || "?"}${was}` });
      if (t === "Группа")
        out.push({ t, text: `У ${og} в это же время уже стоит «${cut(o.subject)}» (${o.teacher || "без преподавателя"}, ауд. ${o.room || "?"})${was}` });
    }
  }
  return out;
}
const howToFix = {
  Кабинет: "выберите другой, свободный кабинет",
  Преподаватель: "назначьте другого преподавателя или перенесите пару на другое время",
  Группа: "перенесите одну из пар на свободное время или снимите её (окно)",
};
function conflictsBox() {
  if (!analysis.length) return "";
  const inside = state.lessons.filter((l) => scope(l) && !l.cancelled);
  const rows = [];
  const seen = new Set();
  for (const l of inside) {
    const why = conflictReasons(l, analysis, state.lessons, 70);
    if (!why.length) continue;
    const key = analysis.filter((c) => c.ids.includes(l.id)).map((c) => [...c.ids].sort().join("|")).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(
      `<li><button class="link-btn open-conf" data-id="${esc(l.id)}">${esc(Tools.DAY[Tools.dayOf(l.date)] + " " + dm(l.date) + ", " + pairName(l.period) + " · " + l.groups.join(", ") + " «" + l.subject + "»")}</button><br>${why.map((x) => esc(x.text)).join("<br>")}</li>`,
    );
  }
  return rows.length
    ? `<details class="card no-print"><summary>Почему есть красные пары: ${rows.length}</summary><p class="hint">Красная пара — это пересечение: группа, преподаватель или кабинет стоят в двух местах в одно время. Нажмите на пару в списке — откроется окно с подсказками, как исправить.</p><ul class="why-list">${rows.join("")}</ul></details>`
    : "";
}
function card(l) {
  if (l.cancelled)
    return `<button class="les off" data-lesson="${esc(l.id)}"><span class="s">Окно</span><span class="m"><s>${esc(l.subject)}</s></span><span class="m">${esc(l.groups.join(", "))}${l.subgroup ? " · " + l.subgroup + " подгр." : ""} · ${esc(l.teacher || "")}</span><span class="tags"><span class="tag off">Пара снята</span>${(state.notes || {})[l.id] ? `<span class="tag note">💬 ${esc(state.notes[l.id].slice(0, 40))}</span>` : ""}</span></button>`;
  const conflicts = analysis.filter((c) => c.ids.includes(l.id));
  const same = visible.some(
    (x) =>
      x.id !== l.id &&
      x.date === l.date &&
      Math.abs(x.period - l.period) === 1 &&
      x.period !== null &&
      l.period !== null &&
      x.subject === l.subject &&
      x.teacher === l.teacher &&
      x.room === l.room &&
      x.subgroup === l.subgroup &&
      x.groups.join() === l.groups.join(),
  );
  const why = conflicts.length ? conflictReasons(l, conflicts) : [];
  return `<button class="les ${conflicts.length ? "bad" : ""} ${ui.moving === l.id ? "selected" : ""}" ${why.length ? `title="${esc(why.map((x) => x.text).join("\n") + "\nНажмите, чтобы исправить")}"` : ""} style="--h:211" data-lesson="${esc(l.id)}"><span class="s">${esc(l.subject)}</span><span class="m">${esc(l.groups.join(", "))}${l.subgroup ? " · " + l.subgroup + " подгр." : ""}</span>${l.teacher || l.period !== null ? `<span class="m">${esc(l.teacher || "Преподаватель не указан")}</span>` : ""}<span class="m">${esc(l.room ? "Ауд. " + l.room : "Кабинет не указан")}${Model.building(l.room, state.settings) ? " · корпус " + Model.building(l.room, state.settings) : ""}</span><span class="tags">${Model.changed(l, state.baseline) ? '<span class="tag mv">Изменено</span>' : ""}${(state.notes || {})[l.id] ? `<span class="tag note" title="${esc(state.notes[l.id])}">💬 ${esc(state.notes[l.id].length > 40 ? state.notes[l.id].slice(0, 40) + "…" : state.notes[l.id])}</span>` : ""}${same ? '<span class="tag db">Сдвоенная пара</span>' : ""}${conflicts.length ? `<span class="tag bd">${esc([...new Set(conflicts.flatMap((c) => c.types))].join(", "))}</span>` : ""}</span>${why.length ? `<span class="why">${why.slice(0, 2).map((x) => `<span>⚠ ${esc(x.text)}</span>`).join("")}${why.length > 2 ? `<span>…и ещё ${why.length - 2}</span>` : ""}<span class="why-fix">Как исправить: ${esc(howToFix[why[0].t])}. Нажмите на пару.</span></span>` : ""}</button>`;
}
function render() {
  const oldBad = new Set(
    [...document.querySelectorAll(".les.bad")].map((e) => e.dataset.lesson),
  );
  /* Конфликты считаются по всему файлу (кабинеты и преподаватели общие), показываются только касающиеся отделения. */
  const inside = new Set(state.lessons.filter(scope).map((l) => l.id));
  analysis = Model.conflicts(state.lessons, state.settings).filter((c) =>
    c.ids.some((id) => inside.has(id)),
  );
  $("undo").disabled = !history.length;
  document.querySelector(".logo span").textContent = "КузТАГиС · " + scopeName();
  document
    .querySelectorAll("[data-tab]")
    .forEach((b) => b.setAttribute("aria-pressed", b.dataset.tab === ui.tab));
  if (ui.tab === "schedule") schedule();
  if (ui.tab === "refs") refs();
  if (ui.tab === "settings") settings();
  if (ui.tab === "help") help();
  if (ui.tab === "tools") tools();
  document.querySelectorAll(".les.bad").forEach((el, i) => {
    if (i < 20 && !oldBad.has(el.dataset.lesson))
      Motion.play(el, [
        { transform: "scale(1)", opacity: 1 },
        { transform: "scale(1.015)", opacity: 0.8 },
        { transform: "scale(1)", opacity: 1 },
      ]);
  });
}
const dm = (d) =>
  d ? new Date(d + "T12:00:00").toLocaleDateString("ru", { day: "2-digit", month: "2-digit" }) : "";
const pairName = (p) => (p == null ? "перед первой парой" : p + " пара");
function plural(n, a, b, c) {
  const m = n % 100, k = n % 10;
  return m > 10 && m < 20 ? c : k === 1 ? a : k > 1 && k < 5 ? b : c;
}
/* Замечания загрузки — только по парам отделения в работе. */
function myIssues() {
  const cells = new Set(
    state.lessons
      .filter(scope)
      .map((l) => l.source?.sheet + "!" + l.source?.cell),
  );
  return (state.issues || []).filter((x) => cells.has(x.where));
}
/* Конфликты, которых не было в исходном файле, а появились после правок. */
function newConflicts() {
  const key = (c) => c.types.join("+") + "|" + [...c.ids].sort().join("|");
  const inside = new Set(state.lessons.filter(scope).map((l) => l.id));
  const before = new Set(Model.conflicts(state.baseline, state.settings).map(key));
  const byId = new Map(state.lessons.map((l) => [l.id, l]));
  return Model.conflicts(state.lessons, state.settings)
    .filter((c) => c.ids.some((id) => inside.has(id)) && !before.has(key(c)))
    .map((c) => {
      const [a, b] = c.ids.map((id) => byId.get(id));
      const what = c.types.map((t) => t.toLowerCase()).join(" и ");
      return `Конфликт (${what}): ${dm(a.date)}, ${pairName(a.period)} — ${a.groups.join(", ")} «${a.subject}» (${a.teacher || "без преподавателя"}, ауд. ${a.room || "?"}) и ${b.groups.join(", ")} «${b.subject}» (${b.teacher || "без преподавателя"}, ауд. ${b.room || "?"})`;
    });
}
/* Окно «Вы уверены?» со списком того, что не так. */
function askConfirm(items) {
  return new Promise((resolve) => {
    const box = document.createElement("div");
    box.className = "confirm-overlay";
    box.innerHTML = `<div class="confirm-card" role="dialog" aria-modal="true"><h3>Вы уверены, что хотите скачать?</h3><p class="hint">После правок в расписании есть ${items.length} ${plural(items.length, "проблема", "проблемы", "проблем")}. Скачать можно, но проверьте:</p><ul>${items
      .slice(0, 12)
      .map((x) => `<li>${esc(x)}</li>`)
      .join("")}${items.length > 12 ? `<li>…и ещё ${items.length - 12}</li>` : ""}</ul><div class="actions"><button class="btn" id="confirm-no">Вернуться и исправить</button><button class="btn blue" id="confirm-yes">Скачать всё равно</button></div></div>`;
    document.body.appendChild(box);
    const done = (v) => {
      box.remove();
      resolve(v);
    };
    box.querySelector("#confirm-yes").onclick = () => done(true);
    box.querySelector("#confirm-no").onclick = () => done(false);
    box.onclick = (e) => e.target === box && done(false);
    box.querySelector("#confirm-no").focus();
  });
}
function welcome() {
  visible = [];
  const changed = saved
    ? saved.lessons.filter((l) => Model.changed(l, saved.baseline)).length
    : 0;
  $("main").innerHTML =
    `<section class="view">${multiTabNote()}<div class="card empty-start"><h2 class="ttl">Загрузите расписание</h2><p>Выберите Excel-файл недели (.xlsx), который выдаёт программа учебной части. Программа сама найдёт нужные группы — <b>${esc(scopeName())}</b> (${esc(Model.withDefaults(state.settings).allDepartments || !Model.withDefaults(state.settings).scopePattern ? "все группы" : "группы -Д и -БС")}): их можно смотреть по группам, преподавателям, кабинетам и корпусам, менять пары и скачать тот же файл с правками. Остальные отделения в файле не трогаются.</p><div class="actions"><button class="btn blue" id="start-import">Загрузить файл</button>${saved ? `<button class="btn" id="resume">Продолжить: ${esc(saved.source)}${changed ? " · изменено " + changed : ""}</button>` : ""}</div>${betaToggle()}<p class="hint">Файл никуда не отправляется, всё работает прямо на этом компьютере.</p></div></section>`;
  bindBeta();
  $("start-import").onclick = () => $("file").click();
  if (saved)
    $("resume").onclick = () => {
      const all = !!Model.withDefaults(state.settings).allDepartments;
      state = saved;
      state.settings = { ...Model.withDefaults(state.settings), allDepartments: all };
      saved = null;
      render();
    };
}
function schedule() {
  if (!state.lessons.length) return welcome();
  visible = state.lessons.filter(matches);
  const allDates = [
      ...new Set([...(state.dates || []), ...state.lessons.map((x) => x.date)]),
    ].sort(),
    dates = ui.filters.date ? [ui.filters.date] : allDates;
  const summary = `${esc(scopeName())} · ${list("group").length} групп · ${list("teacher").length} преподавателей · ${list("room").length} кабинетов · ${state.lessons.filter(scope).length} занятий (включая подгруппы)`;
  $("main").innerHTML =
    `<section class="view">${multiTabNote()}<div class="notice blue"><p><b>${esc(state.source)}</b><br>${summary}</p></div><div class="tools"><label class="search global"><input id="search" placeholder="Группа, фамилия, кабинет, корпус, специальность…" value="${esc(ui.q)}" autocomplete="off" aria-label="Общий поиск"></label><button class="btn" id="today">Сегодня</button><button class="btn" id="tomorrow">Завтра</button><button class="btn" id="reset">Сбросить фильтры</button></div>${betaToggle()}<div id="suggestions" class="chips wrapc"></div><div class="tools">${Object.entries(
      labels,
    )
      .map(([k, v]) => select(k, list(k), ui.filters[k], v))
      .join(
        "",
      )}${select("date", allDates, ui.filters.date, "День / вся неделя")}</div><div class="status"><span class="pill">Показано: ${visible.length}</span><span class="pill bad">Конфликтов: ${analysis.length}</span><span class="pill">Изменено: ${state.lessons.filter((l) => scope(l) && Model.changed(l, state.baseline)).length}</span>${Tools.unsaved(state) ? '<span class="pill warn">Правки не скачаны в Excel</span>' : ""}</div>${ui.moving ? '<div class="notice blue"><p>Выберите вторую пару для обмена. Время занятий поменяется местами; каждое занятие подгруппы меняется отдельно.</p><button class="btn" id="cancel-move">Отмена обмена</button></div>' : ""}${Tools.notesHtml(ui.loadNotes, esc)}${conflictsBox()}${myIssues().length ? `<details class="card"><summary>Замечания по файлу: ${myIssues().length}</summary><p>Пары, у которых в файле не указан кабинет или преподаватель. Они загружены, просто проверьте их.</p>${myIssues().map((x) => `<p>${esc(x.where)}: ${esc(x.reason)} — ${esc(x.raw)}</p>`).join("")}</details>` : ""}<div class="print-title"><h2>КузТАГиС · расписание</h2><p>${
      Object.entries(ui.filters)
        .filter(([, v]) => v)
        .map(([k, v]) => esc((labels[k] || "Дата") + ": " + v))
        .join(" · ") || scopeName()
    }</p></div><div class="week">${dates
      .filter((date) => ui.filters.date || visible.some((x) => x.date === date))
      .map((date) => {
        const lessons = visible.filter((x) => x.date === date);
        const periods = [...new Set(lessons.map((x) => x.period))].sort(
          (a, b) => (a ?? -1) - (b ?? -1),
        );
        return `<div class="day"><div class="day-h"><b>${new Date(date + "T12:00:00").toLocaleDateString("ru", { weekday: "long" })}</b><span>${esc(dm(date))}</span></div>${
          periods
            .map(
              (p) =>
                `<div class="period"><b>${p === null ? "Перед первой парой" : p + " пара"}</b><span class="hint"> ${esc(time(lessons.find((x) => x.period === p)))}</span><div class="cell">${lessons
                  .filter((x) => x.period === p)
                  .map(card)
                  .join("")}</div></div>`,
            )
            .join("") || '<p class="hint">Нет занятий по выбранным фильтрам</p>'
        }</div>`;
      })
      .join(
        "",
      )}</div>${printTable(visible)}${visible.length ? "" : "<p>Ничего не найдено. Измените фильтры.</p>"}<details class="card no-print"><summary>Свободные кабинеты</summary><p class="hint">Только кабинеты, известные программе. Свободно означает отсутствие записи в загруженном расписании; полнота файла не подтверждена. Текстовые аудитории также проверяются по точному названию.</p><label>Дата <select class="inp" id="free-date">${allDates.map((d) => `<option ${d === ui.filters.date ? "selected" : ""}>${d}</option>`).join("")}</select></label> <label>Пара <input class="inp" id="free-period" type="number" min="1" max="20" value="${ui.freePeriod}"></label><button class="btn" id="free-check">Показать</button><p id="free-result"></p></details></section>`;
  bindBeta();
  document.querySelectorAll(".open-conf").forEach((b) => (b.onclick = () => editor(b.dataset.id)));
  for (const [id, shift, word] of [["today", 0, "Сегодня"], ["tomorrow", 1, "Завтра"]])
    $(id).onclick = () => {
      const d = Tools.dayFilter(state, shift);
      if (!d) return notify(word + " — этого дня нет в загруженной неделе");
      ui.filters.date = d;
      render();
    };
  $("search").oninput = (e) => {
    ui.q = e.target.value;
    suggestions();
  };
  suggestions();
  $("reset").onclick = () => {
    Object.keys(ui.filters).forEach((k) => (ui.filters[k] = ""));
    ui.q = "";
    render();
  };
  document.querySelectorAll("[data-filter]").forEach(
    (e) =>
      (e.onchange = () => {
        ui.filters[e.dataset.filter] = e.value;
        render();
      }),
  );
  document.querySelectorAll("[data-lesson]").forEach(
    (e) =>
      (e.onclick = () => {
        if (ui.moving) {
          const a = ui.moving;
          ui.moving = null;
          if (a === e.dataset.lesson) {
            render();
            return;
          }
          exchange(a, e.dataset.lesson);
          notify("Пары обменены. Конфликты подсвечены.");
        } else editor(e.dataset.lesson);
      }),
  );
  if ($("cancel-move"))
    $("cancel-move").onclick = () => {
      ui.moving = null;
      render();
    };
  $("free-check").onclick = () => {
    ui.freePeriod = Number($("free-period").value);
    const probe = { date: $("free-date").value, period: ui.freePeriod };
    const rooms = [
      ...new Set([...state.rooms, ...state.lessons.map((l) => l.room)]),
    ]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "ru", { numeric: true }))
      .filter(
      (r) =>
        (!ui.filters.building ||
          Model.building(r, state.settings) === ui.filters.building) &&
        !state.lessons.some(
          (l) => !l.cancelled && l.room === r && Model.overlaps(l, probe, state.settings),
        ),
    );
    $("free-result").innerHTML = rooms.length
      ? rooms
          .map((r) => `<b>${esc(r)}</b>${Model.roomInfo(r) ? " — " + esc(Model.roomInfo(r).name) : ""}`)
          .join("<br>")
      : "Свободных кабинетов нет";
  };
}
function suggestions() {
  const q = ui.q.trim().toLowerCase();
  $("suggestions").innerHTML = q
    ? Object.entries(labels)
        .flatMap(([k, label]) =>
          list(k)
            .filter((v) => v.toLowerCase().includes(q))
            .sort(
              (a, b) =>
                Number(b.toLowerCase() === q) - Number(a.toLowerCase() === q),
            )
            .slice(0, 5)
            .map((v) => ({ k, label, v })),
        )
        .slice(0, 30)
        .map(
          (x) =>
            `<button class="chip" data-key="${x.k}" data-value="${esc(x.v)}">${esc(x.label)}: ${esc(x.v)}</button>`,
        )
        .join("") || "<span>Нет совпадений</span>"
    : "";
  $("suggestions")
    .querySelectorAll("button")
    .forEach(
      (b) =>
        (b.onclick = () => {
          ui.filters[b.dataset.key] = b.dataset.value;
          ui.q = "";
          render();
        }),
    );
}
function close() {
  const s = $("scrim");
  s.classList.remove("open");
  clearTimeout(ui.closeTimer);
  ui.closeTimer = setTimeout(
    () => {
      s.hidden = true;
    },
    Motion.reduced() ? 0 : 300,
  );
  document.querySelector(`[data-lesson="${ui.editId}"]`)?.focus();
}
function editor(id) {
  clearTimeout(ui.closeTimer);
  const l = state.lessons.find((x) => x.id === id);
  ui.editId = id;
  const old = state.baseline.find((x) => x.id === id);
  if (l.cancelled) {
    $("sheet").innerHTML = `<h3>Окно</h3><p>${esc(l.groups.join(", "))} · ${esc(new Date(l.date + "T12:00:00").toLocaleDateString("ru", { weekday: "long" }) + ", " + dm(l.date))} · ${pairName(l.period)}${l.subgroup ? " · " + l.subgroup + " подгр." : ""}</p><p>Пара снята: <b>${esc(l.subject)}</b>, ${esc(l.teacher || "без преподавателя")}, ауд. ${esc(l.room || "?")}.</p><p class="hint">В скачанном Excel эта клетка будет пустой, оформление останется.</p>${(state.notes || {})[id] ? `<p class="hint">💬 ${esc(state.notes[id])}</p>` : ""}<div class="actions"><button class="btn blue" id="edit-restore">Вернуть пару</button><button class="btn" id="edit-close">Закрыть</button></div>`;
    $("scrim").hidden = false;
    requestAnimationFrame(() => $("scrim").classList.add("open"));
    $("edit-restore").onclick = () => {
      close();
      commit(() => delete l.cancelled);
      notify("Пара возвращена");
    };
    $("edit-close").onclick = close;
    return;
  }
  $("sheet").innerHTML =
    `<h3>${esc(l.subject)}</h3><p>${esc(l.groups.join(", "))} · ${esc(new Date(l.date + "T12:00:00").toLocaleDateString("ru", { weekday: "long" }) + ", " + dm(l.date))} · ${pairName(l.period)} ${l.subgroup ? "· " + l.subgroup + " подгр." : ""}</p><label class="field" ${l.period === null ? "hidden" : ""}>Преподаватель<input class="inp" id="edit-teacher" list="teachers" value="${esc(l.teacher)}"></label><datalist id="teachers">${list(
      "teacher",
    )
      .map((t) => `<option value="${esc(t)}">`)
      .join(
        "",
      )}</datalist><label class="field">Кабинет<input class="inp" id="edit-room" list="rooms" value="${esc(l.room)}"></label><p class="hint" id="room-info"></p><datalist id="rooms">${[
      ...new Set([...state.rooms, ...list("room")]),
    ]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "ru", { numeric: true }))
      .map((t) => `<option value="${esc(t)}">${esc(Model.roomInfo(t)?.name || "")}</option>`)
      .join(
        "",
      )}</datalist><label class="field">Комментарий<input class="inp" id="edit-note" maxlength="200" placeholder="например, замена из-за болезни" value="${esc((state.notes || {})[id] || "")}"></label><p class="hint">Было в файле: ${esc(old?.teacher || "преподаватель не указан")}, ауд. ${esc(old?.room || "не указана")}, ${esc(dm(old?.date))}, ${esc(pairName(old?.period))}</p><div id="edit-conflicts" role="status"></div><div id="fix-box" class="fix-box"></div><div id="move-box" class="fix-box" hidden></div><div class="actions"><button class="btn blue" id="edit-save">Сохранить</button>${l.period === null ? "" : '<button class="btn" id="edit-move">Перенести на свободное место</button>'}<button class="btn danger" id="edit-cancel">Снять пару (окно)</button><button class="btn" id="edit-swap">Обменять с другой парой</button><button class="btn" id="edit-close">Закрыть</button></div>`;
  $("scrim").hidden = false;
  requestAnimationFrame(() => $("scrim").classList.add("open"));
  const slotText = (x) =>
    `${Tools.DAY[Tools.dayOf(x.date)]} ${dm(x.date)}, ${x.period} пара${x.roomBusy ? " · ауд. " + x.alt : ""}`;
  const typed = () => ({
    teacher: $("edit-teacher").value.trim(),
    room: $("edit-room").value.trim(),
    note: $("edit-note").value.trim(),
  });
  const apply = (v, slot) => {
    l.teacher = v.teacher;
    l.room = slot?.alt || v.room;
    if (l.room && !state.rooms.includes(l.room)) state.rooms.push(l.room);
    if (slot) {
      l.date = slot.date;
      l.period = slot.period;
      l.start = l.end = "";
    }
    state.notes = state.notes || {};
    if (v.note) state.notes[id] = v.note;
    else delete state.notes[id];
  };
  const moveTo = (slot) => {
    const v = typed();
    close();
    commit(() => apply(v, slot));
    notify("Пара перенесена: " + slotText(slot));
  };
  const bindSlots = (box, slots) =>
    box.querySelectorAll(".fix-slot").forEach((b) => (b.onclick = () => moveTo(slots[Number(b.dataset.i)])));
  const preview = () => {
    const ls = Model.copy(state.lessons),
      target = ls.find((x) => x.id === id);
    target.teacher = $("edit-teacher").value.trim();
    target.room = $("edit-room").value.trim();
    const conflicts = Model.conflicts(ls, state.settings).filter((x) =>
      x.ids.includes(id),
    );
    const r = target.room,
      info = Model.roomInfo(r),
      busy = r
        ? state.lessons.filter(
            (x) => x.id !== id && !x.cancelled && x.room === r && Model.overlaps(x, target, state.settings),
          )
        : [];
    $("room-info").textContent = r
      ? [
          info ? info.name : "кабинета нет в списке техникума",
          Model.building(r, state.settings) ? "корпус " + Model.building(r, state.settings) : "",
          info?.owner ? "заведует " + info.owner : "",
          busy.length
            ? "в это время занят: " + [...new Set(busy.flatMap((x) => x.groups))].join(", ")
            : "в это время свободен",
        ]
          .filter(Boolean)
          .join(" · ")
      : "";
    const why = conflictReasons(target, conflicts, ls, 90);
    $("edit-conflicts").innerHTML = why.length
      ? `<p><b>Почему пара красная:</b></p><ul class="why-list">${why
          .map((x) => `<li>${esc(x.text)}</li>`)
          .join("")}</ul><p class="hint">Что сделать: ${esc([...new Set(why.map((x) => howToFix[x.t]))].join("; или "))}. Подсказки ниже.</p>`
      : "<p>Конфликтов у этой пары нет.</p>";
    /* «Как исправить»: свободные кабинеты в это время или свободное время для пары */
    const types = new Set(conflicts.flatMap((x) => x.types));
    let fix = "";
    if (types.has("Кабинет")) {
      const rooms = Tools.freeRooms({ ...state, lessons: ls }, target, Model.building(target.room, state.settings)).slice(0, 6);
      fix += rooms.length
        ? `<p><b>Как исправить:</b> свободные в это время кабинеты</p><div class="chips">${rooms
            .map((r) => `<button class="chip fix-room" data-room="${esc(r)}" title="${esc(Model.roomInfo(r)?.name || "")}">${esc(r)}</button>`)
            .join("")}</div>`
        : "<p><b>Как исправить:</b> свободных кабинетов в это время нет.</p>";
    }
    let slots = [];
    if ((types.has("Группа") || types.has("Преподаватель")) && target.period !== null) {
      slots = Tools.freeSlots({ ...state, lessons: ls }, target).slice(0, 4);
      fix += slots.length
        ? `<p><b>Как исправить:</b> перенести на свободное время</p><div class="chips">${slots
            .map((x, i) => `<button class="chip fix-slot" data-i="${i}">${esc(slotText(x))}</button>`)
            .join("")}</div>`
        : "<p><b>Как исправить:</b> свободного времени для этой пары на неделе нет.</p>";
    }
    if (types.has("Преподаватель") && target.period !== null) {
      const subs = Tools.candidates({ ...state, lessons: ls }, target).slice(0, 6);
      fix += subs.length
        ? `<p><b>Как исправить:</b> свободные в это время преподаватели (★ — ведёт этот же предмет)</p><div class="chips">${subs
            .map((x) => `<button class="chip fix-teacher" data-t="${esc(x.t)}">${x.same ? "★ " : ""}${esc(x.t)}</button>`)
            .join("")}</div>`
        : "";
    }
    $("fix-box").innerHTML = fix;
    $("fix-box").querySelectorAll(".fix-teacher").forEach(
      (b) =>
        (b.onclick = () => {
          $("edit-teacher").value = b.dataset.t;
          preview();
        }),
    );
    $("fix-box").querySelectorAll(".fix-room").forEach(
      (b) =>
        (b.onclick = () => {
          $("edit-room").value = b.dataset.room;
          preview();
        }),
    );
    bindSlots($("fix-box"), slots);
  };
  $("edit-room").oninput = preview;
  $("edit-teacher").oninput = preview;
  preview();
  $("edit-save").onclick = () => {
    const v = typed();
    close();
    commit(() => apply(v));
  };
  $("edit-cancel").onclick = () => {
    const v = typed();
    close();
    commit(() => {
      apply(v);
      l.cancelled = true;
    });
    notify("Пара снята, на её месте окно. Вернуть можно в окне пары или в «Сервисе»");
  };
  if ($("edit-move"))
    $("edit-move").onclick = () => {
      const v = typed();
      const probe = { ...l, teacher: v.teacher, room: v.room };
      const slots = Tools.freeSlots({ ...state, lessons: state.lessons.map((x) => (x.id === id ? probe : x)) }, probe).slice(0, 15);
      const box = $("move-box");
      box.hidden = false;
      box.innerHTML = slots.length
        ? `<p><b>Свободное время для пары</b> (группа, преподаватель и кабинет свободны; если кабинет занят, предложен другой):</p><div class="chips">${slots
            .map((x, i) => `<button class="chip fix-slot" data-i="${i}">${esc(slotText(x))}</button>`)
            .join("")}</div>`
        : "<p>Свободного времени для этой пары на неделе нет.</p>";
      bindSlots(box, slots);
      box.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
  $("edit-swap").onclick = () => {
    close();
    ui.moving = id;
    render();
  };
  $("edit-close").onclick = close;
  if (l.period !== null) $("edit-teacher").focus();
}
function refs() {
  const groups = list("group");
  $("main").innerHTML =
    `<section class="view"><h2 class="ttl">Справочник групп</h2><p class="sub">Специальности и отделения заполнены автоматически. Если что-то не так, исправьте и нажмите «Сохранить справочник».</p><div class="tbl catalog"><table><thead><tr><th>Группа</th><th>Специальность</th><th>Отделение</th></tr></thead><tbody>${groups.map((g, i) => `<tr><td>${esc(g)}</td><td><input aria-label="Специальность ${esc(g)}" class="inp specialty" data-group="${esc(g)}" value="${esc(state.catalog[g]?.specialty || "")}"></td><td><select aria-label="Отделение ${esc(g)}" class="inp group-dept" data-group="${esc(g)}"><option value="">Не указано</option>${state.departments.map((d) => `<option ${d === state.catalog[g]?.department ? "selected" : ""}>${esc(d)}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table></div><button class="btn blue" id="save-catalog">Сохранить справочник</button><details class="card"><summary>Отделения техникума (${state.departments.length})</summary><p class="hint">Дорожное отделение: Строительство и эксплуатация автомобильных дорог, аэродромов и эксплуатация беспилотных авиационных систем.</p><div id="dept-list">${state.departments.map((d, i) => `<input class="inp full department-name" data-index="${i}" value="${esc(d)}" aria-label="Отделение ${i + 1}">`).join("")}</div><div class="actions"><button class="btn" id="add-department">Добавить отделение</button><button class="btn blue" id="save-departments">Сохранить названия</button></div></details><div class="card"><h3>Известные кабинеты</h3><p class="hint">Один кабинет в строке. Добавьте полный список для проверки свободных кабинетов.</p><textarea class="inp" id="room-catalog" rows="6">${esc(list("room").join("\n"))}</textarea><button class="btn" id="save-rooms">Сохранить кабинеты</button></div></section>`;
  $("add-department").onclick = () => {
    const input = document.createElement("input");
    input.className = "inp department-name";
    input.placeholder = "Новое отделение";
    $("dept-list").appendChild(input);
    input.focus();
  };
  $("save-departments").onclick = () => {
    const inputs = [...document.querySelectorAll(".department-name")],
      names = inputs.map((x) => x.value.trim());
    if (names.some((x) => !x) || new Set(names).size !== names.length)
      return notify("Названия должны быть непустыми и разными");
    commit(() => {
      const old = state.departments;
      Object.values(state.catalog).forEach((c) => {
        const i = old.indexOf(c.department);
        if (i >= 0) c.department = names[i];
      });
      state.departments = names;
    });
    notify("Отделения сохранены");
  };
  $("save-catalog").onclick = () => {
    const values = [...document.querySelectorAll(".specialty")].map((e) => [
        e.dataset.group,
        e.value.trim(),
      ]),
      depts = [...document.querySelectorAll(".group-dept")].map((e) => [
        e.dataset.group,
        e.value,
      ]);
    commit(() => {
      values.forEach(([g, v]) => {
        state.catalog[g] ??= {};
        state.catalog[g].specialty = v;
      });
      depts.forEach(([g, v]) => (state.catalog[g].department = v));
    });
    notify("Справочник сохранён");
  };
  $("save-rooms").onclick = () => {
    const rooms = $("room-catalog")
      .value.split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
    commit(() => (state.rooms = [...new Set(rooms)]));
    notify("Кабинеты сохранены");
  };
}
function settings() {
  $("main").innerHTML =
    `<section class="view"><h2 class="ttl">Настройки</h2><details class="card tech"><summary>Для настройщика: отделение и корпуса</summary><h3>Отделение в работе</h3><p class="hint">Смотреть и править можно только группы этого отделения. Остальные группы файла не показываются и не меняются, но учитываются при проверке кабинетов и преподавателей. Шаблон «-(Д|БС)$» означает группы, оканчивающиеся на -Д и -БС. Если очистить шаблон, будет весь техникум.</p><label class="field">Название<input class="inp" id="scope-name" value="${esc(Model.withDefaults(state.settings).scopeName)}"></label><label class="field">Шаблон групп<input class="inp" id="scope-pattern" value="${esc(Model.withDefaults(state.settings).scopePattern)}"></label><h3>Корпус по номеру кабинета</h3><p class="hint">Сейчас корпус — первая цифра номера кабинета. Этаж не вычисляется, «1 этаж» (спортзал) остаётся текстом.</p><label class="field">Правило<input class="inp" id="pattern" value="${esc(state.settings.roomPattern)}"></label><label class="field">Номер части<input class="inp" id="capture" type="number" min="1" value="${state.settings.roomGroup}"></label><p class="hint">Изменения сохраняются кнопкой «Сохранить настройки» ниже.</p></details><div class="card"><h3>Звонки</h3><p class="hint">По расписанию звонков техникума. Каждая строка — одна пара: начало–конец.</p><div class="bells">${[
      ["mon", "Понедельник"],
      ["wk", "Остальные дни"],
      ["sat", "Суббота"],
    ]
      .map(
        ([k, label]) =>
          `<label class="filter">${label}<textarea class="inp bells-input" data-key="${k}" rows="6">${state.settings.bells[k].map((x) => x.join("–")).join("\n")}</textarea></label>`,
      )
      .join(
        "",
      )}</div><label class="field">Перед первой парой (понедельник, «Разговоры о важном»)<input class="inp" id="before" value="${state.settings.before.join("–")}"></label><button class="btn blue" id="save-settings">Сохранить настройки</button></div><div class="card"><h3>Правила конфликтов</h3><p class="hint">Не считаются конфликтом: потоки (один преподаватель, предмет и кабинет у нескольких групп) и «Разговор о важном» у нескольких групп в одном кабинете. Остальное настраивается здесь, сохраняется кнопкой «Сохранить настройки».</p><label class="filter">Общие помещения, где одновременно бывает много групп (спортзал), по одному в строке<textarea class="inp" id="shared-rooms" rows="3">${esc(Model.withDefaults(state.settings).sharedRooms.join("\n"))}</textarea></label><label class="filter">Занятия вне техникума: слово в названии (практика)<input class="inp" id="practice" value="${esc(Model.withDefaults(state.settings).practice)}"></label><label class="filter">Группы, которые пока не проверяются (временно, до выяснения)<textarea class="inp" id="ignore-groups" rows="2">${esc(Model.withDefaults(state.settings).ignoreGroups.join("\n"))}</textarea></label><button class="btn blue" id="save-rules">Сохранить правила</button></div><div class="card"><h3>Резервная копия</h3><p>Сохраняет расписание, оригинал, справочники и настройки. Можно перенести на другой компьютер.</p><button class="btn" id="backup">Скачать JSON</button><button class="btn" id="table-export">Excel-таблица текущей выборки</button><label class="btn">Восстановить JSON<input id="restore" type="file" accept=".json" hidden></label></div></section>`;
  $("main").addEventListener("click", (e) => {
    if (e.target.id === "save-rules") $("save-settings").click();
  }, { once: true });
  $("save-settings").onclick = () => {
    try {
      new RegExp($("pattern").value);
      const parse = (s) => {
        const m = s.trim().match(/^(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})$/);
        if (
          !m ||
          !m.slice(1).every((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)) ||
          m[1] >= m[2]
        )
          throw Error("Проверьте время: " + s);
        return m.slice(1);
      };
      const bells = {};
      document.querySelectorAll(".bells-input").forEach((e) => {
        bells[e.dataset.key] = e.value.trim().split("\n").map(parse);
        for (let i = 1; i < bells[e.dataset.key].length; i++)
          if (bells[e.dataset.key][i][0] < bells[e.dataset.key][i - 1][1])
            throw Error("Время пар пересекается");
      });
      const lines = (id) =>
        $(id)
          .value.split("\n")
          .map((x) => x.trim())
          .filter(Boolean);
      new RegExp($("practice").value);
      if ($("scope-pattern").value.trim()) new RegExp($("scope-pattern").value.trim(), "u");
      const next = {
        ...Model.withDefaults(state.settings),
        scopeName: $("scope-name").value.trim() || "Отделение",
        scopePattern: $("scope-pattern").value.trim(),
        sharedRooms: lines("shared-rooms"),
        ignoreGroups: lines("ignore-groups"),
        practice: $("practice").value.trim(),
        roomPattern: $("pattern").value,
        roomGroup: Number($("capture").value),
        bells,
        before: parse($("before").value),
      };
      commit(() => (state.settings = next));
      notify("Настройки сохранены");
    } catch (e) {
      notify(e.message);
    }
  };
  $("table-export").onclick = async () => {
    try {
      await Export.table(state.lessons.filter(matches), state);
      notify("Таблица сохранена");
    } catch (e) {
      notify("Ошибка экспорта: " + e.message);
    }
  };
  $("backup").onclick = () =>
    Export.save(
      new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }),
      "Расписание-резерв.json",
    );
  $("restore").onchange = async (e) => {
    try {
      const s = JSON.parse(await e.target.files[0].text());
      if (
        s.version !== 1 ||
        !Array.isArray(s.lessons) ||
        !Array.isArray(s.baseline) ||
        !s.catalog ||
        !s.settings?.bells ||
        !Array.isArray(s.rooms) ||
        !Array.isArray(s.departments) ||
        !Array.isArray(s.issues) ||
        s.lessons.some((l) => Reader.validate(l))
      )
        throw Error("Неверный формат резервной копии");
      commit(() => (state = s));
      notify("Резервная копия восстановлена");
    } catch (e) {
      notify(e.message);
    }
  };
}
function help() {
  $("main").innerHTML =
    `<section class="view"><h2 class="ttl">Как пользоваться</h2><div class="card"><ol class="steps"><li><div><b>Загрузите файл.</b> Нажмите «Загрузить файл» и выберите Excel недели (.xlsx) из программы учебной части. Программа сама найдёт нужные группы (${esc(scopeName())}). Если с файлом что-то не так (мало групп, нет дней), вверху появится предупреждение.</div></li><li><div><b>Найдите нужное.</b> Начните вводить группу, фамилию или кабинет в строку поиска и нажмите подсказку, либо выберите в списках группу, преподавателя, кабинет, корпус или день. «Сегодня» и «Завтра» сразу показывают нужный день, «Сбросить фильтры» — всю неделю.</div></li><li><div><b>Поправьте пару.</b> Нажмите на пару: можно сменить преподавателя или кабинет (под кабинетом видно, что это за кабинет и свободен ли он), написать комментарий, перенести пару на свободное место или поменять местами с другой. Пары можно и просто перетаскивать мышкой.</div></li><li><div><b>Преподаватель заболел.</b> В окне пары — «Снять пару (окно)». В «Сервисе» → «Замена преподавателя» можно назначить замену (★ — ведёт тот же предмет) или поставить окно сразу на все его пары за день.</div></li><li><div><b>Следите за красным.</b> Красным выделены конфликты: группа, преподаватель или кабинет в двух местах одновременно. Под красной парой написано, почему она красная (например, «кабинет 3108 в это время занят группой 24-БС») и что сделать. Все такие пары собраны в списке «Почему есть красные пары» над расписанием. В окне пары есть подсказки «Как исправить»: свободные кабинеты, свободные преподаватели и свободное время. Ошибку можно отменить кнопкой «Отменить» или Ctrl+Z.</div></li><li><div><b>Скачайте Excel.</b> Кнопка «Excel» скачивает тот же файл, что вы загрузили: те же листы и оформление, изменены только поправленные пары. Если после правок есть конфликты, программа спросит «Вы уверены?». Пока правки не скачаны, вверху висит напоминание.</div></li><li><div><b>Сервис.</b> Список всех правок с кнопкой «Вернуть», занятость любого кабинета на неделю и нагрузка преподавателей.</div></li><li><div><b>Печать.</b> Выберите группу, преподавателя или кабинет и нажмите «Печать / PDF». В окне печати выберите А4 или «Сохранить как PDF».</div></li></ol></div><div class="card"><h3>Важно знать</h3><ul class="help-notes"><li>Файл никуда не отправляется: всё работает в браузере на этом компьютере.</li><li>Если вкладку закрыли, при следующем открытии нажмите «Продолжить» — правки на месте.</li><li>Если программой пользуются несколько человек, у каждого свой экземпляр: правки одного не видны другим. Одну неделю лучше править одному человеку и пересылать скачанный Excel.</li><li>Не открывайте программу в двух вкладках одного браузера одновременно — программа об этом предупредит.</li><li>Галочка «Работа со всеми отделениями» — бета-тестирование для остальных отделений.</li></ul></div></section>`;
}
$("import").onclick = () => $("file").click();
$("file").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = await Reader.read(file);
    if (/\.xlsx$/i.test(file.name) && data.layout)
      await keepOriginal(file.name, new Uint8Array(await file.arrayBuffer()));
    if (!data.lessons.length)
      throw Error("Не найдено занятий. Проверьте формат и дату листов.");
    commit(() => {
      const next = Model.initial(data);
      next.layout = data.layout || null;
      next.notes = {};
      next.settings = state.settings;
      next.departments = state.departments;
      const keep = Object.fromEntries(
        Object.entries(state.catalog || {}).map(([g, c]) => [
          g,
          Object.fromEntries(Object.entries(c || {}).filter(([, v]) => v)),
        ]),
      );
      for (const [g, c] of Object.entries(keep))
        next.catalog[g] = { ...(next.catalog[g] || {}), ...c };
      next.catalog = Model.fillCatalog(next.catalog, Object.keys(next.catalog), state.settings);
      next.rooms = [...new Set([...state.rooms, ...next.rooms])];
      state = next;
      ui.tab = "schedule";
      Object.keys(ui.filters).forEach((k) => (ui.filters[k] = ""));
    });
    ui.loadNotes = Tools.afterLoad(state, data.issues);
    render();
    const mine = data.lessons.filter(scope);
    if (ui.loadNotes.problems.length)
      notify("Похоже, с файлом что-то не так: " + ui.loadNotes.problems[0] + ". Подробнее — вверху расписания.");
    else if (!mine.length)
      notify(
        `Загружено ${data.lessons.length} занятий, но групп «${scopeName()}» в файле не найдено. Проверьте шаблон групп в «Настройках».`,
      );
    else
      notify(
        `Загружено: ${scopeName()} — ${mine.length} ${plural(mine.length, "пара", "пары", "пар")}, ${new Set(mine.flatMap((l) => l.groups)).size} групп${myIssues().length ? ". Проверьте замечания: " + myIssues().length : ""}`,
      );
  } catch (e) {
    notify("Не удалось загрузить: " + e.message);
  }
};
$("undo").onclick = undo;
$("export").onclick = async () => {
  if (!state.lessons.length) return notify("Сначала загрузите расписание");
  try {
    if (!/\.xlsx$/i.test(state.source || "")) {
      await Export.table(state.lessons.filter(matches), state);
      return notify("Расписание загружено не из Excel-матрицы — сохранена таблица");
    }
    let bytes = await originalFor(state.source);
    if (!bytes) {
      notify("Выберите исходный файл «" + state.source + "»: правки запишутся прямо в него");
      bytes = await askOriginal();
      if (!bytes) return;
    }
    const n = await Export.original(state, bytes, state.source, askConfirm, newConflicts());
    if (n === null) return notify("Скачивание отменено, правки на месте");
    state.exportedSig = Tools.sig(state);
    persist();
    render();
    notify(
      n
        ? `Excel сохранён в исходном виде. Изменённых пар: ${n}`
        : "Excel сохранён: правок нет, файл совпадает с исходным",
    );
  } catch (e) {
    notify("Ошибка экспорта: " + e.message);
  }
};
$("print").onclick = () => {
  if (!state.lessons.length) return notify("Сначала загрузите расписание");
  ui.tab = "schedule";
  render();
  window.print();
};
document.querySelectorAll("[data-tab]").forEach(
  (b) =>
    (b.onclick = () => {
      ui.tab = b.dataset.tab;
      ui.moving = null;
      render();
    }),
);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") close();
  if (
    (e.ctrlKey || e.metaKey) &&
    e.key.toLowerCase() === "z" &&
    !/INPUT|TEXTAREA/.test(e.target.tagName)
  ) {
    e.preventDefault();
    undo();
  }
  if (e.key === "Tab" && !$("scrim").hidden) {
    const a = [...$("sheet").querySelectorAll("input,button")],
      first = a[0],
      last = a[a.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});
$("scrim").onclick = (e) => {
  if (e.target === $("scrim")) close();
};
/* Две вкладки одного браузера делят сохранение: предупреждаем, чтобы правки не перезаписали друг друга. */
(() => {
  const me = Math.random().toString(36).slice(2);
  let ch = null;
  try {
    ch = new BroadcastChannel("kuztagis-viewer");
  } catch {
    return;
  }
  const others = new Set();
  const update = () => {
    const was = ui.otherTab;
    ui.otherTab = others.size > 0;
    if (was !== ui.otherTab && (ui.tab === "schedule" || !state.lessons.length)) render();
  };
  ch.onmessage = (e) => {
    const m = e.data || {};
    if (m.id === me) return;
    if (m.type === "hello") ch.postMessage({ type: "here", id: me });
    if (m.type === "hello" || m.type === "here") others.add(m.id);
    if (m.type === "bye") others.delete(m.id);
    update();
  };
  ch.postMessage({ type: "hello", id: me });
  window.addEventListener("pagehide", () => ch.postMessage({ type: "bye", id: me }));
})();
function multiTabNote() {
  return ui.otherTab
    ? '<div class="notice warn"><p><b>Программа уже открыта в другой вкладке этого браузера.</b> Работайте в одной вкладке: правки из разных вкладок сохраняются в одно место и могут перезаписать друг друга. Закройте лишнюю вкладку.</p></div>'
    : "";
}
window.addEventListener("beforeunload", (e) => {
  if (!Tools.unsaved(state)) return;
  e.preventDefault();
  e.returnValue = "";
});
render();

// Dedicated print rows prevent browser column pagination from separating period labels and lessons.
function printTable(lessons) {
  const rows = [...lessons].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.period ?? -1) - (b.period ?? -1) ||
      a.groups.join().localeCompare(b.groups.join(), "ru") ||
      a.subgroup - b.subgroup,
  );
  return `<div class="print-table"><table><thead><tr><th>Дата / день</th><th>Пара / время</th><th>Группа</th><th>Дисциплина</th><th>Преподаватель</th><th>Аудитория</th><th>Отметки</th></tr></thead><tbody>${rows.map((l) => `<tr><td>${esc(dm(l.date))}<br>${new Date(l.date + "T12:00:00").toLocaleDateString("ru", { weekday: "short" })}</td><td>${l.period ?? "До первой"}<br>${esc(time(l))}</td><td>${esc(l.groups.join(", "))}${l.subgroup ? "<br>" + l.subgroup + " подгр." : ""}</td><td>${l.cancelled ? "Окно (пара снята)" : esc(l.subject)}</td><td>${l.cancelled ? "" : esc(l.teacher || "Не указан")}</td><td>${esc(l.room || "Не указана")}</td><td>${Model.changed(l, state.baseline) ? "Изменено. " : ""}${esc([...new Set(analysis.filter((c) => c.ids.includes(l.id)).flatMap((c) => c.types))].join(", "))}</td></tr>`).join("")}</tbody></table></div>`;
}

function exchange(a, b) {
  const snapshots = Motion.capture([a, b]);
  try {
    commit(() => Model.swap(state.lessons, a, b));
  } catch (e) {
    history.pop();
    ui.moving = null;
    render();
    notify(e.message);
    return;
  }
  Motion.exchange(snapshots);
}
let dragged = null;
$("main").addEventListener("dragstart", (e) => {
  const card = e.target.closest("[data-lesson]");
  if (!card) return;
  dragged = card.dataset.lesson;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", dragged);
  card.classList.add("drag-source");
});
$("main").addEventListener("dragover", (e) => {
  const card = e.target.closest("[data-lesson]");
  if (card && dragged && card.dataset.lesson !== dragged) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    card.classList.add("drop-target");
  }
});
$("main").addEventListener("dragleave", (e) =>
  e.target.closest("[data-lesson]")?.classList.remove("drop-target"),
);
$("main").addEventListener("drop", (e) => {
  const card = e.target.closest("[data-lesson]");
  if (card && dragged && card.dataset.lesson !== dragged) {
    e.preventDefault();
    const a = dragged;
    dragged = null;
    exchange(a, card.dataset.lesson);
    notify("Пары обменены. Конфликты подсвечены.");
  }
});
$("main").addEventListener("dragend", () => {
  dragged = null;
  document
    .querySelectorAll(".drag-source,.drop-target")
    .forEach((e) => e.classList.remove("drag-source", "drop-target"));
});
new MutationObserver(() => {
  $("main")
    .querySelectorAll("[data-lesson]:not([draggable])")
    .forEach((e) => (e.draggable = true));
}).observe($("main"), { childList: true, subtree: true });
$("main")
  .querySelectorAll("[data-lesson]")
  .forEach((e) => (e.draggable = true));

$("main").addEventListener(
  "toggle",
  (e) => {
    if (e.target.tagName === "DETAILS" && e.target.open)
      Motion.play(e.target, [
        { opacity: 0.5, transform: "translateY(3px)" },
        { opacity: 1, transform: "none" },
      ]);
  },
  true,
);

/* Вкладка «Сервис»: замена преподавателя, правки, занятость кабинета, нагрузка. */
function tools() {
  if (!state.lessons.length) {
    $("main").innerHTML =
      '<section class="view"><h2 class="ttl">Сервис</h2><div class="card"><p>Сначала загрузите расписание на вкладке «Расписание».</p></div></section>';
    return;
  }
  ui.svc = ui.svc || {};
  const s = ui.svc;
  const teachers = list("teacher");
  const dates = [...new Set([...(state.dates || []), ...state.lessons.map((l) => l.date)])].sort();
  const rooms = [...new Set([...state.rooms, ...state.lessons.map((l) => l.room)])]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "ru", { numeric: true }));
  const opt = (v, cur, label) =>
    `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(label ?? v)}</option>`;
  const dayName = (d) =>
    new Date(d + "T12:00:00").toLocaleDateString("ru", { weekday: "long" }) + ", " + dm(d);

  /* замена преподавателя */
  let sub = "";
  if (s.teacher) {
    const ls = state.lessons
      .filter((l) => scope(l) && !l.cancelled && l.teacher === s.teacher && (!s.day || l.date === s.day))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.period ?? -1) - (b.period ?? -1));
    sub = ls.length
      ? ls
          .map((l) => {
            const c = Tools.candidates(state, l);
            return `<div class="sub-row"><p><b>${esc(dayName(l.date))}, ${esc(pairName(l.period))}</b> · ${esc(l.groups.join(", "))}${l.subgroup ? ", " + l.subgroup + " подгр." : ""} · ${esc(l.subject)} · ауд. ${esc(l.room || "?")}</p><div class="sub-pick"><select class="inp sub-cand" data-id="${esc(l.id)}">${c
              .map((x) => opt(x.t, "", (x.same ? "★ " : "") + x.t))
              .join("")}</select><button class="btn blue sub-apply" data-id="${esc(l.id)}" ${c.length ? "" : "disabled"}>Заменить</button><button class="btn danger sub-off" data-id="${esc(l.id)}">Окно</button></div></div>`;
          })
          .join("")
      : '<p class="hint">У этого преподавателя нет пар в выбранный день.</p>';
    if (ls.length > 1)
      sub = `<div class="actions"><button class="btn danger" id="sub-all-off">Окно на все его пары${s.day ? " в этот день" : " на неделе"} (${ls.length})</button></div>` + sub;
  }

  /* правки */
  const notes = state.notes || {};
  const ch = Tools.changes(state).filter((x) => scope(x.l));
  const noted = state.lessons.filter((l) => notes[l.id] && scope(l) && !ch.some((x) => x.l.id === l.id));
  const fmt = (x) =>
    x.cancelled
      ? `${dm(x.date)}, ${pairName(x.period)}: окно (пара снята)`
      : `${dm(x.date)}, ${pairName(x.period)}: ${x.subject} (${x.teacher || "без преподавателя"}, ауд. ${x.room || "?"})`;

  /* занятость кабинета */
  let grid = "";
  if (s.room) {
    const ls = state.lessons.filter((l) => !l.cancelled && l.room === s.room);
    const periods = [...new Set([null, 1, 2, 3, 4, 5, 6, ...ls.map((l) => l.period)])].filter(
      (p) => p !== null || ls.some((l) => l.period === null),
    );
    grid = `<div class="tbl"><table class="room-grid"><thead><tr><th>Пара</th>${dates
      .map((d) => `<th>${esc(Tools.DAY[Tools.dayOf(d)])} ${esc(dm(d))}</th>`)
      .join("")}</tr></thead><tbody>${periods
      .map(
        (p) =>
          `<tr><td>${p === null ? "до 1-й" : p}</td>${dates
            .map((d) => {
              const here = ls.filter((l) => l.date === d && l.period === p);
              return here.length
                ? `<td class="busy">${esc([...new Set(here.flatMap((l) => l.groups))].join(", "))}</td>`
                : '<td class="free">свободно</td>';
            })
            .join("")}</tr>`,
      )
      .join("")}</tbody></table></div>`;
  }

  /* нагрузка */
  const load = Tools.load(state, teachers);

  $("main").innerHTML = `<section class="view"><h2 class="ttl">Сервис</h2>
  <div class="card"><h3>Замена преподавателя</h3><p class="hint">Выберите, кто не может прийти, и день. Для каждой его пары можно назначить замену (★ — ведёт этот же предмет) или поставить окно — пара снимается, клетка в Excel станет пустой.</p><div class="tools"><label class="filter">Преподаватель<select class="inp" id="sub-teacher"><option value="">Выберите</option>${teachers
    .map((t) => opt(t, s.teacher))
    .join("")}</select></label><label class="filter">День<select class="inp" id="sub-day"><option value="">Вся неделя</option>${dates
    .map((d) => opt(d, s.day, dayName(d)))
    .join("")}</select></label></div>${sub}</div>
  <div class="card"><h3>Правки (${ch.length})</h3>${
    ch.length
      ? `<p class="hint">Всё, что изменено по сравнению с загруженным файлом. «Вернуть» возвращает пару как было; у обмена возвращаются обе пары.</p><ul class="changes">${ch
          .map(
            (x) =>
              `<li><b>${esc(x.l.groups.join(", "))}</b>: <s>${esc(fmt(x.b))}</s> → ${esc(fmt(x.l))} <button class="btn small revert" data-id="${esc(x.l.id)}">Вернуть</button>${notes[x.l.id] ? `<br><span class="hint">💬 ${esc(notes[x.l.id])}</span>` : ""}</li>`,
          )
          .join("")}</ul>`
      : '<p class="hint">Правок пока нет.</p>'
  }${noted.length ? `<p><b>Комментарии без правок</b></p><ul class="changes">${noted.map((l) => `<li><b>${esc(l.groups.join(", "))}</b>: ${esc(fmt(l))}<br><span class="hint">💬 ${esc(notes[l.id])}</span></li>`).join("")}</ul>` : ""}</div>
  <div class="card"><h3>Занятость кабинета на неделю</h3><label class="filter">Кабинет<select class="inp" id="room-pick"><option value="">Выберите</option>${rooms
    .map((r) => opt(r, s.room, r + (Model.roomInfo(r) ? " — " + Model.roomInfo(r).name : "")))
    .join("")}</select></label>${grid}</div>
  <div class="card"><h3>Нагрузка преподавателей</h3><p class="hint">Пары за неделю по всему файлу (поток считается одной парой). «Окна» — пустые пары между занятиями в один день.</p><div class="tbl"><table><thead><tr><th>Преподаватель</th><th>Пар</th><th>Дней</th><th>Окна</th></tr></thead><tbody>${load
    .map(
      (x) =>
        `<tr><td>${esc(x.t)}</td><td>${x.pairs}</td><td>${x.days}</td><td class="${x.windows ? "warn-t" : ""}">${x.windows}</td></tr>`,
    )
    .join("")}</tbody></table></div></div></section>`;

  $("sub-teacher").onchange = (e) => {
    s.teacher = e.target.value;
    render();
  };
  $("sub-day").onchange = (e) => {
    s.day = e.target.value;
    render();
  };
  document.querySelectorAll(".sub-apply").forEach(
    (b) =>
      (b.onclick = () => {
        const id = b.dataset.id,
          t = document.querySelector(`.sub-cand[data-id="${CSS.escape(id)}"]`).value;
        commit(() => (state.lessons.find((l) => l.id === id).teacher = t));
        notify("Преподаватель заменён: " + t);
      }),
  );
  const off = (ids) => {
    commit(() =>
      ids.forEach((id) => {
        state.lessons.find((l) => l.id === id).cancelled = true;
        state.notes = state.notes || {};
        if (!state.notes[id]) state.notes[id] = "Преподаватель отсутствует";
      }),
    );
    notify(ids.length > 1 ? `Снято пар: ${ids.length}, на их месте окна` : "Пара снята, на её месте окно");
  };
  document.querySelectorAll(".sub-off").forEach((b) => (b.onclick = () => off([b.dataset.id])));
  if ($("sub-all-off"))
    $("sub-all-off").onclick = () => off([...document.querySelectorAll(".sub-off")].map((b) => b.dataset.id));
  document.querySelectorAll(".revert").forEach(
    (b) =>
      (b.onclick = () => {
        commit(() => Tools.revert(state, b.dataset.id));
        notify("Пара возвращена как в файле");
      }),
  );
  $("room-pick").onchange = (e) => {
    s.room = e.target.value;
    render();
  };
}

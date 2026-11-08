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
  view: (() => {
    try {
      return localStorage.getItem("kuztagis-view") || "cards";
    } catch {
      return "cards";
    }
  })(),
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
function dayBar(allDates) {
  const SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  const FULL = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
  const today = Tools.isoLocal(new Date());
  const sorted = [...allDates].sort();
  const ds = [];
  if (sorted.length)
    for (let t = new Date(sorted[0] + "T12:00:00"); Tools.isoLocal(t) <= sorted[sorted.length - 1]; t.setDate(t.getDate() + 1)) {
      const d = Tools.isoLocal(t);
      if (Tools.dayOf(d) !== 0 || state.lessons.some((l) => l.date === d && scope(l))) ds.push(d);
    }
  const cur = ui.filters.date || "";
  return `<nav class="day-bar" aria-label="Дни недели"><button class="day-btn${cur ? "" : " on"}" data-day="" aria-pressed="${!cur}"><b>Вся неделя</b></button>${ds
    .map((d) => {
      const n = state.lessons.filter((l) => l.date === d && scope(l) && !l.cancelled).length;
      const w = Tools.dayOf(d);
      return `<button class="day-btn${d === cur ? " on" : ""}${n ? "" : " no-pairs"}" data-day="${d}" aria-pressed="${d === cur}" title="${FULL[w]}, ${dm(d)}${n ? "" : " — пар нет"}"><b>${SHORT[w]}</b><small>${dm(d)}${d === today ? " · сегодня" : ""}</small></button>`;
    })
    .join("")}</nav>`;
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
function dayLabel(d) {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + "T12:00:00").toLocaleDateString("ru", { weekday: "long" }) + ", " + dm(d) : d;
}
function select(key, values, value, label) {
  return `<label class="filter">${esc(label)}<select class="inp" data-filter="${key}"><option value="">Все</option>${values.map((v) => `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(key === "date" ? dayLabel(v) : v)}</option>`).join("")}</select></label>`;
}
function time(l) {
  return Model.times(l, state.settings)?.join("–") || "Звонки не заданы";
}
/* Сдвоенные пары: две группы вместе в одном кабинете / у одного преподавателя — не конфликт. */
const ckey = (c) => [...c.ids].sort().join("|");
const combinedSet = () => new Set(state.combined || []);
const notCombined = (c) => !combinedSet().has(ckey(c));
function combinedWith(l) {
  const byId = new Map(state.lessons.map((x) => [x.id, x]));
  return (state.combined || [])
    .map((k) => k.split("|"))
    .filter((ids) => ids.includes(l.id))
    .map((ids) => byId.get(ids.find((x) => x !== l.id)))
    .filter((o) => o && !o.cancelled && Model.overlaps(o, l, state.settings));
}
function setCombined(key, on) {
  commit(() => {
    const set = new Set(state.combined || []);
    if (on) set.add(key);
    else set.delete(key);
    state.combined = [...set];
  });
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
    const key = ckey(c),
      canCombine = !c.types.includes("Группа") || !o.groups.some((g) => l.groups.includes(g));
    const push0 = out.push.bind(out);
    out.push = (x) => push0({ ...x, key, canCombine, og });
    for (const t of c.types) {
      if (t === "Кабинет")
        out.push({ t, text: `Кабинет ${o.room} в это время занят: ${og}, «${cut(o.subject)}», ${o.teacher || "без преподавателя"}${was}` });
      if (t === "Преподаватель")
        out.push({ t, text: `${o.teacher} в это же время ведёт пару у ${og}: «${cut(o.subject)}», ауд. ${o.room || "?"}${was}` });
      if (t === "Группа")
        out.push({ t, text: `У ${og} в это же время уже стоит «${cut(o.subject)}» (${o.teacher || "без преподавателя"}, ауд. ${o.room || "?"})${was}` });
    }
    out.push = push0;
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
    const combo = why.find((x) => x.canCombine);
    rows.push(
      `<li>${combo ? `<button class="chip comb-on-list" data-key="${esc(combo.key)}">Сдвоенная — не конфликт</button> ` : ""}<button class="link-btn open-conf" data-id="${esc(l.id)}">${esc(Tools.DAY[Tools.dayOf(l.date)] + " " + dm(l.date) + ", " + pairName(l.period) + " · " + l.groups.join(", ") + " «" + l.subject + "»")}</button><br>${why.map((x) => esc(x.text)).join("<br>")}</li>`,
    );
  }
  return rows.length
    ? `<details class="card no-print"><summary>Почему есть красные пары: ${rows.length}</summary><p class="hint">Красная пара — это пересечение: группа, преподаватель или кабинет стоят в двух местах в одно время. Нажмите на пару в списке — откроется окно с подсказками, как исправить.</p><ul class="why-list">${rows.join("")}</ul></details>`
    : "";
}
/* Цвет карточки по корпусу */
const HUE = { 1: 211, 2: 145, 3: 28 };
const hueOf = (l) => HUE[Model.building(l.room, state.settings)] ?? 265;
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
  return `<button class="les ${conflicts.length ? "bad" : ""} ${ui.moving === l.id ? "selected" : ""}" ${why.length ? `title="${esc(why.map((x) => x.text).join("\n") + "\nНажмите, чтобы исправить")}"` : ""} style="--h:${hueOf(l)}" data-lesson="${esc(l.id)}"><span class="s">${esc(l.subject)}</span><span class="m">${esc(l.groups.join(", "))}${l.subgroup ? " · " + l.subgroup + " подгр." : ""}</span>${l.teacher || l.period !== null ? `<span class="m">${esc(l.teacher || "Преподаватель не указан")}</span>` : ""}<span class="m">${esc(l.room ? "Ауд. " + l.room : "Кабинет не указан")}${Model.building(l.room, state.settings) ? " · корпус " + Model.building(l.room, state.settings) : ""}</span><span class="tags">${l.added ? '<span class="tag mv">Новая пара</span>' : Model.changed(l, state.baseline) ? '<span class="tag mv">Изменено</span>' : ""}${(state.notes || {})[l.id] ? `<span class="tag note" title="${esc(state.notes[l.id])}">💬 ${esc(state.notes[l.id].length > 40 ? state.notes[l.id].slice(0, 40) + "…" : state.notes[l.id])}</span>` : ""}${same ? '<span class="tag db">Две пары подряд</span>' : ""}${combinedWith(l).length ? `<span class="tag comb">Сдвоенная с ${esc([...new Set(combinedWith(l).flatMap((o) => o.groups))].join(", "))}</span>` : ""}${conflicts.length ? `<span class="tag bd">${esc([...new Set(conflicts.flatMap((c) => c.types))].join(", "))}</span>` : ""}</span>${why.length ? `<span class="why">${why.slice(0, 2).map((x) => `<span>⚠ ${esc(x.text)}</span>`).join("")}${why.length > 2 ? `<span>…и ещё ${why.length - 2}</span>` : ""}<span class="why-fix">Как исправить: ${esc(howToFix[why[0].t])}. Нажмите на пару.</span></span>` : ""}</button>`;
}
function render() {
  const oldBad = new Set(
    [...document.querySelectorAll(".les.bad")].map((e) => e.dataset.lesson),
  );
  /* Конфликты считаются по всему файлу (кабинеты и преподаватели общие), показываются только касающиеся отделения. */
  const inside = new Set(state.lessons.filter(scope).map((l) => l.id));
  analysis = Model.conflicts(state.lessons, state.settings).filter(
    (c) => c.ids.some((id) => inside.has(id)) && notCombined(c),
  );
  $("undo").disabled = !history.length;
  {
    const pend = !!state && state.lessons?.length > 0 && Tools.unsaved(state);
    $("export").classList.toggle("pending", pend);
    $("export").title = pend ? "Есть правки — нажмите, чтобы скачать Excel с ними" : "Скачать Excel с правками";
  }
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
    .filter((c) => c.ids.some((id) => inside.has(id)) && !before.has(key(c)) && notCombined(c))
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
    `<section class="view">${multiTabNote()}<div class="notice blue"><p><b>${esc(state.source)}</b><br>${summary}</p></div><div class="tools"><label class="search global"><input id="search" placeholder="Группа, фамилия, кабинет, корпус, специальность…" value="${esc(ui.q)}" autocomplete="off" aria-label="Общий поиск"></label><button class="btn blue" id="add-pair">+ Добавить пару</button><button class="btn" id="today">Сегодня</button><button class="btn" id="tomorrow">Завтра</button><button class="btn" id="reset">Сбросить фильтры</button></div>${betaToggle()}<div id="suggestions" class="chips wrapc"></div><div class="tools">${Object.entries(
      labels,
    )
      .map(([k, v]) => select(k, list(k), ui.filters[k], v))
      .join(
        "",
      )}${select("date", allDates, ui.filters.date, "День / вся неделя")}</div>${dayBar(allDates)}<div class="status"><span class="pill">Показано: ${visible.length}</span><span class="seg view-seg">${[["cards", "Карточки"], ["table", "Таблица"]].map(([v, t]) => `<button data-view="${v}" aria-pressed="${(ui.view || "cards") === v}">${t}</button>`).join("")}</span><span class="pill bad">Конфликтов: ${analysis.length}</span><span class="legend"><i style="--h:211"></i>корпус 1<i style="--h:145"></i>корпус 2<i style="--h:28"></i>корпус 3<i style="--h:265"></i>спортзал / другое</span><span class="pill">Изменено: ${state.lessons.filter((l) => scope(l) && Model.changed(l, state.baseline)).length}</span>${Tools.unsaved(state) ? '<button class="pill warn dl-pill" id="export-pill" title="Скачать Excel с правками">Правки не скачаны в Excel — скачать</button>' : ""}</div>${ui.moving ? '<div class="notice blue"><p>Выберите вторую пару для обмена. Время занятий поменяется местами; каждое занятие подгруппы меняется отдельно.</p><button class="btn" id="cancel-move">Отмена обмена</button></div>' : ""}${Tools.notesHtml(ui.loadNotes, esc)}${conflictsBox()}${myIssues().length ? `<details class="card"><summary>Замечания по файлу: ${myIssues().length}</summary><p>Пары, у которых в файле не указан кабинет или преподаватель. Они загружены, просто проверьте их.</p>${myIssues().map((x) => `<p>${esc(x.where)}: ${esc(x.reason)} — ${esc(x.raw)}</p>`).join("")}</details>` : ""}<div class="print-title"><h2>КузТАГиС · расписание</h2><p>${
      Object.entries(ui.filters)
        .filter(([, v]) => v)
        .map(([k, v]) => esc(k === "date" ? "День: " + dayLabel(v) : (labels[k] || "Дата") + ": " + v))
        .join(" · ") || scopeName()
    }</p></div>${ui.view === "table" ? tableView(dates) : `<div class="week">${dates
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
      )}</div>`}${printTable(visible)}${visible.length ? "" : "<p>Ничего не найдено. Измените фильтры.</p>"}<details class="card no-print"><summary>Свободные кабинеты</summary><p class="hint">Только кабинеты, известные программе. Свободно означает отсутствие записи в загруженном расписании; полнота файла не подтверждена. Текстовые аудитории также проверяются по точному названию.</p><label>Дата <select class="inp" id="free-date">${allDates.map((d) => `<option ${d === ui.filters.date ? "selected" : ""}>${d}</option>`).join("")}</select></label> <label>Пара <input class="inp" id="free-period" type="number" min="1" max="20" value="${ui.freePeriod}"></label><button class="btn" id="free-check">Показать</button><p id="free-result"></p></details></section>`;
  bindBeta();
  $("add-pair").onclick = () => addPair();
  document.querySelectorAll("[data-view]").forEach(
    (b) =>
      (b.onclick = () => {
        ui.view = b.dataset.view;
        try {
          localStorage.setItem("kuztagis-view", ui.view);
        } catch {}
        render();
      }),
  );
  document.querySelectorAll(".tv-empty").forEach(
    (b) => (b.onclick = () => addPair({ group: b.dataset.g, date: b.dataset.d, period: Number(b.dataset.p) })),
  );
  document.querySelectorAll(".open-conf").forEach((b) => (b.onclick = () => editor(b.dataset.id)));
  document.querySelectorAll(".comb-on-list").forEach(
    (b) =>
      (b.onclick = () => {
        setCombined(b.dataset.key, true);
        notify("Отмечено как сдвоенная пара — конфликта больше нет");
      }),
  );
  {
    const ds = [...new Set([...(state.dates || []), ...state.lessons.map((l) => l.date)])].sort();
    const span = ds.length ? dm(ds[0]) + "–" + dm(ds[ds.length - 1]) : "";
    for (const [id, shift, word] of [["today", 0, "Сегодня"], ["tomorrow", 1, "Завтра"]]) {
      const d0 = Tools.dayFilter(state, shift);
      const d = d0 && state.lessons.some((l) => l.date === d0 && !l.cancelled) ? d0 : null;
      const when = new Date();
      when.setDate(when.getDate() + shift);
      const iso = Tools.isoLocal(when);
      const inWeek = !d && ds.length && iso >= ds[0] && iso <= ds[ds.length - 1];
      const why = inWeek
        ? `${word} ${dm(iso)} в загруженном файле пар нет (праздник или выходной).`
        : `${word} ${dm(iso)}, а загружена неделя ${span}. Кнопка работает, когда загружена текущая неделя.`;
      const b = $(id);
      b.classList.toggle("dim", !d && !inWeek);
      b.title = d ? "Показать только " + word.toLowerCase() + " (" + dm(d) + ")" : why;
      b.onclick = () => {
        if (!d) return notify(why);
        ui.filters.date = d;
        render();
      };
    }
  }
  {
    const on = document.querySelector(".day-btn.on"), bar = on?.parentElement;
    if (bar && (on.offsetLeft < bar.scrollLeft || on.offsetLeft + on.offsetWidth > bar.scrollLeft + bar.clientWidth))
      bar.scrollLeft = on.offsetLeft - 8;
  }
  if ($("export-pill")) $("export-pill").onclick = () => $("export").click();
  document.querySelectorAll(".day-btn").forEach(
    (b) =>
      (b.onclick = () => {
        ui.filters.date = b.dataset.day;
        render();
        if (b.dataset.day && !state.lessons.some((l) => l.date === b.dataset.day && scope(l) && !l.cancelled))
          notify("В этот день пар нет (праздник или выходной)");
      }),
  );
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
          if (exchange(a, e.dataset.lesson) !== false) notify("Пары обменены." + (Tools.unsaved(state) ? " Не забудьте скачать Excel — кнопка «Скачать Excel» стала зелёной." : ""));
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
    `<h3>${esc(l.subject)}</h3><p>${esc(l.groups.join(", "))} · ${esc(new Date(l.date + "T12:00:00").toLocaleDateString("ru", { weekday: "long" }) + ", " + dm(l.date))} · ${pairName(l.period)} ${l.subgroup ? "· " + l.subgroup + " подгр." : ""}</p><label class="field" ${l.period === null ? "hidden" : ""}>Преподаватель<input class="inp" id="edit-teacher" autocomplete="off" value="${esc(l.teacher)}"></label><datalist id="teachers">${list(
      "teacher",
    )
      .map((t) => `<option value="${esc(t)}">`)
      .join(
        "",
      )}</datalist><label class="field">Кабинет<input class="inp" id="edit-room" autocomplete="off" value="${esc(l.room)}"></label><p class="hint" id="room-info"></p><datalist id="rooms">${[
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
    const conflicts = Model.conflicts(ls, state.settings).filter(
      (x) => x.ids.includes(id) && notCombined(x),
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
    const combKeys = [...new Map(why.filter((x) => x.canCombine).map((x) => [x.key, x.og])).entries()];
    const partners = combinedWith(l);
    $("edit-conflicts").innerHTML =
      (why.length
        ? `<p><b>Почему пара красная:</b></p><ul class="why-list">${why
            .map((x) => `<li>${esc(x.text)}</li>`)
            .join("")}</ul><p class="hint">Что сделать: ${esc([...new Set(why.map((x) => howToFix[x.t]))].join("; или "))}. Подсказки ниже.</p>${
            combKeys.length
              ? `<p class="hint">Если группы на самом деле занимаются вместе (сдвоенная пара), отметьте это — конфликта не будет:</p><div class="chips">${combKeys
                  .map(([k, og]) => `<button class="chip comb-on" data-key="${esc(k)}">Сдвоенная с ${esc(og)} — не конфликт</button>`)
                  .join("")}</div>`
              : ""
          }`
        : "<p>Конфликтов у этой пары нет.</p>") +
      (partners.length
        ? `<p class="comb-note">Сдвоенная пара с ${esc(partners.map((o) => o.groups.join(", ") + (o.subgroup ? " (" + o.subgroup + " подгр.)" : "")).join(", "))}: занимаются вместе, это не конфликт. <button class="link-btn comb-off">Убрать отметку</button></p>`
        : "");
    $("edit-conflicts").querySelectorAll(".comb-on").forEach(
      (b) =>
        (b.onclick = () => {
          const v = typed();
          close();
          commit(() => apply(v));
          setCombined(b.dataset.key, true);
          notify("Отмечено как сдвоенная пара — конфликта больше нет");
        }),
    );
    const off = $("edit-conflicts").querySelector(".comb-off");
    if (off)
      off.onclick = () => {
        close();
        for (const k of state.combined || []) if (k.split("|").includes(id)) setCombined(k, false);
        notify("Отметка «сдвоенная» убрана");
      };
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
  /* Раскрывающиеся списки: весь список с пометкой «свободен/занят», можно вписать любое значение */
  const busyAt = (pred) => {
    const ls = state.lessons.filter((x) => x.id !== id && !x.cancelled && l.period !== null && Model.overlaps(x, l, state.settings));
    return (v) => ls.filter((x) => pred(x, v));
  };
  const norm = (s) => String(s || "").toLowerCase().replace(/ё/g, "е").replace(/[\s.]+/g, " ").trim();
  const tBusy = busyAt((x, v) => norm(x.teacher) === norm(v));
  const rBusy = busyAt((x, v) => x.room === v);
  const shared = new Set(Model.withDefaults(state.settings).sharedRooms.map(norm));
  const teacherItems = () => {
    const all = [...new Set(state.lessons.map((x) => x.teacher).filter(Boolean))];
    const same = new Set(state.lessons.filter((x) => x.subject === l.subject).map((x) => x.teacher));
    return all
      .map((t) => {
        const b = tBusy(t);
        return { v: t, star: same.has(t), busy: b.length, sub: b.length ? "занят: " + [...new Set(b.flatMap((x) => x.groups))].join(", ") : "свободен" };
      })
      .sort((a, b) => a.busy - b.busy || b.star - a.star || a.v.localeCompare(b.v, "ru"));
  };
  const roomItems = () => {
    const home = Model.building(l.room, state.settings);
    const all = [...new Set([...Model.allRooms(), ...state.rooms, ...state.lessons.map((x) => x.room)].filter(Boolean))];
    return all
      .map((r) => {
        const b = shared.has(norm(r)) ? [] : rBusy(r);
        const info = Model.roomInfo(r), k = Model.building(r, state.settings);
        return {
          v: r, busy: b.length, near: k && k === home,
          sub: [info?.name, k ? "корпус " + k : "", b.length ? "занят: " + [...new Set(b.flatMap((x) => x.groups))].join(", ") : "свободен"].filter(Boolean).join(" · "),
        };
      })
      .sort((a, b) => a.busy - b.busy || b.near - a.near || a.v.localeCompare(b.v, "ru", { numeric: true }));
  };
  const combo = (inp, items, what) => {
    const wrap = document.createElement("span");
    wrap.className = "combo";
    inp.replaceWith(wrap);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "combo-btn";
    btn.setAttribute("aria-label", "Показать список: " + what);
    btn.textContent = "▾";
    const box = document.createElement("div");
    box.className = "combo-list";
    box.hidden = true;
    wrap.append(inp, btn, box);
    let all = false, cur = -1;
    const draw = () => {
      const q = all ? "" : norm(inp.value);
      const xs = items().filter((x) => !q || norm(x.v).includes(q) || norm(x.sub).includes(q)).slice(0, 400);
      cur = -1;
      box.innerHTML = xs.length
        ? xs.map((x, i) => `<button type="button" class="combo-opt${x.busy ? " busy" : ""}" data-i="${i}" data-v="${esc(x.v)}"><b>${x.star ? "★ " : ""}${esc(x.v)}</b><small>${esc(x.sub)}</small></button>`).join("")
        : `<p class="combo-none">Нет в списке — можно оставить «${esc(inp.value)}» как есть</p>`;
      box.querySelectorAll(".combo-opt").forEach((o) => (o.onmousedown = (e) => { e.preventDefault(); pick(o.dataset.v); }));
    };
    const open = (full) => { all = full; draw(); box.hidden = false; };
    const shut = () => { box.hidden = true; };
    const pick = (v) => { inp.value = v; shut(); preview(); };
    btn.onmousedown = (e) => { e.preventDefault(); if (box.hidden) { inp.focus(); open(true); } else shut(); };
    inp.addEventListener("click", () => box.hidden && open(true));
    inp.addEventListener("input", () => { open(false); preview(); });
    inp.addEventListener("blur", () => setTimeout(shut, 120));
    inp.addEventListener("keydown", (e) => {
      const os = [...box.querySelectorAll(".combo-opt")];
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (box.hidden) open(true);
        cur = Math.max(0, Math.min(os.length - 1, cur + (e.key === "ArrowDown" ? 1 : -1)));
        os.forEach((o, i) => o.classList.toggle("on", i === cur));
        os[cur]?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter" && !box.hidden && os[cur]) {
        e.preventDefault();
        pick(os[cur].dataset.v);
      } else if (e.key === "Escape" && !box.hidden) {
        e.preventDefault();
        e.stopPropagation();
        shut();
      }
    });
  };
  combo($("edit-teacher"), teacherItems, "преподаватели");
  combo($("edit-room"), roomItems, "кабинеты");
  preview();
  $("edit-save").onclick = () => {
    const v = typed();
    close();
    commit(() => apply(v));
    const c = analysis.filter((x) => x.ids.includes(id) && notCombined(x));
    notify(c.length ? "Сохранено, но у пары есть пересечение: " + [...new Set(c.flatMap((x) => x.types))].join(", ").toLowerCase() + ". Пара подсвечена красным, причина — в окне пары" : "Сохранено");
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
    `<section class="view"><h2 class="ttl">Настройки</h2><div class="card"><h3>Оформление</h3><div class="seg theme-seg">${[["light", "Светлая"], ["dark", "Тёмная"], ["auto", "Как в системе"]].map(([v, t]) => `<button data-theme-set="${v}" aria-pressed="${Theme.get() === v}">${t}</button>`).join("")}</div></div><details class="card tech"><summary>Для настройщика: отделение и корпуса</summary><h3>Отделение в работе</h3><p class="hint">Смотреть и править можно только группы этого отделения. Остальные группы файла не показываются и не меняются, но учитываются при проверке кабинетов и преподавателей. Шаблон «-(Д|БС)$» означает группы, оканчивающиеся на -Д и -БС. Если очистить шаблон, будет весь техникум.</p><label class="field">Название<input class="inp" id="scope-name" value="${esc(Model.withDefaults(state.settings).scopeName)}"></label><label class="field">Шаблон групп<input class="inp" id="scope-pattern" value="${esc(Model.withDefaults(state.settings).scopePattern)}"></label><h3>Корпус по номеру кабинета</h3><p class="hint">Сейчас корпус — первая цифра номера кабинета. Этаж не вычисляется, «1 этаж» (спортзал) остаётся текстом.</p><label class="field">Правило<input class="inp" id="pattern" value="${esc(state.settings.roomPattern)}"></label><label class="field">Номер части<input class="inp" id="capture" type="number" min="1" value="${state.settings.roomGroup}"></label><p class="hint">Изменения сохраняются кнопкой «Сохранить настройки» ниже.</p></details><div class="card"><h3>Звонки</h3><p class="hint">По расписанию звонков техникума. Каждая строка — одна пара: начало–конец.</p><div class="bells">${[
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
  document.querySelectorAll("[data-theme-set]").forEach(
    (b) =>
      (b.onclick = () => {
        Theme.set(b.dataset.themeSet);
        render();
      }),
  );
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
    `<section class="view"><h2 class="ttl">Как пользоваться</h2><div class="card"><ol class="steps"><li><div><b>Загрузите файл.</b> Нажмите «Загрузить файл» и выберите Excel недели (.xlsx) из программы учебной части. Программа сама найдёт нужные группы (${esc(scopeName())}). Если с файлом что-то не так (мало групп, нет дней), вверху появится предупреждение.</div></li><li><div><b>Найдите нужное.</b> Начните вводить группу, фамилию или кабинет в строку поиска и нажмите подсказку, либо выберите в списках группу, преподавателя, кабинет, корпус или день. Кнопки дней «Пн», «Вт», «Ср» … над расписанием показывают один день у всех групп, «Вся неделя» — снова всю неделю. «Сегодня» и «Завтра» сразу показывают нужный день, «Сбросить фильтры» — всю неделю.</div></li><li><div><b>Поправьте пару.</b> Нажмите на пару: можно сменить преподавателя или кабинет — нажмите на поле или на ▾, откроется весь список с пометкой «свободен» или «занят», или впишите любую фамилию или кабинет сами. Если будет пересечение, программа скажет об этом, но сохранить всё равно можно. Под кабинетом видно, что это за кабинет и свободен ли он. Можно написать комментарий, перенести пару на свободное место или поменять местами с другой. Пары можно и просто перетаскивать мышкой.</div></li><li><div><b>Добавьте пару.</b> Кнопка «+ Добавить пару» ставит новую пару в пустую клетку: выберите группу, день, номер пары, всю группу или подгруппу, дисциплину, преподавателя и кабинет. Программа сразу скажет, нет ли пересечений. В Excel новая пара будет оформлена так же, как остальные.</div></li><li><div><b>Преподаватель заболел.</b> В окне пары — «Снять пару (окно)». В «Сервисе» → «Замена преподавателя» можно назначить замену (★ — ведёт тот же предмет) или поставить окно сразу на все его пары за день.</div></li><li><div><b>Следите за красным.</b> Красным выделены конфликты: группа, преподаватель или кабинет в двух местах одновременно. Под красной парой написано, почему она красная (например, «кабинет 3108 в это время занят группой 24-БС») и что сделать. Все такие пары собраны в списке «Почему есть красные пары» над расписанием. В окне пары есть подсказки «Как исправить»: свободные кабинеты, свободные преподаватели и свободное время. Если две группы на самом деле занимаются вместе (сдвоенная пара), нажмите «Сдвоенная — не конфликт»: пара перестанет быть красной, на ней появится отметка «Сдвоенная с …». Ошибку можно отменить кнопкой «Отменить» или Ctrl+Z.</div></li><li><div><b>Скачайте Excel.</b> После правок нажмите зелёную кнопку «⬇ Скачать Excel» вверху (пока правки не скачаны, она зелёная и мигает). Она скачивает тот же файл, что вы загрузили: те же листы и оформление, изменены только поправленные пары. Если после правок есть конфликты, программа спросит «Вы уверены?». Пока правки не скачаны, вверху висит напоминание.</div></li><li><div><b>Сервис.</b> Список всех правок с кнопкой «Вернуть», занятость любого кабинета на неделю, нагрузка преподавателей, окна у групп и лист преподавателя на неделю — его можно распечатать или сохранить в PDF и отдать преподавателю.</div></li><li><div><b>Таблица.</b> Переключатель «Карточки / Таблица» над расписанием. В таблице, как в Excel учебной части, строки — дни и пары, столбцы — группы. Нажмите на пару, чтобы её поправить, или на «+» в пустой клетке, чтобы добавить пару.</div></li><li><div><b>Кто свободен и массовые правки.</b> В «Сервисе»: «Кто свободен» показывает на выбранные день и пару свободных преподавателей и кабинеты. «Массовые правки» меняют сразу много пар: заменить преподавателя на неделю или день, перевести группу в другой кабинет.</div></li><li><div><b>Цвета и тема.</b> Цвет полоски слева на паре — корпус: синий — 1, зелёный — 2, оранжевый — 3, фиолетовый — спортзал и другое. Тему меняет кнопка с луной или солнцем вверху, а в «Настройках» можно выбрать «Как в системе».</div></li><li><div><b>Печать.</b> Выберите группу, преподавателя или кабинет и нажмите «Печать / PDF». В окне печати выберите А4 или «Сохранить как PDF».</div></li></ol></div><div class="card"><h3>Важно знать</h3><ul class="help-notes"><li>Файл никуда не отправляется: всё работает в браузере на этом компьютере.</li><li>Если вкладку закрыли, при следующем открытии нажмите «Продолжить» — правки на месте.</li><li>Если программой пользуются несколько человек, у каждого свой экземпляр: правки одного не видны другим. Одну неделю лучше править одному человеку и пересылать скачанный Excel.</li><li>Не открывайте программу в двух вкладках одного браузера одновременно — программа об этом предупредит.</li><li>Галочка «Работа со всеми отделениями» — бета-тестирование для остальных отделений.</li></ul></div></section>`;
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
      next.combined = [];
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
  const x = state.lessons.find((l) => l.id === a),
    y = state.lessons.find((l) => l.id === b);
  if (x && y && x.date === y.date && x.period === y.period) {
    ui.moving = null;
    render();
    notify(
      "Эти пары идут в одно и то же время, поэтому при обмене ничего не меняется. Чтобы поменять преподавателя или кабинет, нажмите на пару и выберите их в списке.",
    );
    return false;
  }
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
    if (exchange(a, card.dataset.lesson) !== false) notify("Пары обменены." + (Tools.unsaved(state) ? " Не забудьте скачать Excel — кнопка «Скачать Excel» стала зелёной." : ""));
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
              `<li><b>${esc(x.l.groups.join(", "))}</b>: ${x.b.isNew ? "новая пара → " : `<s>${esc(fmt(x.b))}</s> → `}${esc(fmt(x.l))} <button class="btn small revert" data-id="${esc(x.l.id)}">Вернуть</button>${notes[x.l.id] ? `<br><span class="hint">💬 ${esc(notes[x.l.id])}</span>` : ""}</li>`,
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
    .join("")}</tbody></table></div></div>${whoFreeCard(dates)}${massCard(teachers, dates)}${teacherSheetCard(teachers)}${groupWindowsCard()}</section>`;
  bindTeacherSheet();
  bindWhoFree();
  bindMass();

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


/* Новая пара в пустую клетку */
function addPair(pre = {}) {
  const groups = list("group");
  const g0 = pre.group || ui.filters.group || groups[0];
  const dates = [...new Set([...(state.dates || []), ...state.lessons.map((l) => l.date)])].sort();
  const d0 = pre.date || ui.filters.date || dates.find((d) => Tools.dayOf(d) !== 0) || dates[0];
  const periodsOf = (g, d) => {
    const slot = state.layout && state.layout[d + "|" + g];
    const fromFile = slot ? Object.keys(slot.rows).filter((k) => k !== "before").map(Number) : [];
    return fromFile.length ? fromFile.sort((a, b) => a - b) : [1, 2, 3, 4, 5];
  };
  const subjects = [...new Set(state.lessons.filter((l) => l.groups.includes(g0)).map((l) => l.subject))].sort((a, b) => a.localeCompare(b, "ru"));
  const opt = (v, cur, label) => `<option value="${esc(v)}" ${String(v) === String(cur) ? "selected" : ""}>${esc(label ?? v)}</option>`;
  const dayName = (d) => new Date(d + "T12:00:00").toLocaleDateString("ru", { weekday: "long" }) + ", " + dm(d);
  $("sheet").innerHTML = `<h3>Новая пара</h3><p class="hint">Пара встанет в пустую клетку расписания. В скачанном Excel она будет оформлена так же, как остальные.</p>
  <label class="field">Группа<select class="inp" id="np-group">${groups.map((g) => opt(g, g0)).join("")}</select></label>
  <label class="field">День<select class="inp" id="np-date">${dates.filter((d) => Tools.dayOf(d) !== 0).map((d) => opt(d, d0, dayName(d))).join("")}</select></label>
  <label class="field">Пара<select class="inp" id="np-period"></select></label>
  <label class="field">Кто занимается<select class="inp" id="np-sub">${opt(0, pre.subgroup || 0, "Вся группа")}${opt(1, pre.subgroup, "1 подгруппа")}${opt(2, pre.subgroup, "2 подгруппа")}</select></label>
  <label class="field">Дисциплина<input class="inp" id="np-subject" list="np-subjects" placeholder="например, Математика"></label><datalist id="np-subjects">${subjects.map((x) => `<option value="${esc(x)}">`).join("")}</datalist>
  <label class="field">Преподаватель<input class="inp" id="np-teacher" list="teachers"></label><datalist id="teachers">${list("teacher").map((t) => `<option value="${esc(t)}">`).join("")}</datalist>
  <label class="field">Кабинет<input class="inp" id="np-room" list="rooms"></label><datalist id="rooms">${[...new Set([...state.rooms, ...state.lessons.map((l) => l.room)])].filter(Boolean).sort((a, b) => a.localeCompare(b, "ru", { numeric: true })).map((t) => `<option value="${esc(t)}">${esc(Model.roomInfo(t)?.name || "")}</option>`).join("")}</datalist>
  <label class="field">Комментарий<input class="inp" id="np-note" maxlength="200" placeholder="например, замена за Петрова"></label>
  <div id="np-check" role="status"></div>
  <div class="actions"><button class="btn blue" id="np-save">Добавить</button><button class="btn" id="np-close">Отмена</button></div>`;
  $("scrim").hidden = false;
  requestAnimationFrame(() => $("scrim").classList.add("open"));
  const fillPeriods = () => {
    const g = $("np-group").value, d = $("np-date").value, cur = $("np-period").value || pre.period || "";
    $("np-period").innerHTML = periodsOf(g, d)
      .map((p) => {
        const busy = state.lessons.filter((l) => !l.cancelled && l.groups.includes(g) && l.date === d && l.period === p);
        return opt(p, cur, `${p} пара${busy.length ? " — занято: " + busy.map((l) => (l.subgroup ? l.subgroup + " подгр. " : "") + l.subject).join(", ") : " — свободно"}`);
      })
      .join("");
    if (!cur) {
      const free = [...$("np-period").options].find((o) => o.textContent.includes("свободно"));
      if (free) $("np-period").value = free.value;
    }
  };
  const draft = () => ({
    id: "add-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date: $("np-date").value,
    period: Number($("np-period").value),
    groups: [$("np-group").value],
    subgroup: Number($("np-sub").value),
    subject: $("np-subject").value.trim(),
    teacher: $("np-teacher").value.trim(),
    room: $("np-room").value.trim(),
    start: "",
    end: "",
    added: true,
  });
  const check = () => {
    const l = draft();
    const ls = [...state.lessons, l];
    const conf = Model.conflicts(ls, state.settings).filter((c) => c.ids.includes(l.id) && notCombined(c));
    const why = conflictReasons(l, conf, ls, 90);
    const info = l.room ? Model.roomInfo(l.room) : null;
    $("np-check").innerHTML =
      (info ? `<p class="hint">Кабинет: ${esc(info.name)}, корпус ${esc(info.building)}${info.owner ? ", заведует " + esc(info.owner) : ""}</p>` : "") +
      (why.length
        ? `<p><b>Будет пересечение:</b></p><ul class="why-list">${why.map((x) => `<li>${esc(x.text)}</li>`).join("")}</ul><p class="hint">Добавить можно, пара будет красной. Лучше выбрать другое время, кабинет или преподавателя.</p>`
        : "<p>Пересечений нет — группа, преподаватель и кабинет свободны.</p>");
  };
  fillPeriods();
  check();
  $("np-group").onchange = () => { fillPeriods(); check(); };
  $("np-date").onchange = () => { fillPeriods(); check(); };
  for (const id of ["np-period", "np-sub", "np-subject", "np-teacher", "np-room"]) $(id).oninput = $(id).onchange = check;
  $("np-close").onclick = close;
  $("np-save").onclick = () => {
    const l = draft(), note = $("np-note").value.trim();
    if (!l.subject) return notify("Укажите дисциплину");
    close();
    commit(() => {
      state.lessons.push(l);
      if (l.room && !state.rooms.includes(l.room)) state.rooms.push(l.room);
      if (note) (state.notes = state.notes || {})[l.id] = note;
    });
    notify(`Добавлена пара: ${l.groups[0]}, ${dm(l.date)}, ${l.period} пара — ${l.subject}`);
  };
  $("np-subject").focus();
}


/* Лист преподавателя на неделю: все его пары (по всему файлу), с заменами, окнами и переносами */
function teacherRows(t) {
  const base = new Map(state.baseline.map((b) => [b.id, b]));
  const low = (x) => String(x || "").trim().toLowerCase();
  return state.lessons
    .filter((l) => low(l.teacher) === low(t) || low(base.get(l.id)?.teacher) === low(t))
    .map((l) => {
      const b = base.get(l.id);
      const marks = [];
      if (l.added) marks.push("новая пара");
      if (l.cancelled) marks.push("пара снята (окно)");
      else if (b && low(b.teacher) === low(t) && low(l.teacher) !== low(t)) marks.push("замена: ведёт " + (l.teacher || "—"));
      else if (b && low(b.teacher) !== low(t)) marks.push("замена вместо " + (b.teacher || "—"));
      if (b && (b.date !== l.date || b.period !== l.period)) marks.push(`перенесена с ${dm(b.date)}, ${pairName(b.period)}`);
      if (b && b.room !== l.room && !l.cancelled) marks.push(`кабинет был ${b.room || "—"}`);
      const n = (state.notes || {})[l.id];
      if (n) marks.push("💬 " + n);
      return { l, marks, away: (l.cancelled || (b && low(b.teacher) === low(t) && low(l.teacher) !== low(t))) };
    })
    .sort((a, b) => a.l.date.localeCompare(b.l.date) || (a.l.period ?? -1) - (b.l.period ?? -1));
}
function teacherSheetCard(teachers) {
  const t = ui.svc.sheetTeacher || "";
  const rows = t ? teacherRows(t) : [];
  const dates = [...new Set([...(state.dates || []), ...state.lessons.map((l) => l.date)])].sort();
  const range = dates.length ? dm(dates[0]) + "–" + dm(dates[dates.length - 1]) : "";
  const real = rows.filter((r) => !r.away && r.l.period !== null);
  return `<div class="card teacher-sheet-card"><h3>Лист преподавателя на неделю</h3><p class="hint">Все пары преподавателя за неделю (по всем отделениям) с заменами, окнами и переносами — чтобы распечатать или сохранить в PDF и отдать ему.</p><div class="tools"><label class="filter">Преподаватель<select class="inp" id="ts-teacher"><option value="">Выберите</option>${teachers
    .map((x) => `<option ${x === t ? "selected" : ""}>${esc(x)}</option>`)
    .join("")}</select></label>${t ? '<button class="btn blue" id="ts-print">Печать / PDF</button>' : ""}</div>${
    t
      ? `<div class="teacher-sheet"><div class="ts-head"><img src="assets/logo.svg" alt="" width="40" height="40"><div><b>${esc(t)}</b><br><span>КузТАГиС · расписание на неделю ${esc(range)} · пар: ${real.length}</span></div></div><table><thead><tr><th>День</th><th>Пара</th><th>Время</th><th>Группа</th><th>Дисциплина</th><th>Ауд.</th><th>Отметки</th></tr></thead><tbody>${
          rows.length
            ? rows
                .map(
                  ({ l, marks, away }) =>
                    `<tr class="${away ? "away" : ""}"><td>${esc(Tools.DAY[Tools.dayOf(l.date)] + " " + dm(l.date))}</td><td>${l.period ?? "—"}</td><td>${esc(time(l))}</td><td>${esc(l.groups.join(", ") + (l.subgroup ? " (" + l.subgroup + " подгр.)" : ""))}</td><td>${esc(l.subject)}</td><td>${esc(l.room || "")}</td><td>${esc(marks.join("; "))}</td></tr>`,
                )
                .join("")
            : '<tr><td colspan="7">Пар нет</td></tr>'
        }</tbody></table></div>`
      : ""
  }</div>`;
}
function bindTeacherSheet() {
  $("ts-teacher").onchange = (e) => {
    ui.svc.sheetTeacher = e.target.value;
    render();
  };
  if ($("ts-print"))
    $("ts-print").onclick = () => {
      document.body.classList.add("print-teacher");
      const done = () => {
        document.body.classList.remove("print-teacher");
        removeEventListener("afterprint", done);
      };
      addEventListener("afterprint", done);
      window.print();
      setTimeout(done, 1500);
    };
}
function groupWindowsCard() {
  const groups = list("group");
  const w = Tools.groupWindows({ ...state, lessons: state.lessons }, groups);
  return `<div class="card"><h3>Окна у групп (${w.length})</h3>${
    w.length
      ? `<p class="hint">Пустая пара посреди дня у группы: перед ней и после неё есть занятия.</p><ul class="changes">${w
          .map((x) => `<li><b>${esc(x.g)}</b>: ${esc(Tools.DAY[Tools.dayOf(x.d)] + " " + dm(x.d))}, окно на ${x.p} паре</li>`)
          .join("")}</ul>`
      : '<p class="hint">Окон у групп нет.</p>'
  }</div>`;
}


/* ---------- Таблица: строки — день и пара, столбцы — группы (как в Excel учебной части) ---------- */
function tableView(dates) {
  const groups = [...new Set(visible.flatMap((l) => l.groups))].sort((a, b) => a.localeCompare(b, "ru", { numeric: true }));
  if (!groups.length) return '<p class="hint">Нет занятий по выбранным фильтрам</p>';
  const days = dates.filter((d) => ui.filters.date || visible.some((x) => x.date === d));
  const mini = (l) => {
    const bad = analysis.some((c) => c.ids.includes(l.id));
    const why = bad ? conflictReasons(l) : [];
    if (l.cancelled)
      return `<button class="les mini off" data-lesson="${esc(l.id)}"><span class="s">Окно</span><span class="m"><s>${esc(l.subject)}</s></span></button>`;
    return `<button class="les mini ${bad ? "bad" : ""}" style="--h:${hueOf(l)}" data-lesson="${esc(l.id)}" ${why.length ? `title="${esc(why.map((x) => x.text).join("\n"))}"` : ""}>${l.subgroup ? `<span class="sg">${l.subgroup} подгр.</span>` : ""}<span class="s">${esc(l.subject)}</span><span class="m">${esc(l.teacher || "")}${l.room ? " · " + esc(l.room) : ""}</span>${l.added ? '<span class="dot new" title="Новая пара"></span>' : Model.changed(l, state.baseline) ? '<span class="dot ch" title="Изменено"></span>' : ""}${(state.notes || {})[l.id] ? `<span class="dot nt" title="${esc(state.notes[l.id])}">💬</span>` : ""}</button>`;
  };
  const rows = [];
  for (const d of days) {
    const ps = [...new Set(state.lessons.filter((l) => l.date === d && l.groups.some((g) => groups.includes(g))).map((l) => l.period))].sort(
      (a, b) => (a ?? -1) - (b ?? -1),
    );
    const max = Math.max(5, ...ps.filter((p) => p !== null));
    const periods = [...(ps.includes(null) ? [null] : []), ...Array.from({ length: max }, (_, i) => i + 1)];
    periods.forEach((p, i) => {
      const t = Model.times({ date: d, period: p }, state.settings);
      rows.push(
        `<tr class="${i === 0 ? "day-start" : ""}">${i === 0 ? `<th class="tv-day" rowspan="${periods.length}"><span>${esc(new Date(d + "T12:00:00").toLocaleDateString("ru", { weekday: "long" }))}</span><small>${esc(dm(d))}</small></th>` : ""}<th class="tv-p">${p === null ? "До 1-й" : p}<small>${t ? esc(t.join("–")) : ""}</small></th>${groups
          .map((g) => {
            const here = visible.filter((l) => l.date === d && l.period === p && l.groups.includes(g)).sort((a, b) => a.subgroup - b.subgroup);
            return `<td>${here.map(mini).join("") || (p === null ? "" : `<button class="tv-empty" data-g="${esc(g)}" data-d="${esc(d)}" data-p="${p}" title="Добавить пару">+</button>`)}</td>`;
          })
          .join("")}</tr>`,
      );
    });
  }
  return `<div class="tv-wrap"><table class="tv"><thead><tr><th class="tv-day">День</th><th class="tv-p">Пара</th>${groups
    .map((g) => `<th>${esc(g)}</th>`)
    .join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

/* ---------- Кто свободен: преподаватели и кабинеты на выбранные день и пару ---------- */
function whoFreeCard(dates) {
  const s = ui.svc;
  const days = dates.filter((d) => Tools.dayOf(d) !== 0);
  s.freeDate = s.freeDate && days.includes(s.freeDate) ? s.freeDate : Tools.dayFilter(state, 0) || days[0];
  s.freePeriod = s.freePeriod || 1;
  const probe = { id: "probe", date: s.freeDate, period: Number(s.freePeriod), groups: [], subgroup: 0 };
  const busyNow = state.lessons.filter((l) => !l.cancelled && Model.overlaps(l, probe, state.settings));
  const low = (x) => String(x || "").trim().toLowerCase();
  const busyT = new Set(busyNow.map((l) => low(l.teacher)));
  const mine = new Set(state.lessons.filter(scope).map((l) => low(l.teacher)));
  const subj = {};
  for (const l of state.lessons) if (l.teacher) (subj[l.teacher] = subj[l.teacher] || new Set()).add(l.subject);
  const teachers = list("teacher").length ? [...new Set(state.lessons.map((l) => l.teacher).filter(Boolean))] : [];
  const freeT = teachers
    .filter((t) => !busyT.has(low(t)))
    .sort((a, b) => Number(mine.has(low(b))) - Number(mine.has(low(a))) || a.localeCompare(b, "ru"));
  const shared = new Set(Model.withDefaults(state.settings).sharedRooms.map(low));
  const busyR = new Set(busyNow.map((l) => low(l.room)));
  const freeR = [...new Set([...state.rooms, ...state.lessons.map((l) => l.room)])]
    .filter((r) => r && !shared.has(low(r)) && !busyR.has(low(r)))
    .sort((a, b) => a.localeCompare(b, "ru", { numeric: true }));
  const dayName = (d) => new Date(d + "T12:00:00").toLocaleDateString("ru", { weekday: "long" }) + ", " + dm(d);
  const byB = {};
  for (const r of freeR) (byB[Model.building(r, state.settings) || "—"] = byB[Model.building(r, state.settings) || "—"] || []).push(r);
  return `<div class="card"><h3>Кто свободен</h3><p class="hint">Выберите день и пару — программа покажет преподавателей без пар в это время (сначала те, кто ведёт у Дорожного) и свободные кабинеты по корпусам.</p><div class="tools"><label class="filter">День<select class="inp" id="wf-date">${days
    .map((d) => `<option value="${esc(d)}" ${d === s.freeDate ? "selected" : ""}>${esc(dayName(d))}</option>`)
    .join("")}</select></label><label class="filter">Пара<select class="inp" id="wf-period">${[1, 2, 3, 4, 5, 6]
    .map((p) => `<option ${p === Number(s.freePeriod) ? "selected" : ""}>${p}</option>`)
    .join("")}</select></label></div><div class="wf-cols"><div><p><b>Свободные преподаватели: ${freeT.length}</b></p><ul class="wf-list">${freeT
    .map((t) => `<li><b>${esc(t)}</b>${mine.has(low(t)) ? ' <span class="tag mv">Дорожное</span>' : ""}<br><span class="hint">${esc([...(subj[t] || [])].slice(0, 3).join("; "))}</span></li>`)
    .join("")}</ul></div><div><p><b>Свободные кабинеты: ${freeR.length}</b></p>${Object.keys(byB)
    .sort()
    .map(
      (b) =>
        `<p class="hint">${b === "—" ? "Без корпуса" : "Корпус " + esc(b)}</p><div class="chips">${byB[b]
          .map((r) => `<span class="chip" title="${esc(Model.roomInfo(r)?.name || "")}">${esc(r)}</span>`)
          .join("")}</div>`,
    )
    .join("")}</div></div></div>`;
}
function bindWhoFree() {
  $("wf-date").onchange = (e) => {
    ui.svc.freeDate = e.target.value;
    render();
  };
  $("wf-period").onchange = (e) => {
    ui.svc.freePeriod = Number(e.target.value);
    render();
  };
}

/* ---------- Массовые правки: замена преподавателя и смена кабинета сразу у многих пар ---------- */
function massCard(teachers, dates) {
  const m = (ui.svc.mass = ui.svc.mass || {});
  const dayName = (d) => new Date(d + "T12:00:00").toLocaleDateString("ru", { weekday: "short" }) + " " + dm(d);
  const days = dates.filter((d) => Tools.dayOf(d) !== 0);
  const groups = list("group");
  const rooms = [...new Set([...state.rooms, ...state.lessons.map((l) => l.room)])].filter(Boolean).sort((a, b) => a.localeCompare(b, "ru", { numeric: true }));
  const opt = (v, cur, t) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(t ?? v)}</option>`;
  const nT = massTeacherTargets().length,
    nR = massRoomTargets().length;
  return `<div class="card"><h3>Массовые правки</h3><p class="hint">Меняет сразу много пар Дорожного. Перед заменой видно, сколько пар изменится; отменить можно кнопкой «Отменить» или в списке правок.</p>
  <div class="mass-block"><p><b>Заменить преподавателя</b> — например, «все пары Петрова на этой неделе ведёт Иванов»</p><div class="tools"><label class="filter">Кого<select class="inp" id="mt-from"><option value="">Выберите</option>${teachers.map((t) => opt(t, m.tFrom)).join("")}</select></label><label class="filter">На кого<input class="inp" id="mt-to" list="teachers" value="${esc(m.tTo || "")}"></label><datalist id="teachers">${list("teacher").map((t) => `<option value="${esc(t)}">`).join("")}</datalist><label class="filter">Когда<select class="inp" id="mt-day"><option value="">Вся неделя</option>${days.map((d) => opt(d, m.tDay, dayName(d))).join("")}</select></label><label class="filter">Группа<select class="inp" id="mt-group"><option value="">Все группы</option>${groups.map((g) => opt(g, m.tGroup)).join("")}</select></label></div><button class="btn blue" id="mt-apply" ${nT && m.tTo ? "" : "disabled"}>Заменить у ${nT} ${plural(nT, "пары", "пар", "пар")}</button></div>
  <div class="mass-block"><p><b>Сменить кабинет</b> — например, «вся группа 23-БС в среду переезжает из 3108 в 3107»</p><div class="tools"><label class="filter">Группа<select class="inp" id="mr-group"><option value="">Все группы</option>${groups.map((g) => opt(g, m.rGroup)).join("")}</select></label><label class="filter">Когда<select class="inp" id="mr-day"><option value="">Вся неделя</option>${days.map((d) => opt(d, m.rDay, dayName(d))).join("")}</select></label><label class="filter">Из кабинета<select class="inp" id="mr-from"><option value="">Любой</option>${rooms.map((r) => opt(r, m.rFrom)).join("")}</select></label><label class="filter">В кабинет<input class="inp" id="mr-to" list="rooms-m" value="${esc(m.rTo || "")}"></label><datalist id="rooms-m">${rooms.map((r) => `<option value="${esc(r)}">${esc(Model.roomInfo(r)?.name || "")}</option>`).join("")}</datalist></div><button class="btn blue" id="mr-apply" ${nR && m.rTo && (m.rGroup || m.rFrom) ? "" : "disabled"}>Сменить у ${nR} ${plural(nR, "пары", "пар", "пар")}</button><p class="hint">Нужно выбрать группу или «из кабинета», чтобы случайно не поменять кабинет у всего отделения.</p></div></div>`;
}
function massTeacherTargets() {
  const m = ui.svc.mass || {};
  if (!m.tFrom) return [];
  return state.lessons.filter(
    (l) => scope(l) && !l.cancelled && l.teacher === m.tFrom && (!m.tDay || l.date === m.tDay) && (!m.tGroup || l.groups.includes(m.tGroup)),
  );
}
function massRoomTargets() {
  const m = ui.svc.mass || {};
  if (!m.rGroup && !m.rFrom) return [];
  return state.lessons.filter(
    (l) => scope(l) && !l.cancelled && (!m.rGroup || l.groups.includes(m.rGroup)) && (!m.rDay || l.date === m.rDay) && (!m.rFrom || l.room === m.rFrom),
  );
}
function bindMass() {
  const m = ui.svc.mass;
  const keep = (id, k, re) =>
    ($(id).onchange = (e) => {
      m[k] = e.target.value.trim();
      if (re) render();
      else {
        const t = massTeacherTargets().length, r = massRoomTargets().length;
        $("mt-apply").disabled = !(t && m.tTo);
        $("mt-apply").textContent = `Заменить у ${t} ${plural(t, "пары", "пар", "пар")}`;
        $("mr-apply").disabled = !(r && m.rTo && (m.rGroup || m.rFrom));
        $("mr-apply").textContent = `Сменить у ${r} ${plural(r, "пары", "пар", "пар")}`;
      }
    });
  keep("mt-from", "tFrom", true);
  keep("mt-day", "tDay", true);
  keep("mt-group", "tGroup", true);
  keep("mr-group", "rGroup", true);
  keep("mr-day", "rDay", true);
  keep("mr-from", "rFrom", true);
  $("mt-to").oninput = $("mt-to").onchange = (e) => {
    m.tTo = e.target.value.trim();
    $("mt-apply").disabled = !(massTeacherTargets().length && m.tTo);
  };
  $("mr-to").oninput = $("mr-to").onchange = (e) => {
    m.rTo = e.target.value.trim();
    $("mr-apply").disabled = !(massRoomTargets().length && m.rTo && (m.rGroup || m.rFrom));
  };
  $("mt-apply").onclick = () => {
    const ls = massTeacherTargets(), to = m.tTo;
    commit(() =>
      ls.forEach((l) => {
        l.teacher = to;
        (state.notes = state.notes || {})[l.id] = state.notes[l.id] || `Замена: ${m.tFrom} → ${to}`;
      }),
    );
    notify(`Заменено у ${ls.length} ${plural(ls.length, "пары", "пар", "пар")}: ${m.tFrom} → ${to}`);
  };
  $("mr-apply").onclick = () => {
    const ls = massRoomTargets(), to = m.rTo;
    commit(() => {
      ls.forEach((l) => (l.room = to));
      if (!state.rooms.includes(to)) state.rooms.push(to);
    });
    notify(`Кабинет сменён у ${ls.length} ${plural(ls.length, "пары", "пар", "пар")} → ${to}`);
  };
}

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
/* Каждый запуск — только своё отделение; все отделения включаются галочкой вручную. */
for (const s of [state, saved]) if (s?.settings) s.settings.allDepartments = false;
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
function originals() {
  try {
    return JSON.parse(localStorage.getItem(ORIG_KEY)) || {};
  } catch {
    return {};
  }
}
function keepOriginal(name, u8) {
  const all = originals();
  delete all[name];
  all[name] = toB64(u8);
  const names = Object.keys(all);
  while (names.length > 1) delete all[names.shift()];
  try {
    localStorage.setItem(ORIG_KEY, JSON.stringify(all));
  } catch {
    notify("Исходный файл не поместился в память браузера: Excel будет выгружен таблицей.");
  }
}
function originalFor(name) {
  const b = originals()[name];
  return b ? fromB64(b) : null;
}
let visible = [],
  analysis = [];
function notify(s) {
  $("message").textContent = s;
  setTimeout(() => ($("message").textContent = ""), 7000);
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
function card(l) {
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
  return `<button class="les ${conflicts.length ? "bad" : ""} ${ui.moving === l.id ? "selected" : ""}" style="--h:211" data-lesson="${esc(l.id)}"><span class="s">${esc(l.subject)}</span><span class="m">${esc(l.groups.join(", "))}${l.subgroup ? " · " + l.subgroup + " подгр." : ""}</span><span class="m">${esc(l.teacher || "Преподаватель не указан")}</span><span class="m">${esc(l.room ? "Ауд. " + l.room : "Кабинет не указан")}${Model.building(l.room, state.settings) ? " · корпус " + Model.building(l.room, state.settings) : ""}</span><span class="tags">${Model.changed(l, state.baseline) ? '<span class="tag mv">Изменено</span>' : ""}${same ? '<span class="tag db">Последовательные пары</span>' : ""}${conflicts.length ? `<span class="tag bd">${esc([...new Set(conflicts.flatMap((c) => c.types))].join(", "))}</span>` : ""}</span></button>`;
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
  document.querySelectorAll(".les.bad").forEach((el, i) => {
    if (i < 20 && !oldBad.has(el.dataset.lesson))
      Motion.play(el, [
        { transform: "scale(1)", opacity: 1 },
        { transform: "scale(1.015)", opacity: 0.8 },
        { transform: "scale(1)", opacity: 1 },
      ]);
  });
}
function welcome() {
  visible = [];
  const changed = saved
    ? saved.lessons.filter((l) => Model.changed(l, saved.baseline)).length
    : 0;
  $("main").innerHTML =
    `<section class="view"><div class="card empty-start"><h2 class="ttl">Загрузите расписание</h2><p>Выберите Excel-файл недели (.xlsx), который выдаёт программа учебной части. Программа сама найдёт группы <b>${esc(scopeName())}</b> (${esc(Model.withDefaults(state.settings).allDepartments || !Model.withDefaults(state.settings).scopePattern ? "все группы" : "группы -Д и -БС")}): их можно смотреть по группам, преподавателям, кабинетам и корпусам, менять пары и скачать тот же файл с правками. Остальные отделения в файле не трогаются.</p><div class="actions"><button class="btn blue" id="start-import">Загрузить файл</button>${saved ? `<button class="btn" id="resume">Продолжить: ${esc(saved.source)}${changed ? " · изменено " + changed : ""}</button>` : ""}</div>${betaToggle()}<p class="hint">Файл никуда не отправляется, всё работает прямо на этом компьютере.</p></div></section>`;
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
    `<section class="view"><div class="notice blue"><p><b>${esc(state.source)}</b><br>${summary}</p></div><div class="tools"><label class="search global"><input id="search" placeholder="Группа, фамилия, кабинет, корпус, специальность…" value="${esc(ui.q)}" autocomplete="off" aria-label="Общий поиск"></label><button class="btn" id="reset">Сбросить фильтры</button></div>${betaToggle()}<div id="suggestions" class="chips wrapc"></div><div class="tools">${Object.entries(
      labels,
    )
      .map(([k, v]) => select(k, list(k), ui.filters[k], v))
      .join(
        "",
      )}${select("date", allDates, ui.filters.date, "День / вся неделя")}</div><div class="status"><span class="pill">Показано: ${visible.length}</span><span class="pill bad">Конфликтов: ${analysis.length}</span><span class="pill">Изменено: ${state.lessons.filter((l) => scope(l) && Model.changed(l, state.baseline)).length}</span></div>${ui.moving ? '<div class="notice blue"><p>Выберите вторую пару для обмена. Время занятий поменяется местами; каждое занятие подгруппы меняется отдельно.</p><button class="btn" id="cancel-move">Отмена обмена</button></div>' : ""}<details class="card"><summary>Отчёт загрузки: ${state.issues.length} замечаний</summary><p>Занятия с недостающими полями сохранены. Непрочитанные строки перечислены отдельно.</p>${state.issues.map((x) => `<p>${esc(x.where)}: ${esc(x.reason)} — ${esc(x.raw)}</p>`).join("") || "<p>Замечаний нет.</p>"}</details><div class="print-title"><h2>КузТАГиС · расписание</h2><p>${
      Object.entries(ui.filters)
        .filter(([, v]) => v)
        .map(([k, v]) => esc((labels[k] || "Дата") + ": " + v))
        .join(" · ") || scopeName()
    }</p></div><div class="week">${dates
      .map((date) => {
        const lessons = visible.filter((x) => x.date === date);
        const periods = [...new Set(lessons.map((x) => x.period))].sort(
          (a, b) => (a ?? -1) - (b ?? -1),
        );
        return `<div class="day"><div class="day-h"><b>${new Date(date + "T12:00:00").toLocaleDateString("ru", { weekday: "long" })}</b><span>${esc(date)}</span></div>${
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
          (l) => l.room === r && Model.overlaps(l, probe, state.settings),
        ),
    );
    $("free-result").textContent =
      rooms.join(", ") || "Свободных известных кабинетов нет";
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
  $("sheet").innerHTML =
    `<h3>${esc(l.subject)}</h3><p>${esc(l.groups.join(", "))} · ${esc(l.date)} · ${l.period ?? "перед первой парой"} ${l.subgroup ? "· " + l.subgroup + " подгр." : ""}</p><label class="field">Преподаватель<input class="inp" id="edit-teacher" list="teachers" value="${esc(l.teacher)}"></label><datalist id="teachers">${list(
      "teacher",
    )
      .map((t) => `<option value="${esc(t)}">`)
      .join(
        "",
      )}</datalist><label class="field">Кабинет<input class="inp" id="edit-room" list="rooms" value="${esc(l.room)}"></label><datalist id="rooms">${list(
      "room",
    )
      .map((t) => `<option value="${esc(t)}">`)
      .join(
        "",
      )}</datalist><p class="hint">В исходном файле: ${esc(old?.teacher)} · ${esc(old?.room)} · ${esc(old?.date)} · ${old?.period ?? "без номера"}</p><p id="edit-conflicts" role="status"></p><div class="actions"><button class="btn blue" id="edit-save">Сохранить</button><button class="btn" id="edit-swap">Обменять с другой парой</button><button class="btn" id="edit-close">Закрыть</button></div>`;
  $("scrim").hidden = false;
  requestAnimationFrame(() => $("scrim").classList.add("open"));
  const preview = () => {
    const ls = Model.copy(state.lessons),
      target = ls.find((x) => x.id === id);
    target.teacher = $("edit-teacher").value.trim();
    target.room = $("edit-room").value.trim();
    const conflicts = Model.conflicts(ls, state.settings).filter((x) =>
      x.ids.includes(id),
    );
    $("edit-conflicts").textContent = conflicts.length
      ? "Конфликты: " +
        [...new Set(conflicts.flatMap((x) => x.types))].join(", ") +
        ". После сохранения будут подсвечены."
      : "Конфликтов у этой пары нет.";
  };
  $("edit-room").oninput = preview;
  $("edit-teacher").oninput = preview;
  preview();
  $("edit-save").onclick = () => {
    const teacher = $("edit-teacher").value.trim(),
      room = $("edit-room").value.trim();
    close();
    commit(() => {
      l.teacher = teacher;
      l.room = room;
      if (room && !state.rooms.includes(room)) state.rooms.push(room);
    });
  };
  $("edit-swap").onclick = () => {
    close();
    ui.moving = id;
    render();
  };
  $("edit-close").onclick = close;
  $("edit-teacher").focus();
}
function refs() {
  const groups = list("group");
  $("main").innerHTML =
    `<section class="view"><h2 class="ttl">Справочник</h2><p class="sub">Неизвестные специальности и отделения оставлены пустыми. Изменения сохраняются на этом компьютере.</p><div class="card"><h3>Отделения</h3><p class="hint">Полное название Дорожного отделения: Строительство и эксплуатация автомобильных дорог, аэродромов и эксплуатация беспилотных авиационных систем.</p>${state.departments.map((d, i) => `<label class="field">Название<input class="inp department-name" data-index="${i}" value="${esc(d)}"></label>`).join("")}<button class="btn" id="add-department">Добавить отделение</button><button class="btn blue" id="save-departments">Сохранить названия</button></div><div class="tbl"><table><thead><tr><th>Группа</th><th>Специальность</th><th>Отделение</th></tr></thead><tbody>${groups.map((g, i) => `<tr><td>${esc(g)}</td><td><input aria-label="Специальность ${esc(g)}" class="inp specialty" data-group="${esc(g)}" value="${esc(state.catalog[g]?.specialty || "")}"></td><td><select aria-label="Отделение ${esc(g)}" class="inp group-dept" data-group="${esc(g)}"><option value="">Не указано</option>${state.departments.map((d) => `<option ${d === state.catalog[g]?.department ? "selected" : ""}>${esc(d)}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table></div><button class="btn blue" id="save-catalog">Сохранить справочник</button><div class="card"><h3>Известные кабинеты</h3><p class="hint">Один кабинет в строке. Добавьте полный список для проверки свободных кабинетов.</p><textarea class="inp" id="room-catalog" rows="6">${esc(list("room").join("\n"))}</textarea><button class="btn" id="save-rooms">Сохранить кабинеты</button></div></section>`;
  $("add-department").onclick = () => {
    const input = document.createElement("input");
    input.className = "inp department-name";
    input.placeholder = "Новое отделение";
    $("add-department").before(input);
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
    `<section class="view"><h2 class="ttl">Настройки</h2><div class="card"><h3>Отделение в работе</h3><p class="hint">Смотреть и править можно только группы этого отделения. Остальные группы файла не показываются и не меняются, но учитываются при проверке кабинетов и преподавателей. Шаблон «-(Д|БС)$» означает группы, оканчивающиеся на -Д и -БС. Если очистить шаблон, будет весь техникум.</p><label class="field">Название<input class="inp" id="scope-name" value="${esc(Model.withDefaults(state.settings).scopeName)}"></label><label class="field">Шаблон групп<input class="inp" id="scope-pattern" value="${esc(Model.withDefaults(state.settings).scopePattern)}"></label></div><div class="card"><h3>Корпус по номеру кабинета</h3><p class="hint">Регулярное выражение и номер группы захвата. Этаж не вычисляется. Текст «1 этаж» сохраняется без разбора.</p><input class="inp" id="pattern" value="${esc(state.settings.roomPattern)}"><input class="inp" id="capture" type="number" min="1" value="${state.settings.roomGroup}"></div><div class="card"><h3>Звонки</h3><p class="hint">Каждая строка: начало–конец, например 08:30–10:00. Число строк задаёт число пар.</p>${[
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
      )}<label class="field">Перед первой парой (понедельник, «Разговоры о важном»)<input class="inp" id="before" value="${state.settings.before.join("–")}"></label><button class="btn blue" id="save-settings">Сохранить настройки</button></div><div class="card"><h3>Правила конфликтов</h3><p class="hint">Не считаются конфликтом: потоки (один преподаватель, предмет и кабинет у нескольких групп) и «Разговор о важном» у нескольких групп в одном кабинете. Остальное настраивается здесь, сохраняется кнопкой «Сохранить настройки».</p><label class="filter">Общие помещения, где одновременно бывает много групп (спортзал), по одному в строке<textarea class="inp" id="shared-rooms" rows="3">${esc(Model.withDefaults(state.settings).sharedRooms.join("\n"))}</textarea></label><label class="filter">Занятия вне техникума: слово в названии (практика)<input class="inp" id="practice" value="${esc(Model.withDefaults(state.settings).practice)}"></label><label class="filter">Группы, которые пока не проверяются (временно, до выяснения)<textarea class="inp" id="ignore-groups" rows="2">${esc(Model.withDefaults(state.settings).ignoreGroups.join("\n"))}</textarea></label><button class="btn blue" id="save-rules">Сохранить правила</button></div><div class="card"><h3>Резервная копия</h3><p>Сохраняет расписание, оригинал, справочники и настройки. Можно перенести на другой компьютер.</p><button class="btn" id="backup">Скачать JSON</button><button class="btn" id="table-export">Excel-таблица текущей выборки</button><label class="btn">Восстановить JSON<input id="restore" type="file" accept=".json" hidden></label></div></section>`;
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
    `<section class="view"><h2 class="ttl">Как пользоваться</h2><div class="card"><ol class="steps"><li>Нажмите «Загрузить файл», выберите XLSX или CSV. Загрузка заменяет текущую неделю; её можно отменить. В отчёте проверьте замечания.</li><li>Введите группу, фамилию, кабинет, корпус, специальность или отделение в общий поиск и нажмите подсказку. Фильтры сочетаются. Выберите дату для просмотра дня.</li><li>Нажмите занятие, исправьте преподавателя или кабинет. Для обмена нажмите «Обменять с другой парой», затем выберите второе занятие. Подгруппы меняются отдельно, последовательные пары — каждая отдельно.</li><li>Красным отмечены пересечения группы, преподавателя или кабинета. Проверяется весь файл. Исходные конфликты тоже видны. Ошибочную правку отмените кнопкой или Ctrl+Z.</li><li>«Excel» скачивает тот же файл, что был загружен: те же листы, оформление и объединённые ячейки, меняются только исправленные пары. Плоская таблица текущей выборки — в «Настройках». Для печати выберите группу, преподавателя или кабинет и нажмите «Печать / PDF», в браузере выберите A4 и «Сохранить как PDF».</li><li>В справочнике заполните специальности и отделения, в настройках — точные звонки. Сохраните резервную копию JSON перед закрытием или переносом на другой компьютер.</li></ol><p>Программа работает без интернета, данные никуда не отправляются. При открытии программа пустая: загрузите файл недели. Незаконченную работу можно продолжить кнопкой на стартовом экране. CSV: UTF-8, разделитель «;» или запятая; столбцы: ${Reader.headers.join(", ")}. Дата ГГГГ-ММ-ДД, пустая пара — занятие до первой, подгруппа пустая/1/2, несколько групп разделяются |. Время можно оставить пустым — используются звонки.</p><p>В выгрузке нет полного перечня кабинетов: отсутствие занятия не гарантирует фактическую доступность. Неизвестное время отображается явно. Файлы фотографий не предоставлены; тестовые данные перенесены из Excel. Для загрузки без доработок используйте исходную матрицу с датой «Расписание на ДД.ММ.ГГГГ» в A1 и блоками групп B/H/N/T либо XLSX/CSV с перечисленными заголовками. Для адаптации нового вида пришлите 2–3 исходных Excel за разные недели с подгруппами и субботой; фото/PDF полезны только как дополнение.</p></div></section>`;
}
$("import").onclick = () => $("file").click();
$("file").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = await Reader.read(file);
    if (/\.xlsx$/i.test(file.name) && data.layout)
      keepOriginal(file.name, new Uint8Array(await file.arrayBuffer()));
    if (!data.lessons.length)
      throw Error("Не найдено занятий. Проверьте формат и дату листов.");
    commit(() => {
      const next = Model.initial(data);
      next.settings = state.settings;
      next.departments = state.departments;
      next.catalog = { ...next.catalog, ...state.catalog };
      next.rooms = [...new Set([...state.rooms, ...next.rooms])];
      state = next;
      ui.tab = "schedule";
      Object.keys(ui.filters).forEach((k) => (ui.filters[k] = ""));
    });
    const mine = data.lessons.filter(scope);
    if (!mine.length)
      notify(
        `Загружено ${data.lessons.length} занятий, но групп «${scopeName()}» в файле не найдено. Проверьте шаблон групп в «Настройках».`,
      );
    else
      notify(
        `Загружено: ${scopeName()} — ${mine.length} занятий, ${new Set(mine.flatMap((l) => l.groups)).size} групп. Замечаний по файлу: ${data.issues.length}`,
      );
  } catch (e) {
    notify("Не удалось загрузить: " + e.message);
  }
};
$("undo").onclick = undo;
$("export").onclick = async () => {
  if (!state.lessons.length) return notify("Сначала загрузите расписание");
  try {
    const bytes = originalFor(state.source);
    if (bytes) {
      const n = await Export.original(state, bytes, state.source);
      notify(
        n
          ? `Excel сохранён в исходном виде. Изменённых пар: ${n}`
          : "Excel сохранён: правок нет, файл совпадает с исходным",
      );
    } else {
      await Export.table(state.lessons.filter(matches), state);
      notify("Исходного файла нет (загружен CSV или таблица) — сохранена таблица");
    }
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
  return `<div class="print-table"><table><thead><tr><th>Дата / день</th><th>Пара / время</th><th>Группа</th><th>Дисциплина</th><th>Преподаватель</th><th>Аудитория</th><th>Отметки</th></tr></thead><tbody>${rows.map((l) => `<tr><td>${esc(l.date)}<br>${new Date(l.date + "T12:00:00").toLocaleDateString("ru", { weekday: "short" })}</td><td>${l.period ?? "До первой"}<br>${esc(time(l))}</td><td>${esc(l.groups.join(", "))}${l.subgroup ? "<br>" + l.subgroup + " подгр." : ""}</td><td>${esc(l.subject)}</td><td>${esc(l.teacher || "Не указан")}</td><td>${esc(l.room || "Не указана")}</td><td>${Model.changed(l, state.baseline) ? "Изменено. " : ""}${esc([...new Set(analysis.filter((c) => c.ids.includes(l.id)).flatMap((c) => c.types))].join(", "))}</td></tr>`).join("")}</tbody></table></div>`;
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

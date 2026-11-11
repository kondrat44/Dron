/* Shared data and conflict rules. Numbered periods use 1-based numbers; null is before period 1. */
window.Model = (() => {
  const copy = (x) => JSON.parse(JSON.stringify(x));
  const defaults = {
    roomPattern: "^([123])[0-9]+$",
    roomGroup: 1,
    bells: {
      mon: [
        ["09:10", "10:40"],
        ["10:55", "12:25"],
        ["12:55", "14:25"],
        ["14:40", "16:10"],
        ["16:20", "17:50"],
      ],
      wk: [
        ["08:30", "10:00"],
        ["10:15", "11:45"],
        ["12:15", "13:45"],
        ["14:00", "15:30"],
        ["15:40", "17:10"],
        ["17:20", "18:50"],
      ],
      sat: [
        ["08:30", "09:30"],
        ["09:40", "10:40"],
        ["10:50", "11:50"],
        ["12:00", "13:00"],
        ["13:10", "14:10"],
      ],
    },
    before: ["08:30", "09:00"],
    /* Правила конфликтов, подтверждённые учебной частью (редактируются в «Настройках»). */
    sharedRooms: ["1 этаж", "2 этаж"],
    practice: "практик",
    practiceInside: "учебн",
    /* Отделение в работе: группы с окончанием -Д (дороги) и -БС (беспилотники). Пусто — весь техникум. */
    scopeName: "Дорожное отделение",
    scopePattern: "-(Д|БС)$",
    /* Галочка «Все отделения (бета-тестирование)»: при каждом открытии выключена. */
    allDepartments: false,
    ignoreGroups: ["232-СЭЗ"],
  };
  const withDefaults = (s) => ({ ...copy(defaults), ...(s || {}) });
  function inScope(l, settings) {
    const s = withDefaults(settings),
      p = s.scopePattern;
    if (s.allDepartments || !p) return true;
    try {
      const re = new RegExp(p, "u");
      return l.groups.some((g) => re.test(g));
    } catch {
      return true;
    }
  }
  const departments = [
    "Архитектура и креативные индустрии",
    "Геодезия, землеустройство и кадастр",
    "Дорожное отделение",
    "Заочное отделение",
  ];
  /* Справочник кабинетов из приказа о заведовании (data/rooms.js). */
  const roomInfo = (room) =>
    (window.ROOMS || []).find((r) => r.room === String(room || "").trim()) || null;
  const allRooms = () => (window.ROOMS || []).map((r) => r.room);
  function building(room, settings) {
    try {
      return (
        String(room).match(new RegExp(settings.roomPattern))?.[
          settings.roomGroup
        ] ||
        roomInfo(room)?.building ||
        ""
      );
    } catch {
      return roomInfo(room)?.building || "";
    }
  }
  /* Специальности Дорожного отделения по окончанию шифра группы. */
  const SPECIALTIES = [
    [/-БС$/u, "Эксплуатация беспилотных авиационных систем"],
    [/-Д$/u, "Строительство и эксплуатация автомобильных дорог, аэродромов и городских путей сообщения"],
  ];
  /* Заполняет пустые поля справочника; то, что вписано вручную, не трогает. */
  function fillCatalog(catalog, groups, settings) {
    const s = withDefaults(settings);
    let re = null;
    try {
      re = s.scopePattern ? new RegExp(s.scopePattern, "u") : null;
    } catch {}
    const out = { ...(catalog || {}) };
    for (const g of groups) {
      const c = { specialty: "", department: "", ...(out[g] || {}) };
      if (!c.department && ((re && re.test(g)) || (window.ROAD_GROUPS || []).includes(g)))
        c.department = s.scopeName;
      if (!c.specialty) c.specialty = (SPECIALTIES.find(([r]) => r.test(g)) || [])[1] || "";
      out[g] = c;
    }
    return out;
  }
  function initial(data) {
    const lessons = copy(data.lessons);
    return {
      version: 1,
      dates: data.dates || [...new Set(lessons.map((l) => l.date))],
      lessons,
      baseline: copy(lessons),
      issues: data.issues || [],
      source: data.source || "Тестовая неделя",
      settings: copy(defaults),
      departments: copy(departments),
      catalog: fillCatalog({}, [...new Set(lessons.flatMap((l) => l.groups))], defaults),
      rooms: [...new Set([...allRooms(), ...lessons.map((l) => l.room)].filter(Boolean))],
    };
  }
  const minutes = (t) => {
    const a = t.split(":").map(Number);
    return a[0] * 60 + a[1];
  };
  function times(l, settings) {
    if (l.start && l.end) return [l.start, l.end];
    if (l.period === null) return settings.before;
    const d = new Date(l.date + "T12:00:00").getDay();
    return (
      settings.bells[d === 1 ? "mon" : d === 6 ? "sat" : "wk"][l.period - 1] ||
      null
    );
  }
  function overlaps(a, b, settings) {
    if (a.date !== b.date) return false;
    const x = times(a, settings),
      y = times(b, settings);
    return x && y
      ? minutes(x[0]) < minutes(y[1]) && minutes(y[0]) < minutes(x[1])
      : a.period === b.period;
  }
  function conflicts(lessons, settings) {
    settings = withDefaults(settings);
    const low = (x) => String(x || "").trim().toLowerCase();
    const shared = new Set(settings.sharedRooms.map(low));
    const ignored = new Set(settings.ignoreGroups.map(low));
    let practice = null,
      inside = null;
    try {
      practice = settings.practice ? new RegExp(settings.practice, "i") : null;
      inside = settings.practiceInside ? new RegExp(settings.practiceInside, "i") : null;
    } catch {}
    /* Учебная практика проходит в техникуме, остальная (производственная и т.п.) — вне его. */
    const away = (s) => !!practice && practice.test(s) && !(inside && inside.test(s));
    /* отменённые пары («окно») ни с чем не пересекаются */
    lessons = lessons.filter((l) => !l.cancelled && !l.groups.some((g) => ignored.has(low(g))));
    const intervals = new Map(
      lessons.map((l) => {
        const t = times(l, settings);
        return [l, t ? t.map(minutes) : null];
      }),
    );
    const result = [];
    for (let i = 0; i < lessons.length; i++)
      for (let j = i + 1; j < lessons.length; j++) {
        const a = lessons[i],
          b = lessons[j];
        if (a.date !== b.date) continue;
        const x = intervals.get(a),
          y = intervals.get(b);
        if (!(x && y ? x[0] < y[1] && y[0] < x[1] : a.period === b.period))
          continue;
        const types = [];
        /* Поток: один преподаватель ведёт тот же предмет в том же кабинете у нескольких групп. */
        const stream =
          low(a.teacher) &&
          low(a.teacher) === low(b.teacher) &&
          low(a.subject) === low(b.subject) &&
          low(a.room) === low(b.room);
        const outside = away(a.subject) || away(b.subject);
        const together = a.period === null && b.period === null;
        if (
          a.groups.some((g) => b.groups.includes(g)) &&
          (!a.subgroup || !b.subgroup || a.subgroup === b.subgroup)
        )
          types.push("Группа");
        if (
          !stream &&
          !outside &&
          !together &&
          a.teacher &&
          low(a.teacher) === low(b.teacher)
        )
          types.push("Преподаватель");
        if (
          !stream &&
          !outside &&
          !together &&
          a.room &&
          !shared.has(low(a.room)) &&
          low(a.room) === low(b.room)
        )
          types.push("Кабинет");
        if (types.length) result.push({ ids: [a.id, b.id], types });
      }
    return result;
  }
  function changed(l, baseline) {
    const old = baseline.find((x) => x.id === l.id);
    return JSON.stringify(l) !== JSON.stringify(old);
  }
  function swap(ls, a, b) {
    const x = ls.find((l) => l.id === a),
      y = ls.find((l) => l.id === b);
    if (!x || !y || x === y) throw Error("Выберите две разные пары");
    for (const k of ["date", "period", "start", "end"]) {
      const v = x[k];
      x[k] = y[k];
      y[k] = v;
    }
  }
  return {
    copy,
    defaults,
    withDefaults,
    roomInfo,
    allRooms,
    inScope,
    fillCatalog,
    departments,
    building,
    initial,
    times,
    overlaps,
    conflicts,
    changed,
    swap,
  };
})();

/* Формат опубликованного расписания: «издания» (edition) — по одному на каждую публикацию.
   Общий код для просмотра и для учебной части. Без сети и без интерфейса. */
window.Pack = (() => {
  const mondayOf = (iso) => {
    const d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.toLocaleDateString("sv");
  };
  /* Из результата Reader.matrix собрать компактное издание. */
  function edition(data, opt) {
    const set = Model.withDefaults({});
    const T = { g: [], s: [], t: [], r: [] };
    const ix = { g: new Map(), s: new Map(), t: new Map(), r: new Map() };
    const id = (k, v) => {
      v = String(v || "").trim();
      if (!ix[k].has(v)) {
        ix[k].set(v, T[k].length);
        T[k].push(v);
      }
      return ix[k].get(v);
    };
    const dates = [...new Set(data.lessons.map((l) => l.date))].sort();
    const L = data.lessons
      .filter((l) => !l.cancelled && l.subject)
      .map((l) => {
        const tm = Model.times(l, set) || ["", ""];
        return [
          dates.indexOf(l.date),
          l.period === null || l.period === undefined ? 0 : l.period,
          l.groups.map((g) => id("g", g)),
          l.subgroup || 0,
          id("s", l.subject),
          id("t", l.teacher),
          id("r", l.room),
          tm[0] || "",
          tm[1] || "",
        ];
      });
    const B = T.r.map((r) => String(Model.building(r, set) || ""));
    const N = T.r.map((r) => (Model.roomInfo(r) || {}).name || "");
    return {
      id: opt.id,
      source: data.source || "",
      publishedAt: opt.publishedAt,
      visibleFrom: opt.visibleFrom,
      kind: opt.kind || "",
      week: mondayOf(dates[0] || opt.publishedAt.slice(0, 10)),
      dates,
      T,
      B,
      N,
      L,
    };
  }
  function unpack(ed) {
    return ed.L.map((x, i) => ({
      i,
      date: ed.dates[x[0]],
      period: x[1] || null,
      groups: x[2].map((g) => ed.T.g[g]),
      sub: x[3],
      subject: ed.T.s[x[4]],
      teacher: ed.T.t[x[5]],
      room: ed.T.r[x[6]],
      bld: ed.B[x[6]] || "",
      roomName: (ed.N || [])[x[6]] || "",
      start: x[7],
      end: x[8],
    }));
  }
  const keyOf = (l) => [l.date, l.period || 0, l.sub, l.groups.join(",")].join("|");
  const valOf = (l) => [l.subject, l.teacher, l.room].join("¦");
  /* Что изменилось между двумя изданиями одной недели. */
  function diff(prevLessons, curLessons) {
    const a = new Map(),
      b = new Map();
    for (const l of prevLessons) a.set(keyOf(l), l);
    for (const l of curLessons) b.set(keyOf(l), l);
    const out = [];
    for (const [k, l] of b) {
      const o = a.get(k);
      if (!o) out.push({ type: "new", l });
      else if (valOf(o) !== valOf(l)) out.push({ type: "changed", l, old: o });
    }
    for (const [k, o] of a) if (!b.has(k)) out.push({ type: "removed", l: o, old: o });
    return out.sort(
      (x, y) => x.l.date.localeCompare(y.l.date) || (x.l.period || 0) - (y.l.period || 0) || x.l.groups.join().localeCompare(y.l.groups.join(), "ru", { numeric: true }),
    );
  }
  /* Какие недели и какие издания видны в момент now. */
  function view(file, now) {
    const t = now.toISOString();
    const byWeek = new Map();
    for (const ed of (file && file.editions) || []) {
      if (!byWeek.has(ed.week)) byWeek.set(ed.week, []);
      byWeek.get(ed.week).push(ed);
    }
    const weeks = [];
    let nextFlip = null;
    for (const [week, list] of byWeek) {
      list.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
      const seen = list.filter((e) => e.visibleFrom <= t);
      for (const e of list) if (e.visibleFrom > t && (!nextFlip || e.visibleFrom < nextFlip)) nextFlip = e.visibleFrom;
      if (!seen.length) continue;
      /* cur — последнее загруженное из видимых; prev — что студенты видели до появления cur
         (отложенные до вечера правки, которые перекрыло более позднее, в сравнение не попадают) */
      const cur = seen[seen.length - 1];
      const before = seen.filter((e) => e !== cur && e.visibleFrom < cur.visibleFrom);
      weeks.push({ week, cur, prev: before[before.length - 1] || null, dates: cur.dates });
    }
    weeks.sort((a, b) => a.week.localeCompare(b.week));
    return { weeks, nextFlip };
  }
  /* Добавить издание в файл и убрать старое. */
  function merge(file, ed, today) {
    const out = { v: 1, editions: [...((file && file.editions) || []).filter((e) => e.id !== ed.id), ed] };
    const limit = new Date(today + "T12:00:00");
    limit.setDate(limit.getDate() - 8);
    const old = limit.toLocaleDateString("sv");
    const byWeek = {};
    for (const e of out.editions) (byWeek[e.week] = byWeek[e.week] || []).push(e);
    out.editions = Object.values(byWeek)
      .filter((list) => list.some((e) => (e.dates[e.dates.length - 1] || e.week) >= old))
      .flatMap((list) => list.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt)).slice(-4))
      .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
    return out;
  }
  return { edition, unpack, diff, view, merge, mondayOf, keyOf };
})();

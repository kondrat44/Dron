/* Сервис: проверка файла, сравнение недель, замена преподавателя, история правок,
   занятость кабинета, нагрузка преподавателей, «Сегодня/Завтра», защита несохранённых правок. */
window.Tools = (() => {
  const WEEKS_KEY = "kuztagis-viewer-weeks";
  const DAY = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
  const dayOf = (d) => new Date(d + "T12:00:00").getDay();
  const isoLocal = (d) => d.toLocaleDateString("sv");
  const slotKey = (l) => `${l.groups.join(",")}|${dayOf(l.date)}|${l.period ?? "-"}|${l.subgroup}`;
  const val = (l) => `${l.subject}¦${l.teacher}¦${l.room}`;
  const people = (s) => String(s || "").trim().toLowerCase();

  /* ---------- 1–2. Проверка файла и сравнение с прошлой неделей ---------- */
  function summary(st) {
    const mine = st.lessons.filter((l) => !l.cancelled && Model.inScope(l, st.settings));
    const map = {};
    for (const l of mine) map[slotKey(l)] = val(l);
    const per = {};
    for (const l of mine) for (const g of l.groups) per[g] = (per[g] || 0) + 1;
    const dates = [...new Set(mine.map((l) => l.date))].sort();
    return {
      source: st.source,
      first: dates[0] || "",
      per,
      groups: Object.keys(per).length,
      lessons: mine.length,
      days: [...new Set(mine.map((l) => dayOf(l.date)))].sort(),
      map,
    };
  }
  function readWeeks() {
    try {
      return JSON.parse(localStorage.getItem(WEEKS_KEY)) || {};
    } catch {
      return {};
    }
  }
  function afterLoad(st, issues) {
    const now = summary(st);
    const weeks = readWeeks();
    /* та же неделя = то же имя файла и та же первая дата; новое расписание с тем же именем файла тоже сравнивается */
    const same = (w) => w && w.source === now.source && (w.first || "") === now.first;
    let prev = weeks.last && !same(weeks.last) ? weeks.last : weeks.prev;
    if (same(prev)) prev = null;
    const problems = [];
    /* Группы отделения, которые пропали или почти опустели */
    const inDep = (g) => Model.inScope({ groups: [g] }, st.settings);
    const known = new Set([...(weeks.known || []), ...Object.keys((prev && prev.per) || {})].filter(inDep));
    const headers = new Set(Object.keys(st.layout || {}).map((k) => k.split("|")[1]).filter(Boolean).filter(inDep));
    const gone = [], empty = [], few = [];
    for (const g of [...new Set([...known, ...headers])].sort((a, b) => a.localeCompare(b, "ru", { numeric: true }))) {
      const n = now.per[g] || 0,
        was = prev && prev.per ? prev.per[g] || 0 : 0;
      if (!n && headers.has(g)) empty.push(g);
      else if (!n) gone.push(was ? `${g} — в прошлый раз было ${was} ${was % 10 === 1 && was % 100 !== 11 ? "пара" : [2, 3, 4].includes(was % 10) && ![12, 13, 14].includes(was % 100) ? "пары" : "пар"}` : g);
      else if (was >= 10 && n < was * 0.5) few.push(`${g}: ${n} вместо ${was}`);
    }
    if (now.lessons) {
      if (empty.length) problems.push((empty.length > 1 ? "у групп " + empty.join(", ") + " в файле нет ни одной пары" : "у группы " + empty[0] + " в файле нет ни одной пары") + ": столбец есть, но пустой");
      if (gone.length)
        problems.push((gone.length > 1 ? "в файле нет групп, которые были раньше: " : "в файле нет группы, которая была раньше: ") + gone.join("; ") + ". Если группа на практике или больше не учится — всё в порядке");
      if (few.length) problems.push((few.length > 1 ? "у групп" : "у группы") + " заметно меньше пар, чем в прошлый раз: " + few.join("; "));
    }
    if (now.lessons === 0) problems.push("в файле не найдено ни одной пары отделения");
    else {
      if (prev && now.groups < prev.groups * 0.75)
        problems.push(`групп заметно меньше, чем в прошлый раз: ${now.groups} вместо ${prev.groups}`);
      else if (!prev && now.groups < 8) problems.push(`найдено мало групп: ${now.groups}`);
      if (prev && now.lessons < prev.lessons * 0.6)
        problems.push(`пар заметно меньше, чем в прошлый раз: ${now.lessons} вместо ${prev.lessons}`);
      else if (!prev && now.lessons < 80) problems.push(`найдено мало пар: ${now.lessons}`);
      const missing = [1, 2, 3, 4, 5, 6].filter((d) => !now.days.includes(d));
      if (missing.length && missing.length < 6)
        problems.push(
          "нет пар в эти дни: " + missing.map((d) => DAY[d]).join(", ") + " (если это праздник или выходной — всё в порядке)",
        );
      const mine = st.lessons.filter((l) => Model.inScope(l, st.settings) && l.period !== null);
      const noRoom = mine.filter((l) => !l.room && !/практик/i.test(l.subject)).length;
      if (noRoom > mine.length * 0.2)
        problems.push(`у многих пар не указан кабинет: ${noRoom} из ${mine.length}`);
    }
    let diff = null;
    if (prev) {
      const keys = new Set([...Object.keys(prev.map), ...Object.keys(now.map)]);
      const byGroup = {};
      for (const k of keys) {
        const a = prev.map[k],
          b = now.map[k];
        if (a === b) continue;
        const [g, d, p, sg] = k.split("|");
        (byGroup[g] = byGroup[g] || []).push({ d: Number(d), p, sg: Number(sg), a, b });
      }
      diff = { prev: prev.source, byGroup };
    }
    try {
      localStorage.setItem(
        WEEKS_KEY,
        JSON.stringify({ prev: prev || weeks.prev || null, last: now, known: [...new Set([...known, ...Object.keys(now.per)])] }),
      );
    } catch {}
    return { problems, diff };
  }
  function notesHtml(notes, esc) {
    if (!notes) return "";
    let html = "";
    if (notes.problems.length)
      html += `<div class="notice warn"><p><b>Похоже, с файлом что-то не так.</b> Проверьте, тот ли это файл и целиком ли он:</p><ul>${notes.problems
        .map((x) => `<li>${esc(x)}</li>`)
        .join("")}</ul></div>`;
    if (notes.diff) {
      const groups = Object.entries(notes.diff.byGroup).sort((a, b) =>
        a[0].localeCompare(b[0], "ru", { numeric: true }),
      );
      const total = groups.reduce((s, [, v]) => s + v.length, 0);
      const part = (x) => {
        if (!x) return "пусто";
        const [s, t, r] = x.split("¦");
        return `${s}${t ? ", " + t : ""}${r ? ", ауд. " + r : ""}`;
      };
      html += `<details class="card"><summary>Что изменилось по сравнению с «${esc(notes.diff.prev)}»: ${total}</summary>${
        groups.length
          ? groups
              .map(
                ([g, list]) =>
                  `<p><b>${esc(g)}</b> — ${list.length}</p><ul class="diff">${list
                    .sort((a, b) => a.d - b.d || String(a.p).localeCompare(String(b.p), "ru", { numeric: true }))
                    .map(
                      (x) =>
                        `<li>${DAY[x.d]}, ${x.p === "-" ? "до первой пары" : x.p + " пара"}${x.sg ? ", " + x.sg + " подгр." : ""}: <s>${esc(part(x.a))}</s> → ${esc(part(x.b))}</li>`,
                    )
                    .join("")}</ul>`,
              )
              .join("")
          : "<p>Расписание Дорожного совпадает с прошлой неделей.</p>"
      }</details>`;
    }
    return html;
  }

  /* ---------- 5. Несохранённые правки ---------- */
  const sig = (st) =>
    JSON.stringify(
      st.lessons
        .filter((l) => Model.changed(l, st.baseline))
        .map((l) => [l.id, l.date, l.period, l.teacher, l.room, l.subject, l.subgroup, !!l.cancelled, !!l.added]),
    );
  /* «есть нескачанные правки» = расписание отличается от последнего скачанного Excel
     (а до первого скачивания — от загруженного файла). Так кнопка зелёная и после обмена,
     и после того, как скачанную правку вернули назад. */
  const unsaved = (st) => !!st.lessons.length && sig(st) !== (st.exportedSig || "[]");

  /* ---------- 6. Сегодня / Завтра ---------- */
  function dayFilter(st, shift) {
    const d = new Date();
    d.setDate(d.getDate() + shift);
    const iso = isoLocal(d);
    const dates = [...new Set([...(st.dates || []), ...st.lessons.map((l) => l.date)])];
    return dates.includes(iso) ? iso : null;
  }

  /* ---------- 3. Замена преподавателя ---------- */
  function busy(st, teacher, l) {
    return st.lessons.some(
      (x) => x !== l && !x.cancelled && people(x.teacher) === people(teacher) && Model.overlaps(x, l, st.settings),
    );
  }
  function candidates(st, l) {
    const all = [...new Set(st.lessons.map((x) => x.teacher).filter(Boolean))];
    const same = new Set(
      st.lessons.filter((x) => people(x.subject) === people(l.subject)).map((x) => people(x.teacher)),
    );
    return all
      .filter((t) => people(t) !== people(l.teacher) && !busy(st, t, l))
      .map((t) => ({ t, same: same.has(people(t)) }))
      .sort((a, b) => Number(b.same) - Number(a.same) || a.t.localeCompare(b.t, "ru"));
  }

  /* ---------- 4. История правок ---------- */
  function changes(st) {
    const base = new Map(st.baseline.map((b) => [b.id, b]));
    return st.lessons
      .filter((l) => Model.changed(l, st.baseline))
      .map((l) => ({ l, b: base.get(l.id) || (l.added ? { ...l, isNew: true } : null) }))
      .filter((x) => x.b)
      .sort((a, b) => a.b.date.localeCompare(b.b.date) || (a.b.period ?? -1) - (b.b.period ?? -1));
  }
  function revert(st, id) {
    const base = new Map(st.baseline.map((b) => [b.id, b]));
    const l = st.lessons.find((x) => x.id === id),
      b = base.get(id);
    if (l && l.added) {
      st.lessons.splice(st.lessons.indexOf(l), 1);
      return;
    }
    if (!l || !b) return;
    const moved = l.date !== b.date || l.period !== b.period;
    /* у обмена возвращаем и вторую пару, стоящую теперь на старом месте */
    const partner = moved
      ? st.lessons.find(
          (x) =>
            x !== l &&
            x.date === b.date &&
            x.period === b.period &&
            Model.changed(x, st.baseline) &&
            base.get(x.id) &&
            base.get(x.id).date === l.date &&
            base.get(x.id).period === l.period,
        )
      : null;
    for (const x of [l, partner].filter(Boolean)) {
      delete x.cancelled;
      Object.assign(x, Model.copy(base.get(x.id)));
    }
  }

  /* ---------- 8. Нагрузка преподавателей ---------- */
  function load(st, teachers) {
    const out = [];
    for (const t of teachers) {
      const ls = st.lessons.filter((l) => !l.cancelled && people(l.teacher) === people(t) && l.period !== null);
      const slots = new Map();
      for (const l of ls) slots.set(l.date + "|" + l.period, l);
      let windows = 0;
      const byDay = {};
      for (const k of slots.keys()) {
        const [d, p] = k.split("|");
        (byDay[d] = byDay[d] || []).push(Number(p));
      }
      for (const ps of Object.values(byDay)) {
        ps.sort((a, b) => a - b);
        for (let i = 1; i < ps.length; i++) windows += ps[i] - ps[i - 1] - 1;
      }
      out.push({ t, pairs: slots.size, days: Object.keys(byDay).length, windows });
    }
    return out.sort((a, b) => b.pairs - a.pairs || a.t.localeCompare(b.t, "ru"));
  }

  /* ---------- Перенос на свободное место и подсказки по конфликтам ---------- */
  function periodsFor(st, date, group) {
    const slot = st.layout && st.layout[date + "|" + group];
    if (slot) return Object.keys(slot.rows).filter((k) => k !== "before").map(Number).sort((a, b) => a - b);
    const set = Model.withDefaults(st.settings);
    const d = dayOf(date);
    const n = (set.bells[d === 1 ? "mon" : d === 6 ? "sat" : "wk"] || []).length || 5;
    return [...Array(n).keys()].map((i) => i + 1);
  }
  const sameGroup = (x, l) =>
    x.groups.some((g) => l.groups.includes(g)) && (!x.subgroup || !l.subgroup || x.subgroup === l.subgroup);
  function freeRooms(st, probe, prefer) {
    const set = Model.withDefaults(st.settings);
    const shared = new Set(set.sharedRooms.map(people));
    const rooms = [...new Set([...(st.rooms || []), ...st.lessons.map((x) => x.room)])].filter(
      (r) => r && !shared.has(people(r)),
    );
    return rooms
      .filter((r) => !st.lessons.some((x) => x.id !== probe.id && !x.cancelled && x.room === r && Model.overlaps(x, probe, st.settings)))
      .sort(
        (a, b) =>
          Number(Model.building(b, st.settings) === prefer) - Number(Model.building(a, st.settings) === prefer) ||
          a.localeCompare(b, "ru", { numeric: true }),
      );
  }
  function freeSlots(st, l) {
    const set = Model.withDefaults(st.settings);
    const shared = new Set(set.sharedRooms.map(people));
    const dates = [...new Set([...(st.dates || []), ...st.lessons.map((x) => x.date)])].sort();
    const out = [];
    for (const date of dates) {
      if (dayOf(date) === 0) continue;
      for (const period of periodsFor(st, date, l.groups[0])) {
        if (date === l.date && period === l.period) continue;
        const probe = { ...l, date, period, start: "", end: "" };
        const others = st.lessons.filter((x) => x.id !== l.id && !x.cancelled && Model.overlaps(x, probe, st.settings));
        if (others.some((x) => sameGroup(x, l))) continue;
        if (l.teacher && others.some((x) => people(x.teacher) === people(l.teacher))) continue;
        const roomBusy = !!l.room && !shared.has(people(l.room)) && others.some((x) => x.room === l.room);
        const alt = roomBusy ? freeRooms(st, probe, Model.building(l.room, st.settings))[0] || "" : "";
        if (roomBusy && !alt) continue;
        out.push({ date, period, roomBusy, alt });
      }
    }
    return out.sort(
      (a, b) =>
        Number(a.roomBusy) - Number(b.roomBusy) ||
        Number(b.date === l.date) - Number(a.date === l.date) ||
        a.date.localeCompare(b.date) ||
        a.period - b.period,
    );
  }

  /* Окна у групп: пустые пары между занятиями в один день (подгруппы считаются вместе) */
  function groupWindows(st, groups) {
    const out = [];
    for (const g of groups) {
      const byDay = {};
      for (const l of st.lessons)
        if (!l.cancelled && l.period !== null && l.groups.includes(g)) (byDay[l.date] = byDay[l.date] || new Set()).add(l.period);
      for (const [d, set] of Object.entries(byDay)) {
        const ps = [...set].sort((a, b) => a - b);
        for (let p = ps[0] + 1; p < ps[ps.length - 1]; p++) if (!set.has(p)) out.push({ g, d, p });
      }
    }
    return out.sort((a, b) => a.g.localeCompare(b.g, "ru", { numeric: true }) || a.d.localeCompare(b.d) || a.p - b.p);
  }
  return { isoLocal, groupWindows, freeSlots, freeRooms, afterLoad, notesHtml, sig, unsaved, dayFilter, candidates, changes, revert, load, DAY, dayOf };
})();

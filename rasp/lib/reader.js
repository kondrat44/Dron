/* Adapters: college matrix and explicit flat interchange format. No network or UI dependencies. */
window.Reader = (() => {
  const headers = [
    "Дата",
    "Пара",
    "Группа",
    "Подгруппа",
    "Дисциплина",
    "Преподаватель",
    "Кабинет",
    "Начало",
    "Конец",
  ];
  const str = (v) =>
    v == null
      ? ""
      : typeof v === "object"
        ? v.text ||
          v.richText?.map((x) => x.text).join("") ||
          String(v.result ?? "")
        : String(v).trim();
  /* «Огиенко Д.А.» и «Огиенко Д. А.» — один человек: единый вид инициалов. */
  const person = (s) =>
    str(s)
      .replace(/\s+/g, " ")
      .replace(/([А-ЯЁA-Z])\.\s*(?=[А-ЯЁA-Z]\.)/g, "$1. ");
  const iso = (s) => {
    if (s instanceof Date) return s.toISOString().slice(0, 10);
    s = str(s);
    const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(s);
    return m
      ? `${m[3]}-${m[2]}-${m[1]}`
      : /^\d{4}-\d{2}-\d{2}$/.test(s)
        ? s
        : "";
  };
  function validate(l) {
    if (
      !iso(l.date) ||
      Number.isNaN(Date.parse(l.date + "T12:00:00")) ||
      !l.groups.length ||
      !l.subject
    )
      return "Нет даты, группы или дисциплины";
    if (
      l.period !== null &&
      (!Number.isInteger(l.period) || l.period < 1 || l.period > 20)
    )
      return "Неверный номер пары";
    if (![0, 1, 2].includes(l.subgroup))
      return "Подгруппа должна быть 1, 2 или пустой";
    if (
      (l.start || l.end) &&
      (!/^([01]\d|2[0-3]):[0-5]\d$/.test(l.start) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(l.end) ||
        l.start >= l.end)
    )
      return "Неверное время";
    return "";
  }
  function flat(rows, source) {
    const lessons = [],
      issues = [];
    const h = rows[0]?.map(str) || [];
    if (!headers.slice(0, 7).every((x) => h.includes(x)))
      throw Error("Нужны столбцы: " + headers.slice(0, 7).join(", "));
    rows.slice(1).forEach((r, i) => {
      if (!r.some((x) => str(x))) return;
      const v = (k) => r[h.indexOf(k)];
      const l = {
        id: `f${i}`,
        date: iso(v("Дата")),
        period: str(v("Пара")) === "" ? null : Number(v("Пара")),
        groups: str(v("Группа"))
          .split("|")
          .map((x) => x.trim())
          .filter(Boolean),
        subgroup: Number(v("Подгруппа") || 0),
        subject: str(v("Дисциплина")),
        teacher: person(v("Преподаватель")),
        room: str(v("Кабинет")),
        start: str(v("Начало")),
        end: str(v("Конец")),
        source: { file: source, row: i + 2, raw: r.map(str) },
      };
      const error = validate(l);
      if (error)
        issues.push({
          where: `${source}, строка ${i + 2}`,
          reason: error,
          raw: r.map(str).join(" | "),
        });
      else {
        lessons.push(l);
        if (!l.room || (!l.teacher && l.period !== null))
          issues.push({
            where: `${source}, строка ${i + 2}`,
            reason: [
              !l.room ? "Не указан кабинет" : "",
              !l.teacher && l.period !== null ? "Не указан преподаватель" : "",
            ]
              .filter(Boolean)
              .join("; "),
            raw: r.map(str).join(" | "),
          });
      }
    });
    return { lessons, issues, source };
  }
  function matrix(wb, source) {
    const lessons = [],
      issues = [],
      dates = [],
      layout = {};
    wb.eachSheet((ws) => {
      const date = iso(ws.getCell(1, 1).value);
      if (!date) {
        issues.push({
          where: ws.name,
          reason: "Не найдена дата листа",
          raw: str(ws.getCell(1, 1).value),
        });
        return;
      }
      dates.push(date);
      const usedRows = new Set([1, 2, 3, 4]);
      const own = (r, c) => {
        const x = ws.getCell(r, c);
        return x.isMerged && x.master.address !== x.address ? "" : str(x.value);
      };
      const width = (r, c) => {
        const x = ws.getCell(r, c);
        const m = (ws.model.merges || []).find(
          (a) => a.split(":")[0] === x.address,
        );
        if (!m) return 1;
        const end = ws.getCell(m.split(":")[1]);
        return end.col - c + 1;
      };
      let groups = [];
      for (let r = 5; r <= ws.rowCount; r++) {
        const first = own(r, 1);
        const gs = [2, 8, 14, 20].map((c) => own(r, c));
        if (!first && gs.some((g) => /^\d{2,3}-/u.test(g))) {
          groups = gs;
          usedRows.add(r);
          [2, 8, 14, 20].forEach((base, k) => {
            const key = date + "|" + gs[k];
            if (gs[k] && !layout[key])
              layout[key] = { sheet: ws.name, base, header: r, rows: {} };
          });
          continue;
        }
        if (!groups.length) continue;
        const period = /^\d+$/.test(first) ? Number(first) : null;
        const special =
          !first &&
          [2, 8, 14, 20].some((c) => /разговор.*важном/i.test(own(r, c)));
        if (period === null && !special) {
          if (!first && [2, 8, 14, 20].some((c) => own(r, c)) && r > 5) {
            /* teacher lines are consumed with their preceding lesson */
          }
          continue;
        }
        usedRows.add(r);
        if (!special) usedRows.add(r + 1);
        [2, 8, 14, 20].forEach((base, k) => {
          const slot = layout[date + "|" + groups[k]];
          if (!slot || slot.sheet !== ws.name || slot.base !== base) return;
          const key = special ? "before" : String(period);
          if (slot.rows[key] == null) slot.rows[key] = r;
        });
        [2, 8, 14, 20].forEach((base, k) => {
          const group = groups[k];
          if (!group) return;
          for (const col of [base, base + 2]) {
            const subject = own(r, col);
            if (!subject) continue;
            const whole = col === base && width(r, col) >= 3;
            if (col === base + 2 && width(r, base) >= 3) continue;
            const subgroup = whole ? 0 : col === base ? 1 : 2;
            const roomCol = whole ? base + 4 : col + 1;
            let room = own(r, roomCol);
            if (!room && whole) room = own(r, base + 5);
            const teacher = special ? "" : person(own(r + 1, col));
            const l = {
              id: `${ws.id}-${r}-${col}`,
              date,
              period,
              groups: [group],
              subgroup,
              subject,
              teacher,
              room,
              start: "",
              end: "",
              source: {
                file: source,
                sheet: ws.name,
                cell: ws.getCell(r, col).address,
                raw: [subject, teacher, room],
              },
            };
            const error = validate(l);
            if (error)
              issues.push({
                where: `${ws.name}!${ws.getCell(r, col).address}`,
                reason: error,
                raw: subject,
              });
            else {
              lessons.push(l);
              if (!room || (!teacher && !special))
                issues.push({
                  where: `${ws.name}!${ws.getCell(r, col).address}`,
                  reason: !room
                    ? "Не указан кабинет"
                    : "Не указан преподаватель",
                  raw: subject,
                });
            }
          }
        });
      }
      for (let r = 5; r <= ws.rowCount; r++) {
        if (usedRows.has(r)) continue;
        const raw = [];
        for (let c = 1; c <= ws.columnCount; c++) {
          const value = own(r, c);
          if (value) raw.push(ws.getCell(r, c).address + ": " + value);
        }
        if (raw.length)
          issues.push({
            where: ws.name + "!" + r,
            reason: "Строка вне распознанного блока, требуется проверка",
            raw: raw.join(" | "),
          });
      }
    });
    return { lessons, issues, dates, source, layout };
  }
  /* ---------- формат «сетка»: листы по отделениям, столбцы — группы (пара + кабинет), строки — дни и пары ----------
     A: «понедельник 16.11», B: номер пары, C: время «08:30-10:00»; строка заголовка: B = «пары», дальше группы.
     Подгруппы через «/»: «Физика/» — только 1-я, «/Информатика» — только 2-я, «Ин.яз./Информатика» + «1404/3312» — обе.
     Преподавателей у пар нет; внизу листа строки: физкультура (кабинет «… корп»), иностранный язык (по кабинетам), куратор. */
  const DAYS = /^(понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)\s+(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/i;
  const GROUP = /^\d{2,3}-[а-яёa-z]+$/i;
  const isGridHeader = (ws, r) => /^пары$/i.test(str(ws.getCell(r, 2).value)) && [4, 6, 8].some((c) => GROUP.test(str(ws.getCell(r, c).value)));
  const isGrid = (wb) => wb.worksheets.some((ws) => { for (let r = 1; r <= Math.min(12, ws.rowCount); r++) if (isGridHeader(ws, r)) return true; return false; });
  /* год у дат «16.11» — ближайший к сегодняшнему дню */
  const withYear = (d, m, y) => {
    if (y) return `${y.length === 2 ? "20" + y : y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const now = new Date();
    let best = null;
    for (const yy of [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]) {
      const t = new Date(yy, m - 1, d, 12);
      if (t.getMonth() !== m - 1) continue;
      if (!best || Math.abs(t - now) < Math.abs(best - now)) best = t;
    }
    return best ? best.toLocaleDateString("sv") : "";
  };
  const hhmm = (t) => (t ? t.padStart(5, "0") : "");
  const surname = (n) => n.toLowerCase().replace(/ё/g, "е").split(/[\s.]+/)[0];
  function grid(wb, source) {
    const lessons = [], issues = [], dates = new Set(), names = [];
    for (const ws of wb.worksheets) {
      const cell = (r, c) => str(ws.getCell(r, c).value);
      let header = 0;
      for (let r = 1; r <= Math.min(12, ws.rowCount); r++) if (isGridHeader(ws, r)) { header = r; break; }
      if (!header) continue;
      const cols = [];
      for (let c = 4; c <= ws.columnCount; c++) { const g = cell(header, c); if (GROUP.test(g)) cols.push({ c, group: g.toUpperCase() }); }
      /* строки внизу: преподаватели физкультуры, иностранного языка, кураторы */
      let date = "", lastLesson = header;
      const raw = [];
      for (let r = header + 1; r <= ws.rowCount; r++) {
        const a = cell(r, 1), b = cell(r, 2);
        const m = DAYS.exec(a);
        if (m) date = withYear(Number(m[2]), Number(m[3]), m[4]);
        if (!date) continue;
        const period = /^\d+$/.test(b) ? Number(b) : null;
        if (period === null && !m) { raw.push(r); continue; } // не пара: подвал листа
        lastLesson = r;
        const tm = /(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/.exec(cell(r, 3));
        for (const { c, group } of cols) {
          const subj = cell(r, c), room = cell(r, c + 1);
          if (!subj) continue;
          const parts = [];
          if (subj.includes("/") && (room.includes("/") || /^\/|\/$/.test(subj))) {
            const ss = subj.split("/"), rr = room.includes("/") ? room.split("/") : [room, room];
            ss.slice(0, 2).forEach((x, i) => x.trim() && parts.push({ sub: i + 1, subject: x.trim(), room: (rr[i] || "").trim() }));
          } else parts.push({ sub: 0, subject: subj, room });
          for (const x of parts) {
            const l = {
              id: `${ws.name}-${r}-${c}-${x.sub}`,
              date, period, groups: [group], subgroup: x.sub, subject: x.subject, teacher: "", room: x.room,
              start: period !== null && tm ? hhmm(tm[1]) : "", end: period !== null && tm ? hhmm(tm[2]) : "",
              source: { file: source, sheet: ws.name, cell: ws.getCell(r, c).address, raw: [subj, room] },
            };
            const error = validate(l);
            if (error) issues.push({ where: `${ws.name}!${ws.getCell(r, c).address}`, reason: error, raw: subj });
            else { lessons.push(l); dates.add(date); }
          }
        }
      }
      /* подвал: по каждой группе — физкультура, иностранный язык (по кабинетам), куратор */
      const pe = {}, lang = {};
      for (const r of raw.filter((r) => r > lastLesson)) {
        const vals = cols.map(({ c, group }) => ({ group, name: cell(r, c), room: cell(r, c + 1) })).filter((x) => x.name);
        if (!vals.length) continue;
        const corp = vals.filter((x) => /корп/i.test(x.room)).length;
        const rooms = vals.filter((x) => /\d{3,4}/.test(x.room)).length;
        if (corp >= vals.length / 2) vals.forEach((x) => (pe[x.group] = person(x.name)));
        else if (rooms >= vals.length / 2)
          vals.forEach((x) => {
            const ns = x.name.split("/").map((n) => person(n.trim())), rs = x.room.split("/").map((q) => q.trim());
            lang[x.group] = ns.map((n, i) => ({ name: n, room: rs[i] || "" }));
          });
        else vals.forEach((x) => names.push(person(x.name))); // куратор: не преподаватель пары, но полное ФИО пригодится
        vals.forEach((x) => x.name.split("/").forEach((n) => /[А-ЯЁ]\.\s*[А-ЯЁ]\./.test(n) && names.push(person(n.trim()))));
      }
      for (const l of lessons) {
        if (l.source.sheet !== ws.name || l.teacher) continue;
        const g = l.groups[0];
        if (/физ.*культ|физкульт/i.test(l.subject) && pe[g]) l.teacher = pe[g];
        else if (/^ин\.?\s*яз|иностр/i.test(l.subject) && lang[g]) {
          const t = lang[g].find((x) => x.room && x.room === l.room) || (lang[g].length === 1 ? lang[g][0] : l.subgroup ? lang[g][l.subgroup - 1] : null);
          if (t) l.teacher = t.name;
        }
      }
    }
    canonTeachers(lessons, names); // «Швецов» → «Швецов Г. А.», если в файле есть полное ФИО
    return { lessons, issues, dates: [...dates].sort(), source, layout: {}, format: "grid", noTeachers: true };
  }
  /* «Швецов» → «Швецов Г. А.», «Ковалев Н. Т.» → «Ковалёв Н. Т.», если такой преподаватель уже известен */
  function canonTeachers(lessons, known) {
    const key = (n) => n.toLowerCase().replace(/ё/g, "е").replace(/[\s.]+/g, "");
    const byKey = new Map(), bySur = new Map();
    for (const n of known || []) {
      if (!n) continue;
      byKey.set(key(n), n);
      const s = surname(n);
      bySur.set(s, bySur.has(s) && bySur.get(s) !== n ? null : n);
    }
    for (const l of lessons) {
      if (!l.teacher) continue;
      const k = byKey.get(key(l.teacher));
      if (k) l.teacher = k;
      else if (!/\s/.test(l.teacher.trim()) && bySur.get(surname(l.teacher))) l.teacher = bySur.get(surname(l.teacher));
    }
    return lessons;
  }
  function csv(text) {
    const rows = [];
    let row = [],
      field = "",
      quoted = false;
    const line = text.split(/\r?\n/)[0],
      sep =
        (line.match(/;/g) || []).length >= (line.match(/,/g) || []).length
          ? ";"
          : ",";
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (quoted && text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = !quoted;
      } else if (c === sep && !quoted) {
        row.push(field);
        field = "";
      } else if ((c === "\n" || c === "\r") && !quoted) {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else field += c;
    }
    if (quoted) throw Error("Незакрытые кавычки CSV");
    if (field || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }
  async function read(file) {
    if (!file.size)
      throw Error(
        "Файл пуст. Выберите Excel (.xlsx) или CSV с заголовками и занятиями.",
      );
    if (!/\.(xlsx|csv)$/i.test(file.name))
      throw Error("Поддерживаются только .xlsx и .csv.");
    if (/\.csv$/i.test(file.name))
      return flat(csv((await file.text()).replace(/^\uFEFF/, "")), file.name);
    let wb;
    try {
      wb = XlsxCompat.workbook(await file.arrayBuffer());
    } catch {
      throw Error(
        "Не удалось прочитать книгу XLSX: файл повреждён или имеет другой формат. Пересохраните его в Excel как .xlsx.",
      );
    }
    if (!wb.worksheets.length) throw Error("В книге нет листов.");
    const ws = wb.worksheets[0];
    if (str(ws?.getCell(1, 1).value) === "Дата") {
      const rows = [];
      ws.eachRow({ includeEmpty: true }, (r) => rows.push(r.values.slice(1)));
      return flat(rows, file.name);
    }
    if (isGrid(wb)) return grid(wb, file.name);
    if (
      !wb.worksheets.some((s) =>
        /^Расписание на \d{2}\.\d{2}\.\d{4}/.test(str(s.getCell(1, 1).value)),
      )
    )
      throw Error(
        "Формат не распознан. Нужна матрица учебной части с датой в A1 или таблица со столбцами: " +
          headers.slice(0, 7).join(", "),
      );
    return matrix(wb, file.name);
  }
  return { read, matrix, grid, flat, csv, headers, validate, canonTeachers };
})();

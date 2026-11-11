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
  return { read, matrix, flat, csv, headers, validate };
})();

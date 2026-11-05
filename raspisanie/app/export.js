window.Export = (() => {
  function save(blob, name) {
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function table(lessons, state) {
    const wb = new ExcelJS.Workbook(),
      ws = wb.addWorksheet("Расписание");
    ws.addRow([...Reader.headers, "Изменено", "Источник"]);
    for (const l of lessons) {
      ws.addRow([
        l.date,
        l.period,
        l.groups.join("|"),
        l.subgroup || "",
        l.subject,
        l.teacher,
        l.room,
        l.start || "",
        l.end || "",
        Model.changed(l, state.baseline) ? "Да" : "",
        l.source?.sheet
          ? `${l.source.sheet}!${l.source.cell}`
          : l.source?.file || "",
      ]);
    }
    ws.columns.forEach(
      (c, i) => (c.width = [14, 9, 18, 12, 55, 28, 14, 12, 12, 12, 30][i]),
    );
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF424245" },
    };
    ws.eachRow((r) => {
      r.alignment = { vertical: "middle", wrapText: true };
      r.eachCell(
        (c) =>
          (c.border = {
            bottom: { style: "thin", color: { argb: "FFE8E8ED" } },
          }),
      );
    });
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: "A1", to: "K" + ws.rowCount };
    ws.pageSetup = {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    };
    const buf = await wb.xlsx.writeBuffer();
    save(new Blob([buf]), "Расписание (таблица).xlsx");
  }

  /* Same workbook as was loaded: only cells of edited pairs change. */
  const keyOf = (s) => s.sheet + "|" + s.r + "|" + s.base;
  const fields = ["subject", "teacher", "room"];
  function origin(b) {
    const { r, c } = XlsxPatch.parseAddr(b.source.cell);
    const base = b.subgroup === 2 ? c - 2 : c;
    return { sheet: b.source.sheet, r, base, col: c };
  }
  function shape(l) {
    const h = l.period === null ? 1 : 2;
    return l.subgroup === 0
      ? { dc: 0, w: 6, h }
      : { dc: l.subgroup === 1 ? 0 : 2, w: 2, h };
  }
  const label = (l) =>
    `${l.groups.join(", ")}, ${new Date(l.date + "T12:00:00").toLocaleDateString("ru", { weekday: "short", day: "2-digit", month: "2-digit" })}, ${l.period ? l.period + " пара" : "до первой пары"}: ${l.subject}`;
  async function original(state, bytes, name) {
    const wb = XlsxCompat.workbook(bytes);
    const { layout } = Reader.matrix(wb, name);
    const base = new Map(state.baseline.map((b) => [b.id, b]));
    const book = await XlsxPatch.open(bytes);
    const problems = [];
    const target = (l) => {
      const slot = layout[l.date + "|" + l.groups[0]];
      const r = slot?.rows[l.period === null ? "before" : String(l.period)];
      return slot && r ? { sheet: slot.sheet, r, base: slot.base } : null;
    };
    const plan = [];
    for (const l of state.lessons) {
      const b = base.get(l.id);
      if (!b?.source?.sheet || !b.source.cell) {
        problems.push("нет места в исходном файле — " + label(l));
        continue;
      }
      const moved =
        b.date !== l.date ||
        b.period !== l.period ||
        b.subgroup !== l.subgroup ||
        b.groups.join("|") !== l.groups.join("|");
      const edited = fields.some((k) => (b[k] || "") !== (l[k] || ""));
      if ((b.period === null) !== (l.period === null)) {
        problems.push("занятие до первой пары нельзя ставить на обычную пару — " + label(l));
        continue;
      }
      if (!moved && !edited) continue;
      const to = target(l);
      if (!to) {
        problems.push("в файле нет такой клетки (день или пара отсутствует) — " + label(l));
        continue;
      }
      plan.push({ l, b, from: origin(b), to, moved });
    }
    if (problems.length)
      throw Error("Не удалось перенести в исходный вид: " + problems.slice(0, 5).join("; "));
    if (!plan.length) {
      save(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), name);
      return 0;
    }
    /* slots whose layout changes are rebuilt from pieces of the original */
    const touched = new Map();
    for (const p of plan)
      if (p.moved) {
        touched.set(keyOf(p.from), p.from);
        touched.set(keyOf(p.to), p.to);
      }
    const occupants = new Map([...touched.keys()].map((k) => [k, []]));
    if (touched.size)
      for (const l of state.lessons) {
        const t = target(l);
        if (t && occupants.has(keyOf(t))) occupants.get(keyOf(t)).push(l);
      }
    const pieces = new Map();
    for (const list of occupants.values())
      for (const l of list) {
        const b = base.get(l.id),
          o = origin(b),
          sh = shape(b),
          sheet = await book.sheet(o.sheet);
        pieces.set(l.id, sheet.capture(o.r, o.base + sh.dc, sh.h, sh.w));
      }
    for (const [k, slot] of touched) {
      const list = occupants.get(k);
      const cols = new Map();
      for (const l of list) {
        const sh = shape(l);
        for (let j = sh.dc; j < sh.dc + sh.w; j++) {
          if (cols.has(j))
            throw Error(
              "В одной клетке оказались два занятия: " + label(l) + " и " + label(cols.get(j)) + ". Разведите их по разным парам или подгруппам.",
            );
          cols.set(j, l);
        }
      }
      const sheet = await book.sheet(slot.sheet);
      const hasBefore = list.some((l) => l.period === null);
      sheet.clearRect(slot.r, slot.base, hasBefore ? 1 : 2, 6);
      for (const l of list) {
        const sh = shape(l),
          piece = pieces.get(l.id),
          bShape = shape(base.get(l.id));
        if (bShape.w !== sh.w)
          throw Error("Нельзя превратить занятие подгруппы в занятие всей группы: " + label(l));
        sheet.paste(piece, slot.r, slot.base + sh.dc);
      }
    }
    /* text edits: subject, teacher, room in their (new) place */
    for (const { l, b, to } of plan) {
      const sheet = await book.sheet(to.sheet),
        sh = shape(l),
        col = to.base + sh.dc;
      if ((b.subject || "") !== (l.subject || "")) sheet.setValue(to.r, col, l.subject);
      if (l.period !== null && (b.teacher || "") !== (l.teacher || ""))
        sheet.setValue(to.r + 1, col, l.teacher);
      if ((b.room || "") !== (l.room || "")) {
        let rc = col + 1;
        if (sh.w === 6) rc = !sheet.hasValue(to.r, to.base + 4) && sheet.hasValue(to.r, to.base + 5) ? to.base + 5 : to.base + 4;
        sheet.setValue(to.r, rc, l.room);
      }
    }
    const blob = await book.save();
    save(blob, name.replace(/\.xlsx$/i, "") + " (изменено).xlsx");
    return plan.length;
  }
  return { table, original, save, excel: table };
})();

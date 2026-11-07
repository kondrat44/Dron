window.Export = (() => {
  function save(blob, name) {
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
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
  /* confirm(warnings) -> Promise<boolean>: спросить пользователя, если правки нельзя перенести один в один. */
  async function original(state, bytes, name, confirm, extra = []) {
    const wb = XlsxCompat.workbook(bytes);
    const { layout } = Reader.matrix(wb, name);
    const base = new Map(state.baseline.map((b) => [b.id, b]));
    const book = await XlsxPatch.open(bytes);
    const warnings = [...extra];
    /* Новые пары: оформление клетки берём у похожей пары из исходного файла (та же форма — вся группа или подгруппа). */
    const added = new Set();
    for (const l of state.lessons) {
      if (!l.added || l.cancelled) continue;
      const slot = layout[l.date + "|" + l.groups[0]];
      const same = (b) => b.source?.sheet && b.period !== null && b.subgroup === l.subgroup;
      const T =
        state.baseline.find((b) => same(b) && slot && b.source.sheet === slot.sheet && origin(b).base === slot.base) ||
        state.baseline.find((b) => same(b) && slot && b.source.sheet === slot.sheet) ||
        state.baseline.find(same);
      if (!T) {
        warnings.push(`«${label(l)}»: не нашлось образца оформления, новая пара в файл не запишется`);
        continue;
      }
      base.set(l.id, { ...T, id: l.id, subject: "\u0000", teacher: "\u0000", room: "\u0000" });
      added.add(l.id);
    }
    const target = (l) => {
      const slot = layout[l.date + "|" + l.groups[0]];
      const before = l.period === null;
      const r = slot?.rows[before ? "before" : String(l.period)];
      return slot && r ? { sheet: slot.sheet, r, base: slot.base, h: before ? 1 : 2 } : null;
    };
    const home = (b) => ({ ...origin(b), h: b.period === null ? 1 : 2 });
    /* где занятие окажется в файле: новое место или, если его нет, прежнее */
    const place = new Map();
    const plan = [];
    for (const l of state.lessons) {
      const b = base.get(l.id);
      if (!b?.source?.sheet || !b.source.cell) continue;
      const isNew = added.has(l.id);
      const moved =
        isNew ||
        b.date !== l.date ||
        b.period !== l.period ||
        b.subgroup !== l.subgroup ||
        b.groups.join("|") !== l.groups.join("|");
      const edited =
        fields.some((k) => (b[k] || "") !== (l[k] || "")) || !!l.cancelled !== !!b.cancelled;
      let to = moved ? target(l) : home(b);
      if (!to && isNew) {
        warnings.push(`«${label(l)}»: у группы в файле нет такой пары — новая пара в файл не запишется`);
        continue;
      }
      if (!to) {
        warnings.push(`«${label(l)}»: у группы в файле нет такой пары — занятие останется на прежнем месте`);
        to = home(b);
      }
      place.set(l.id, to);
      if (moved || edited) plan.push({ l, b, to, isNew, moved: isNew || keyOf(to) !== keyOf(home(b)) });
    }
    if (!plan.length) {
      save(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), name);
      return 0;
    }
    /* клетки, где меняется расклад, собираются заново из кусков исходного файла */
    const touched = new Map();
    for (const p of plan)
      if (p.moved) {
        if (!p.isNew) {
          const h = home(p.b);
          touched.set(keyOf(h), h);
        }
        touched.set(keyOf(p.to), p.to);
      }
    const occupants = new Map([...touched.keys()].map((k) => [k, []]));
    for (const l of state.lessons) {
      const t = place.get(l.id);
      if (t && !l.cancelled && occupants.has(keyOf(t))) occupants.get(keyOf(t)).push(l);
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
    const dropped = new Set();
    const layoutOf = new Map();
    for (const [k, slot] of touched) {
      /* переехавшие сюда занятия важнее тех, что стояли раньше */
      const list = occupants
        .get(k)
        .sort(
          (a, b) =>
            Number(added.has(b.id) || keyOf(home(base.get(b.id))) !== k) -
            Number(added.has(a.id) || keyOf(home(base.get(a.id))) !== k),
        );
      const cols = new Map();
      for (const l of list) {
        const sh = shape(base.get(l.id));
        const span = [...Array(sh.w).keys()].map((j) => sh.dc + j);
        const busy = span.map((j) => cols.get(j)).find(Boolean);
        if (busy) {
          dropped.add(l.id);
          warnings.push(`В одной клетке оказались «${label(busy)}» и «${label(l)}». В файл запишется только первое, второе пропадёт из файла`);
          continue;
        }
        span.forEach((j) => cols.set(j, l));
      }
      layoutOf.set(k, list.filter((l) => !dropped.has(l.id)));
    }
    for (const { l, b, to } of plan)
      if (!l.cancelled && !dropped.has(l.id) && to.h === 1 && b.period !== null && (l.teacher || ""))
        warnings.push(`«${label(l)}» стоит на месте «Разговора о важном»: строки для преподавателя там нет, фамилия ${l.teacher} в файл не запишется`);
    if (warnings.length && confirm && !(await confirm(warnings))) return null;
    for (const [k, slot] of touched) {
      const sheet = await book.sheet(slot.sheet);
      sheet.clearRect(slot.r, slot.base, slot.h, 6);
      for (const l of layoutOf.get(k)) {
        const sh = shape(base.get(l.id)),
          piece = pieces.get(l.id);
        const clipped = {
          ...piece,
          cells: piece.cells.filter((c) => c.i < slot.h),
          merges: piece.merges
            .filter((m) => m.r1 < slot.h)
            .map((m) => ({ ...m, r2: Math.min(m.r2, slot.h - 1) }))
            .filter((m) => m.r1 !== m.r2 || m.c1 !== m.c2),
        };
        sheet.paste(clipped, slot.r, slot.base + sh.dc);
      }
    }
    /* текст правок: дисциплина, преподаватель, кабинет на новом месте */
    for (const { l, b, to } of plan) {
      if (dropped.has(l.id)) continue;
      if (l.cancelled) {
        /* «окно»: стираем текст пары, оформление клетки остаётся */
        if (!touched.has(keyOf(to))) {
          const sh = shape(b);
          (await book.sheet(to.sheet)).clearValues(to.r, to.base + sh.dc, to.h, sh.w);
        }
        continue;
      }
      const sheet = await book.sheet(to.sheet),
        sh = shape(b),
        col = to.base + sh.dc;
      if ((b.subject || "") !== (l.subject || "")) sheet.setValue(to.r, col, l.subject);
      if (to.h === 2 && (b.teacher || "") !== (l.teacher || "")) sheet.setValue(to.r + 1, col, l.teacher);
      if (added.has(l.id) && to.h === 2) {
        /* у новой пары дисциплина и преподаватель записываются всегда, даже пустые */
        sheet.setValue(to.r, col, l.subject);
        sheet.setValue(to.r + 1, col, l.teacher);
      }
      if ((b.room || "") !== (l.room || "")) {
        let rc = col + 1;
        if (sh.w === 6)
          rc = !sheet.hasValue(to.r, to.base + 4) && sheet.hasValue(to.r, to.base + 5) ? to.base + 5 : to.base + 4;
        sheet.setValue(to.r, rc, l.room);
      }
    }
    const blob = await book.save();
    save(blob, name.replace(/\.xlsx$/i, "") + " (изменено).xlsx");
    return plan.length;
  }
  return { table, original, save, excel: table };
})();

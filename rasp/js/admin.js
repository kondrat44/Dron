/* Учебная часть: загрузить Excel недели и опубликовать его для студентов.
   Публикация = запись файла data/schedule.json в репозиторий через GitHub. Ключ хранится только в этом браузере. */
window.Admin = (() => {
  const C = window.RASP;
  const API = `https://api.github.com/repos/${C.owner}/${C.repo}`;
  let U = null; // помощники из app.js
  let draft = null; // разобранный Excel, готовый к публикации
  let published = null; // { file, sha } — что сейчас лежит на сайте
  const key = () => U.LS.get("rasp-key");

  async function gh(path, opt = {}, k) {
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), 45000);
    let r;
    try {
      r = await fetch(API + path, {
        ...opt,
        cache: "no-store",
        signal: stop.signal,
        headers: {
          Authorization: "Bearer " + (k || key()),
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(opt.body ? { "Content-Type": "application/json" } : {}),
          ...(opt.headers || {}),
        },
      });
    } catch {
      throw Error("Нет связи с GitHub — проверьте интернет");
    } finally {
      clearTimeout(timer);
    }
    if (r.status === 401) throw Object.assign(Error("Ключ не подходит или отключён"), { code: 401 });
    if (r.status === 403) throw Object.assign(Error("У ключа нет права менять расписание"), { code: 403 });
    return r;
  }
  const b64 = (text) => {
    const bytes = new TextEncoder().encode(text);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const unb64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
  async function checkKey(k) {
    const r = await gh("", {}, k);
    if (!r.ok) throw Error("Не удалось проверить ключ (" + r.status + ")");
    const j = await r.json();
    if (j.permissions && j.permissions.push === false) throw Error("У ключа нет права менять расписание");
  }
  async function readPublished() {
    const r = await gh(`/contents/${C.path}?ref=${C.branch}`);
    if (r.status === 404) return { file: { v: 1, editions: [] }, sha: null };
    if (!r.ok) throw Error("Не удалось прочитать опубликованное расписание (" + r.status + ")");
    const meta = await r.json();
    const b = await gh(`/git/blobs/${meta.sha}`);
    if (!b.ok) throw Error("Не удалось прочитать опубликованное расписание (" + b.status + ")");
    let file;
    try {
      file = JSON.parse(unb64((await b.json()).content));
    } catch {
      file = { v: 1, editions: [] };
    }
    return { file, sha: meta.sha };
  }
  async function writePublished(file, sha, message) {
    const r = await gh(`/contents/${C.path}`, {
      method: "PUT",
      body: JSON.stringify({ message, content: b64(JSON.stringify(file)), branch: C.branch, ...(sha ? { sha } : {}) }),
    });
    if (r.status === 409 || r.status === 422) throw Object.assign(Error("Расписание только что изменили с другого компьютера"), { code: 409 });
    if (!r.ok) throw Error("Не удалось опубликовать (" + r.status + ")");
    return (await r.json()).content.sha;
  }

  /* ---------- проверки файла ---------- */
  /* mode: "new" — расписание на неделю, которой ещё нет на сайте (видно сразу);
     "edit" — исправленный файл уже опубликованной недели: студенты увидят вечером в C.notifyHour:00 (до этого — серым «не видно студентам»);
       в notifyHour:00 вступает в силу само, у студентов на телефонах — компьютер учебной части для этого не нужен; если позже — сразу;
     "urgent" — срочные изменения уже опубликованной недели (видно сразу) */
  const MODE = { new: "Новое расписание", edit: "Изменить расписание", urgent: "Срочные изменения расписания" };
  const isChange = (m) => m === "edit" || m === "urgent";
  /* плановые изменения вступают в силу вечером в C.notifyHour:00 по Кемерово (если позже — сразу) */
  const NH = C.notifyHour || 18;
  const AT = "в " + NH + ":00";
  const TZ = 7; // Кемерово
  const kemDay = (n) => new Date(n.getTime() + TZ * 3600e3).toISOString().slice(0, 10);
  const beforeEvening = (n) => new Date(n.getTime() + TZ * 3600e3).getUTCHours() < NH;
  /* когда студенты увидят публикацию */
  const hh = (h) => String(h).padStart(2, "0") + ":00";
  const kemAt = (day, hm) => new Date(`${day}T${hm}:00+07:00`);
  const kemHM = (d) => new Date(d.getTime() + TZ * 3600e3).toISOString().slice(11, 16);
  const addD = (day, k) => {
    const d = new Date(day + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + k);
    return d.toISOString().slice(0, 10);
  };
  /* неделя, которую студенты ещё не видят: время публикации выбирает учебная часть.
     По умолчанию — то, что уже назначено, иначе суббота перед неделей в C.notifyHour:00 (если ещё не прошла), иначе сразу */
  function defaultWhen(info, n) {
    if (info.pending) return info.pending.visibleFrom;
    const sat = kemAt(addD(info.week, -2), hh(NH));
    return sat > n ? sat.toISOString() : null;
  }
  function visibleFrom(mode, n, d) {
    if (d && d.info.sched) return d.when && new Date(d.when) > n ? new Date(d.when) : new Date(n);
    if (mode === "edit" && beforeEvening(n)) return new Date(`${kemDay(n)}T${String(NH).padStart(2, "0")}:00:00+07:00`);
    return new Date(n);
  }
  /* издания недели: что видят студенты сейчас (visible) и что ждёт вечера (pending) */
  function weekState(file, week, nowIso) {
    const list = ((file && file.editions) || []).filter((e) => e.week === week).sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
    const vis = list.filter((e) => e.visibleFrom <= nowIso);
    const pend = list.filter((e) => e.visibleFrom > nowIso);
    return { visible: vis[vis.length - 1] || null, pending: pend[pend.length - 1] || null, pendAll: pend };
  }
  function inspect(data, file, mode, short) {
    const lessons = data.lessons;
    const groups = [...new Set(lessons.flatMap((l) => l.groups))];
    const dates = [...new Set(lessons.map((l) => l.date))].sort();
    const stop = [],
      warn = [];
    if (!lessons.length) stop.push("В файле не найдено ни одной пары. Это точно расписание недели из программы учебной части?");
    if (lessons.length && lessons.length < 200) warn.push(`В файле мало пар: ${lessons.length}. Обычно их больше тысячи.`);
    if (lessons.length && groups.length < 10) warn.push(`В файле мало групп: ${groups.length}.`);
    const week = dates.length ? Pack.mondayOf(dates[0]) : "";
    if (dates.length && Pack.mondayOf(dates[dates.length - 1]) !== week) warn.push("В файле дни из разных недель.");
    const days = new Set(dates.map((d) => new Date(d + "T12:00:00").getDay()));
    const miss = [1, 2, 3, 4, 5, 6].filter((d) => !days.has(d));
    if (dates.length && miss.length) warn.push("Нет пар в эти дни: " + miss.map((d) => U.DAY_S[d]).join(", ") + ". Если это праздник или выходной — всё в порядке.");
    const today = U.now().toLocaleDateString("sv");
    if (dates.length && dates[dates.length - 1] < today) warn.push("Эта неделя уже прошла: " + U.dm(dates[0]) + "–" + U.dm(dates[dates.length - 1]) + ".");
    /* сравнение с тем, что уже опубликовано */
    const eds = ((file && file.editions) || []).slice().sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
    const same = eds.filter((e) => e.week === week).pop() || null;
    const last = same || eds[eds.length - 1] || null;
    const sortG = (a) => a.sort((x, y) => x.localeCompare(y, "ru", { numeric: true }));
    const listG = (a) => (a.length > 12 ? sortG(a).slice(0, 12).join(", ") + ` и ещё ${a.length - 12}` : sortG(a).join(", "));
    /* файл одного отделения: группы, которых в файле нет, остаются как были в опубликованной неделе */
    const fileGroups = new Set(groups);
    /* что видят студенты и что ждёт вечера: «Изменить» строится на последнем загруженном (в т.ч. ждущем),
       сразу видимое (срочное, другое отделение) — на том, что студенты видят сейчас, а ждущее вечера пересобирается с этим файлом */
    const ws = weekState(file, week, U.now().toISOString());
    const keepOf = (ed) => (ed ? Pack.unpack(ed).filter((l) => l.groups.every((g) => !fileGroups.has(g))) : []);
    const withKeep = (ed) => {
      const k = keepOf(ed);
      return k.length ? { ...data, lessons: data.lessons.concat(k.map((l) => ({ date: l.date, period: l.period, groups: l.groups, subgroup: l.sub, subject: l.subject, teacher: l.teacher, room: l.room, start: l.start, end: l.end }))) } : data;
    };
    const base = mode === "edit" ? same : ws.visible || same;
    const keep = keepOf(same);
    const kept = [...new Set(keep.flatMap((l) => l.groups))];
    const overlap = same ? same.T.g.filter((g) => fileGroups.has(g)) : [];
    const merged = withKeep(base);
    /* неделя ещё не видна студентам: новый файл просто заменяет загруженный раньше */
    const pendingMerged = mode !== "edit" && ws.visible && ws.pending ? withKeep(ws.pending) : null;
    if (last && !same) {
      const was = new Set(last.T.g);
      const gone = [...was].filter((g) => !groups.includes(g));
      if (gone.length) warn.push((gone.length > 1 ? `В файле нет ${gone.length} групп, которые были в прошлый раз: ` : "В файле нет группы, которая была в прошлый раз: ") + listG(gone) + ". Если это файл одного отделения — остальные отделения потом можно добавить своими файлами.");
      if (lessons.length < last.L.length * 0.6 && !gone.length) warn.push(`Пар заметно меньше, чем в прошлый раз: ${lessons.length} вместо ${last.L.length}.`);
    }
    if (same && isChange(mode) && overlap.length && merged.lessons.length < same.L.length * 0.6) warn.push(`Пар заметно меньше, чем сейчас на сайте: ${merged.lessons.length} вместо ${same.L.length}.`);
    /* новое или изменение: проверяем, что кнопка нажата та */
    let switchTo = null,
      diff = null;
    const wk = dates.length ? U.dm(dates[0]) + "–" + U.dm(dates[dates.length - 1]) : "";
    /* «Новое расписание» на уже опубликованную неделю можно, если в файле другие группы (другое отделение) — добавляем */
    const adding = mode === "new" && same && !overlap.length;
    if (!stop.length && mode === "new" && same && !adding && ws.visible) {
      stop.push(`Расписание на неделю ${wk} уже опубликовано${overlap.length < groups.length ? ` (из этого файла уже есть ${overlap.length} групп из ${groups.length})` : ""}. Если это исправленный файл этой недели — опубликуйте его как изменение.`);
      switchTo = ["edit", "urgent"];
    }
    if (!stop.length && isChange(mode) && !same) {
      stop.push(`Неделя ${wk} ещё не опубликована — изменять нечего. Если это расписание на новую неделю — опубликуйте его как новое.`);
      switchTo = ["new"];
    }
    /* сокращённые дни: по умолчанию — как в уже опубликованном расписании этой недели */
    if (!short) short = ((same && same.short) || []).filter((d) => dates.includes(d));
    const sh = { short: short.filter((d) => dates.includes(d)).sort() };
    const shortAdded = same ? Pack.shortAdded(same, sh) : sh.short;
    const shortRemoved = same ? Pack.shortAdded(sh, same) : [];
    if (!stop.length && same) {
      const n = U.now().toISOString();
      const mine = Pack.unpack(Pack.edition(merged, { id: "draft", publishedAt: n, visibleFrom: n, short: sh.short }));
      const vsLast = Pack.diff(Pack.unpack(same), mine);
      /* показываем, что изменится у студентов (по сравнению с тем, что они видят сейчас) */
      diff = ws.visible && ws.visible !== same ? Pack.diff(Pack.unpack(ws.visible), mine) : vsLast;
      if (isChange(mode) && !vsLast.length && Pack.shortSame(same, sh)) stop.push("Этот файл ничем не отличается от последнего загруженного расписания недели " + wk + ". Публиковать нечего. Если нужно только отметить сокращённый день — поставьте галочку ниже.");
    }
    const live = !!ws.visible;
    const sched = !stop.length && !live && !!dates.length;
    return { groups, dates, week, stop, warn, same, switchTo, diff, short: sh.short, shortAdded, shortRemoved, merged, kept, adding, pending: ws.pending, pendingMerged, live, sched };
  }

  /* ---------- экран ---------- */
  const head = (t) => `<div class="sheet-head"><h2>${t}</h2><button class="x-btn" id="sheet-x" aria-label="Закрыть">×</button></div>`;
  function login(msg) {
    U.openSheet(
      head("Учебная часть") +
        `<p>Здесь публикуется расписание для студентов. Введите ключ учебной части — он нужен один раз на этом компьютере.</p>${msg ? `<div class="card bad"><p>${U.esc(msg)}</p></div>` : ""}<input class="inp" id="adm-key" type="password" autocomplete="off" placeholder="Ключ учебной части" aria-label="Ключ учебной части"><div class="actions"><button class="btn blue" id="adm-login">Войти</button><a class="btn" href="instrukciya-uchebnaya.docx" download="Инструкция для учебной части - Расписание КузТАГиС.docx">📄 Инструкция (Word)</a></div><p class="hint">Ключ хранится только в этом браузере и никуда, кроме GitHub, не отправляется. Не вводите его на чужих компьютерах.</p>`,
    );
    U.$("sheet-x").onclick = U.closeSheet;
    const go = async () => {
      const k = U.$("adm-key").value.trim();
      if (!k) return;
      U.$("adm-login").disabled = true;
      U.$("adm-login").textContent = "Проверяю…";
      try {
        await checkKey(k);
        U.LS.set("rasp-key", k);
        main();
      } catch (e) {
        login(e.message + ". Проверьте ключ и попробуйте ещё раз.");
      }
    };
    U.$("adm-login").onclick = go;
    U.$("adm-key").onkeydown = (e) => e.key === "Enter" && go();
    U.$("adm-key").focus();
  }
  const edLabel = (e) => `Неделя ${U.dm(e.dates[0] || e.week)}–${U.dm(e.dates[e.dates.length - 1] || e.week)}`;
  async function main(note) {
    U.openSheet(head("Учебная часть") + '<p class="hint">Проверяю опубликованное расписание…</p>');
    U.$("sheet-x").onclick = U.closeSheet;
    try {
      published = await readPublished();
    } catch (e) {
      if (e.code === 401 || e.code === 403) {
        U.LS.set("rasp-key", null);
        return login(e.message + ".");
      }
      published = null;
      note = { cls: "bad", text: e.message + ". Проверьте интернет." };
    }
    const nowIso = U.now().toISOString();
    /* в списке по каждой неделе: что видят студенты сейчас и серым — что ждёт вечера; заменённые старые не показываем */
    const all = published ? published.file.editions : [];
    /* неделя, которую студенты ещё совсем не видят */
    const st0 = (e) => !weekState(published.file, e.week, nowIso).visible;
    const eds = [...new Set(all.map((e) => e.week))]
      .sort()
      .reverse()
      .flatMap((w) => {
        const st = weekState(published.file, w, nowIso);
        return [...st.pendAll.slice().reverse(), st.visible].filter(Boolean);
      });
    U.openSheet(
      head("Учебная часть") +
        (note ? `<div class="card ${note.cls}"><p>${note.text}</p></div>` : "") +
        `<p>Сохраните Excel недели в программе учебной части, как обычно, и выберите, что делаете.</p><input type="file" id="adm-file" accept=".xlsx" hidden><div class="modes"><button class="mode blue" id="adm-new" ${published ? "" : "disabled"}><b>Новое расписание</b><small>На новую неделю. Сразу или в назначенное время, например в субботу в ${NH}:00</small></button><button class="mode" id="adm-edit" ${
          published && eds.length ? "" : "disabled"
        }><b>Изменить расписание</b><small>Исправленный файл этой недели. Студенты увидят вечером ${AT}, тогда же уведомление</small></button><button class="mode urgent" id="adm-urgent" ${
          published && eds.length ? "" : "disabled"
        }><b>Срочные изменения расписания</b><small>Исправленный файл этой недели. Студенты увидят сразу</small></button></div><div id="adm-draft"></div>` +
        `<details class="card" ${eds.length ? "open" : ""}><summary>Опубликовано сейчас: ${eds.length}</summary>${
          eds.length
            ? eds
                .map(
                  (e) =>
                    e.visibleFrom > nowIso
                      ? `<div class="ed pending"><div><b>${U.esc(edLabel(e))}</b><span class="ed-tag">Сейчас не видно студентам</span><small>${U.esc(e.source || "")}</small><small>Вступит в силу ${
                          kemDay(new Date(e.visibleFrom)) === kemDay(U.now()) ? "сегодня в " + kemHM(new Date(e.visibleFrom)) : U.esc(U.whenText(e.visibleFrom))
                        }, тогда же уведомление${st0(e) ? " «Новое расписание»" : ""}. Загружено ${U.esc(U.whenText(e.publishedAt))}</small></div><button class="btn danger" data-del="${U.esc(e.id)}">Убрать</button></div>`
                      : `<div class="ed"><div><b>${U.esc(edLabel(e))}</b><span class="ed-tag live">Сейчас у студентов</span><small>${U.esc(e.source || "")}</small><small>Видно студентам с ${U.esc(U.whenText(e.visibleFrom))}</small></div><button class="btn danger" data-del="${U.esc(e.id)}">Убрать</button></div>`,
                )
                .join("")
            : "<p>Пока ничего не опубликовано.</p>"
        }</details><details class="card" id="adm-visits"><summary>Посещаемость сайта</summary><div id="adm-vbox"><p class="hint">Загружаю…</p></div></details><div class="actions"><a class="btn" id="adm-doc" href="instrukciya-uchebnaya.docx" download="Инструкция для учебной части - Расписание КузТАГиС.docx">📄 Инструкция для учебной части (Word)</a><button class="btn" id="adm-out">Выйти (стереть ключ с этого компьютера)</button></div>`,
    );
    U.$("sheet-x").onclick = U.closeSheet;
    U.$("adm-out").onclick = () => {
      U.LS.set("rasp-key", null);
      draft = null;
      U.closeSheet();
      U.toast("Ключ стёрт с этого компьютера");
    };
    U.$("adm-visits").ontoggle = () => U.$("adm-visits").open && visits();
    let mode = "new";
    for (const m of Object.keys(MODE))
      U.$("adm-" + m).onclick = () => {
        mode = m;
        U.$("adm-file").click();
      };
    U.$("adm-file").onchange = (e) => {
      const f = e.target.files[0];
      e.target.value = "";
      if (f) parse(f, mode);
    };
    U.$("sheet").querySelectorAll("[data-del]").forEach(
      (b) =>
        (b.onclick = async () => {
          if (b.dataset.sure !== "1") {
            b.dataset.sure = "1";
            b.textContent = "Точно убрать?";
            return;
          }
          b.disabled = true;
          b.textContent = "Убираю…";
          try {
            const cur = await readPublished();
            const file = { v: 1, editions: cur.file.editions.filter((e) => e.id !== b.dataset.del) };
            await writePublished(file, cur.sha, "Расписание: публикация убрана учебной частью");
            await U.reload();
            main({ cls: "ok", text: "Публикация убрана. У студентов изменится через 1–2 минуты." });
          } catch (e) {
            main({ cls: "bad", text: U.esc(e.message) + ". Попробуйте ещё раз." });
          }
        }),
    );
    if (draft) showDraft();
  }
  /* посещаемость: счётчик на сервере уведомлений, смотреть можно только с ключом учебной части */
  async function visits() {
    const box = U.$("adm-vbox");
    if (!box) return;
    box.innerHTML = '<p class="hint">Загружаю…</p>';
    let j;
    try {
      const r = await fetch(C.push + "/visits", { headers: { Authorization: "Bearer " + key() }, cache: "no-store" });
      j = await r.json();
      if (!r.ok || !j.ok) throw Error(r.status === 401 ? "Ключ не подошёл" : "Сервер ответил " + r.status);
    } catch (e) {
      box.innerHTML = `<p class="hint">Не удалось загрузить: ${U.esc(e.message === "Failed to fetch" ? "нет связи" : e.message)}. <button class="link" id="adm-vre">Ещё раз</button></p>`;
      U.$("adm-vre").onclick = visits;
      return;
    }
    const byDay = Object.fromEntries(j.days.map((d) => [d.day, d]));
    const shift = (n) => {
      const d = new Date(j.today + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() - n);
      return d.toISOString().slice(0, 10);
    };
    const sum = (n) => {
      const s = { n: 0, u: 0, ios: 0, android: 0, pc: 0, other: 0, app: 0, days: 0 };
      for (let i = 0; i < n; i++) {
        const d = byDay[shift(i)];
        if (!d) continue;
        s.days++;
        for (const k of Object.keys(s)) if (k !== "days") s[k] += d[k] || 0;
      }
      return s;
    };
    const num = (x) => String(x).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    const t = sum(1), y = byDay[shift(1)] || { n: 0, u: 0 }, w = sum(7), m = sum(30);
    const tile = (label, a, b) => `<div class="vt"><small>${label}</small><b>${num(a)}</b><span>${b}</span></div>`;
    const pl = w.u ? w : sum(60);
    const pct = (x) => (pl.u ? Math.round((x / pl.u) * 100) : 0);
    const bar = (label, x) => `<div class="vbar"><span>${label}</span><i style="--w:${pct(x)}%"></i><b>${pct(x)}%</b></div>`;
    const first = j.days.length ? j.days[j.days.length - 1].day : j.today;
    box.innerHTML =
      `<div class="vtiles">${tile("Сегодня", t.n, "заходов · " + num(t.u) + " чел.")}${tile("Вчера", y.n, "заходов · " + num(y.u) + " чел.")}${tile("7 дней", w.n, "заходов · ~" + num(Math.round(w.u / 7)) + " чел. в день")}${tile("30 дней", m.n, "заходов")}</div>` +
      `<p>Всего разных телефонов и компьютеров: <b>${num(j.devices)}</b></p>` +
      `<h4>С чего заходят${w.u ? " (7 дней)" : ""}</h4>${bar("iPhone", pl.ios)}${bar("Android", pl.android)}${bar("Компьютер", pl.pc)}${pl.other ? bar("Другое", pl.other) : ""}` +
      `<p class="hint">Со значка на экране «Домой» (как приложение): ${pct(pl.app)}%</p>` +
      (() => {
        /* уведомления, которые не включились (7 дней) */
        let n = 0;
        const by = {};
        for (let i = 0; i < 7; i++) {
          const d = byDay[shift(i)];
          if (!d || !d.pe) continue;
          n += d.pe;
          for (const [k, v] of Object.entries(d.peb || {})) by[k] = (by[k] || 0) + v;
        }
        if (!n) return "";
        const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 6);
        return `<h4>Не включились уведомления (7 дней): ${n}</h4><ul class="pe-list">${top.map(([k, v]) => `<li>${U.esc(k)} — ${v}</li>`).join("")}</ul>`;
      })() +
      `<table class="vtab"><tr><th>День</th><th>Заходов</th><th>Чел.</th><th>iPhone</th><th>Android</th><th>ПК</th></tr>${Array.from({ length: 14 }, (_, i) => shift(i))
        .filter((d) => d >= first)
        .map((d) => {
          const x = byDay[d] || { n: 0, u: 0, ios: 0, android: 0, pc: 0 };
          return `<tr><td>${U.dm(d)}</td><td>${num(x.n)}</td><td>${num(x.u)}</td><td>${x.ios}</td><td>${x.android}</td><td>${x.pc}</td></tr>`;
        })
        .join("")}</table>` +
      `<p class="hint">Заход — открыли сайт (повторно считается через 30 минут). Человек — одно устройство за день. Считается с ${U.dm(first)}; имён и групп сервер не знает.</p>`;
  }
  async function parse(f, mode) {
    const box = U.$("adm-draft");
    box.innerHTML = '<p class="hint">Читаю файл…</p>';
    try {
      if (!/\.xlsx$/i.test(f.name)) throw Error("Нужен файл Excel (.xlsx)");
      const data = await Reader.read(f);
      /* «Ковалев Н. Т.» и «Ковалёв Н. Т.», «Швецов» и «Швецов Г. А.» — один преподаватель, как уже на сайте */
      const known = [...new Set(((published && published.file.editions) || []).flatMap((e) => e.T.t))];
      Reader.canonTeachers(data.lessons, known);
      draft = { data, name: f.name, mode, info: inspect(data, published && published.file, mode) };
      draft.short = draft.info.short;
      draft.when = draft.info.sched ? defaultWhen(draft.info, U.now()) : null;
      showDraft();
    } catch (e) {
      draft = null;
      box.innerHTML = `<div class="card bad"><h3>Файл не прочитан</h3><p>${U.esc(e.message || String(e))}</p><p>Нужен Excel недели в том же виде, в каком его выдаёт программа учебной части.</p></div>`;
    }
  }
  /* галочки «Сокращённый день»: перед праздником пары по 1 часу */
  function shortBlock(info) {
    if (!info.dates.length || info.switchTo) return "";
    const days = info.dates.filter((d) => ![0, 6].includes(U.at(d).getDay()));
    if (!days.length) return "";
    const bells = Model.withDefaults({}).bells.short;
    return `<div class="card short-days"><h3>Сокращённые дни</h3><p>Перед праздником пары идут по 1 часу. Отметьте такой день — студенты увидят время пар как в субботу.</p><div class="chips">${days
      .map((d) => `<label class="chip"><input type="checkbox" data-short="${d}" ${info.short.includes(d) ? "checked" : ""}><span>${U.DAY_S[U.at(d).getDay()]} ${U.dm(d)}</span></label>`)
      .join("")}</div><p class="hint">Время в сокращённый день: ${bells
      .slice(0, 6)
      .map((b, i) => `${i + 1} пара ${b[0]}–${b[1]}`)
      .join(" · ")}</p></div>`;
  }
  const pendNote = (info) => (info.pending ? ` Изменения других групп, которые ждут ${NH}:00, сохранятся и вступят в силу ${AT}.` : "");
  /* текст под выбором времени для недели, которую студенты ещё не видят */
  function whenNote(info, n) {
    const repl = info.pending ? ` Это заменит файл, загруженный ${U.esc(U.whenText(info.pending.publishedAt))}, который тоже ещё не видно студентам.` : "";
    if (draft.whenBad) return "<b>Укажите день и время</b> или выберите «Сразу».";
    const w = draft.when && new Date(draft.when);
    if (w && w <= n) return "Это время уже прошло — студенты увидят <b>сразу</b>, через 1–2 минуты. Всем подписанным придёт уведомление «Новое расписание»." + repl;
    if (w)
      return `До <b>${U.esc(U.whenText(draft.when))}</b> студенты эту неделю не видят, а у вас в списке она будет <b>серым — «Сейчас не видно студентам»</b>. В это время расписание появится у студентов само (компьютер можно выключить), всем подписанным придёт уведомление «Новое расписание». До этого файл можно заменить исправленным или убрать.${repl}`;
    return "Студенты увидят <b>сразу</b>, через 1–2 минуты. Всем подписанным придёт уведомление «Новое расписание»." + repl;
  }
  function showDraft() {
    const box = U.$("adm-draft");
    if (!box || !draft) return;
    const { data, name, info, mode } = draft;
    const n = U.now();
    const teachers = new Set(data.lessons.map((l) => l.teacher).filter(Boolean)).size;
    let diffHtml = "";
    const dd = (d) => `${U.DAY_S[U.at(d).getDay()]} ${U.dm(d)}`;
    const shortLines = info.shortAdded.map((d) => `<li><b>${dd(d)} — сокращённый день</b>, пары по 1 часу</li>`).concat(info.shortRemoved.map((d) => `<li><b>${dd(d)} — обычный день</b> (сокращённый отменён)</li>`));
    if (info.diff && !info.stop.length && !info.diff.length && shortLines.length) diffHtml = `<details class="card" open><summary>Что изменилось по сравнению с опубликованным</summary><ul>${shortLines.join("")}</ul></details>`;
    else if (info.adding && !info.stop.length) diffHtml = `<div class="card"><p>Неделя уже ${info.live ? "опубликована" : "загружена"} для других групп. Этот файл <b>добавится</b> к ней: ${info.groups.length} групп. Остальные ${info.kept.length} групп остаются как были.</p></div>`;
    else if (info.diff && !info.stop.length) {
      const d = info.diff;
      const line = (x) => {
        const who = x.l.groups.join(", ") + (x.l.sub ? " (" + x.l.sub + " подгр.)" : "");
        const h = `${U.DAY_S[U.at(x.l.date).getDay()]} ${U.dm(x.l.date)}, ${x.l.period ? x.l.period + " пара" : "до первой пары"}, ${who}: `;
        const v = (l) => [l.subject, l.teacher, l.room ? "ауд. " + l.room : ""].filter(Boolean).join(", ");
        return U.esc(h) + (x.type === "removed" ? `<b>снята</b> — <s>${U.esc(v(x.l))}</s>` : x.type === "new" ? `<b>новая</b> — ${U.esc(v(x.l))}` : `${U.esc(v(x.l))} <s>было: ${U.esc(v(x.old))}</s>`);
      };
      diffHtml = d.length
        ? `<details class="card" open><summary>Что изменилось по сравнению с ${info.live ? "опубликованным" : "загруженным раньше"}: ${d.length}</summary><ul>${shortLines.join("")}${d
            .slice(0, 60)
            .map((x) => `<li>${line(x)}</li>`)
            .join("")}</ul>${d.length > 60 ? `<p class="hint">…и ещё ${d.length - 60}.</p>` : ""}</details>`
        : `<div class="card"><p>Отличий от уже ${info.live ? "опубликованного" : "загруженного"} расписания этой недели нет.</p></div>`;
    } else if (!info.stop.length) diffHtml = '<div class="card"><p>Это новая неделя: раньше её не публиковали.</p></div>';
    box.innerHTML =
      `<p class="sub-h">${MODE[mode]}</p><div class="card ${info.stop.length ? "bad" : "ok"}"><h3>${U.esc(name)}</h3>${
        info.stop.length
          ? info.stop.map((x) => `<p>${U.esc(x)}</p>`).join("") +
            (info.switchTo
              ? `<div class="actions">${info.switchTo
                  .map((m) => `<button class="btn${m === "urgent" ? " red" : " blue"}" data-switch="${m}">${m === "edit" ? `Изменить (уведомление ${AT})` : m === "urgent" ? "Срочные изменения (сразу)" : "Опубликовать как новое"}</button>`)
                  .join("")}</div>`
              : "")
          : `<p>Неделя ${U.esc(U.dm(info.dates[0]))}–${U.esc(U.dm(info.dates[info.dates.length - 1]))} · групп: ${info.groups.length} · преподавателей: ${teachers} · занятий: ${data.lessons.length}</p>${
              info.kept.length && !info.adding ? `<p>Других групп в этом файле нет — их ${info.kept.length} групп остаются как были на сайте.</p>` : ""
            }${
              data.noTeachers ? "<p>В этом виде файла у пар нет преподавателей: студенты увидят предмет и кабинет; у физкультуры и иностранного языка — преподаватель из строк внизу листа.</p>" : ""
            }`
      }</div>` +
      shortBlock(info) +
      (info.warn.length ? `<div class="card warn"><h3>Проверьте</h3><ul>${info.warn.map((x) => `<li>${U.esc(x)}</li>`).join("")}</ul></div>` : "") +
      diffHtml +
      (info.stop.length
        ? ""
        : (info.sched
            ? `<div class="card when"><h3>Когда показать студентам</h3><div class="choice"><label><input type="radio" name="adm-whenr" value="now" ${draft.when ? "" : "checked"}> <span>Сразу, через 1–2 минуты</span></label><label><input type="radio" name="adm-whenr" value="at" ${
                draft.when ? "checked" : ""
              }> <span>В назначенное время</span></label></div><div class="when-at" id="adm-at" ${draft.when ? "" : "hidden"}><input class="inp" type="date" id="adm-wd" aria-label="День публикации" min="${kemDay(n)}" max="${U.esc(info.dates[info.dates.length - 1])}" value="${
                kemDay(new Date(draft.when || defaultWhen(info, n) || n))
              }"><input class="inp" type="time" id="adm-wt" aria-label="Время публикации" value="${draft.when ? kemHM(new Date(draft.when)) : hh(NH)}"></div><p id="adm-when">${whenNote(info, n)}</p></div>`
            : `<div class="card when"><p id="adm-when">${
            mode === "edit"
              ? beforeEvening(n)
                ? `До ${NH}:00 студенты видят прежнее расписание, а это будет в списке <b>серым — «Сейчас не видно студентам»</b>. <b>Сегодня ${AT}</b> оно вступит в силу само (компьютер можно выключить): студенты увидят изменения, тем, у кого поменялись пары, придёт уведомление, прежнее уберётся из списка. Если нужно показать сразу — нажмите «Срочные изменения расписания».${
                    info.pending ? ` Это заменит изменения, загруженные ${U.esc(U.whenText(info.pending.publishedAt))}, которые ещё ждали ${NH}:00.` : ""
                  }`
                : `Студенты увидят <b>сразу</b>, через 1–2 минуты. Уже позже ${NH}:00 — уведомление тем, у кого поменялись пары, придёт сразу.`
              : mode === "urgent"
                ? "Студенты увидят <b>сразу</b>, через 1–2 минуты. Тем, у кого поменялись пары, сразу придёт уведомление «Срочные изменения»." + pendNote(info)
                : "Студенты увидят <b>сразу</b>, через 1–2 минуты. Всем подписанным придёт уведомление «Новое расписание»." + pendNote(info)
          }</p></div>`) + `${
            info.warn.length ? '<div class="choice"><label><input type="checkbox" id="adm-sure"> <span>Я проверил замечания, файл правильный</span></label></div>' : ""
          }<div class="actions"><button class="btn blue" id="adm-publish" ${info.warn.length ? "disabled" : ""}>${
            info.sched ? "Опубликовать" : mode === "urgent" ? "Опубликовать срочно" : isChange(mode) ? "Опубликовать изменения" : "Опубликовать"
          }</button><button class="btn" id="adm-cancel">Отмена</button></div>`);
    box.querySelectorAll("[data-switch]").forEach(
      (b) =>
        (b.onclick = () => {
          draft.mode = b.dataset.switch;
          draft.info = inspect(data, published && published.file, draft.mode, draft.short);
          if (draft.info.sched && draft.when === null) draft.when = defaultWhen(draft.info, U.now());
          showDraft();
        }),
    );
    if (info.stop.length) box.insertAdjacentHTML("beforeend", '<div class="actions"><button class="btn" id="adm-cancel">Отмена</button></div>');
    box.querySelectorAll("[data-short]").forEach(
      (c) =>
        (c.onchange = () => {
          const d = c.dataset.short;
          draft.short = c.checked ? [...draft.short, d].sort() : draft.short.filter((x) => x !== d);
          draft.info = inspect(data, published && published.file, draft.mode, draft.short);
          showDraft();
        }),
    );
    if (info.sched) {
      const upd = () => {
        const at = box.querySelector('[name="adm-whenr"][value="at"]').checked;
        U.$("adm-at").hidden = !at;
        const d = U.$("adm-wd").value, t = U.$("adm-wt").value;
        draft.when = at && d && /^\d\d:\d\d$/.test(t) ? kemAt(d, t).toISOString() : null;
        draft.whenBad = at && !draft.when;
        U.$("adm-when").innerHTML = whenNote(draft.info, U.now());
      };
      box.querySelectorAll('[name="adm-whenr"]').forEach((r) => (r.onchange = upd));
      U.$("adm-wd").onchange = upd;
      U.$("adm-wt").onchange = upd;
      U.$("adm-wd").oninput = upd;
      U.$("adm-wt").oninput = upd;
    }
    if (U.$("adm-sure")) U.$("adm-sure").onchange = () => (U.$("adm-publish").disabled = !U.$("adm-sure").checked);
    if (U.$("adm-cancel"))
      U.$("adm-cancel").onclick = () => {
        draft = null;
        box.innerHTML = "";
      };
    if (U.$("adm-publish")) U.$("adm-publish").onclick = publish;
    box.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  async function publish() {
    const btn = U.$("adm-publish");
    const label0 = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Публикую…";
    const n = U.now();
    if (draft.info.sched && draft.whenBad) {
      btn.disabled = false;
      btn.textContent = label0;
      return U.toast("Укажите день и время публикации");
    }
    const sched = draft.info.sched;
    const from = visibleFrom(draft.mode, n, draft);
    const ed = Pack.edition(draft.info.merged || draft.data, { id: n.getTime().toString(36), publishedAt: n.toISOString(), visibleFrom: from.toISOString(), kind: draft.mode, short: draft.short });
    /* ждущее вечера той же недели заменяется: при «Изменить» — новым файлом, при сразу видимом — пересобранным с этим файлом */
    const pend = draft.info.pending && draft.info.pendingMerged;
    const ed2 = pend
      ? Pack.edition(draft.info.pendingMerged, { id: n.getTime().toString(36) + "p", publishedAt: new Date(n.getTime() + 1).toISOString(), visibleFrom: draft.info.pending.visibleFrom, kind: draft.info.pending.kind, short: draft.short })
      : null;
    const put = (file) => {
      const nowIso = n.toISOString();
      let f = { v: 1, editions: file.editions.filter((e) => !(e.week === ed.week && e.visibleFrom > nowIso)) };
      f = Pack.merge(f, ed, n.toLocaleDateString("sv"));
      return ed2 ? Pack.merge(f, ed2, n.toLocaleDateString("sv")) : f;
    };
    const label = edLabel(ed);
    try {
      for (let attempt = 0; ; attempt++) {
        const cur = await readPublished();
        try {
          await writePublished(put(cur.file), cur.sha, `Расписание: ${MODE[draft.mode].toLowerCase()}, ${label.toLowerCase()} (${draft.name})`);
          break;
        } catch (e) {
          if (e.code !== 409 || attempt >= 2) throw e;
        }
      }
      const m = draft.mode;
      const sd = (ed.short || []).map((d) => `${U.DAY_S[U.at(d).getDay()]} ${U.dm(d)}`);
      draft = null;
      await U.reload();
      main({
        cls: "ok",
        text:
          `<b>Опубликовано: ${U.esc(label)}${m === "urgent" ? " (срочные изменения)" : m === "edit" ? " (изменение)" : ""}.</b> ` +
          (sched
            ? from > n
              ? `Сейчас не видно студентам — появится ${U.esc(U.whenText(from.toISOString()))} само, компьютер можно выключить. Тогда же всем подписанным придёт уведомление «Новое расписание».`
              : "У студентов появится через 1–2 минуты. Подписанным придёт уведомление о новом расписании."
            : from > n
              ? `Сейчас не видно студентам — вступит в силу сегодня ${AT} само, компьютер можно выключить.`
              : "У студентов появится через 1–2 минуты.") +
          (sd.length ? ` Сокращённые дни (пары по 1 часу): ${U.esc(sd.join(", "))}.` : "") +
          (sched
            ? ""
            : m === "urgent"
            ? " Тем, у кого поменялись пары, сразу придёт уведомление, в приложении будет плашка «Изменения в расписании»."
            : m === "edit"
              ? from > n
                ? ` ${AT} у студентов появится плашка «Изменения в расписании», тем, у кого поменялись пары, придёт уведомление, а прежнее уберётся из списка.`
                : " В приложении будет плашка «Изменения в расписании». Уведомление тем, у кого поменялись пары, придёт сразу."
              : " Подписанным придёт уведомление о новом расписании."),
      });
    } catch (e) {
      if (e.code === 401 || e.code === 403) {
        U.LS.set("rasp-key", null);
        return login(e.message + ". Расписание не опубликовано.");
      }
      btn.disabled = false;
      btn.textContent = label0;
      U.toast("Не опубликовано: " + e.message);
      const box = U.$("adm-draft");
      box.insertAdjacentHTML("afterbegin", `<div class="card bad"><p>Не опубликовано: ${U.esc(e.message)}. Проверьте интернет и нажмите «Опубликовать» ещё раз.</p></div>`);
    }
  }
  function open(helpers) {
    U = helpers;
    key() ? main() : login();
  }
  return { open, inspect, _api: { readPublished, writePublished } };
})();

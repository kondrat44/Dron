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
     "edit" — исправленный файл уже опубликованной недели (студенты увидят в C.hour:00);
     "urgent" — срочные изменения уже опубликованной недели (видно сразу) */
  const MODE = { new: "Новое расписание", edit: "Изменить расписание", urgent: "Срочные изменения расписания" };
  const isChange = (m) => m === "edit" || m === "urgent";
  /* когда обычные изменения видны студентам: C.hour = 24 — в полночь (00:00 следующих суток) */
  const AT = C.hour >= 24 ? "в 00:00" : "сегодня в " + C.hour + ":00";
  /* когда студенты увидят публикацию */
  function visibleFrom(mode, n) {
    if (mode !== "edit") return new Date(n);
    const t = new Date(n);
    t.setHours(C.hour, 0, 0, 0);
    return t > n ? t : new Date(n); // уже позже C.hour:00 — показываем сразу
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
    if (last) {
      const was = new Set(last.T.g);
      const gone = [...was].filter((g) => !groups.includes(g));
      if (gone.length) warn.push((gone.length > 1 ? "В файле нет групп, которые были в прошлый раз: " : "В файле нет группы, которая была в прошлый раз: ") + gone.sort((a, b) => a.localeCompare(b, "ru", { numeric: true })).join(", ") + ".");
      if (lessons.length < last.L.length * 0.6) warn.push(`Пар заметно меньше, чем в прошлый раз: ${lessons.length} вместо ${last.L.length}.`);
    }
    /* новое или изменение: проверяем, что кнопка нажата та */
    let switchTo = null,
      diff = null;
    const wk = dates.length ? U.dm(dates[0]) + "–" + U.dm(dates[dates.length - 1]) : "";
    if (!stop.length && mode === "new" && same) {
      stop.push(`Расписание на неделю ${wk} уже опубликовано. Если это исправленный файл этой недели — опубликуйте его как изменение.`);
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
      diff = Pack.diff(Pack.unpack(same), Pack.unpack(Pack.edition(data, { id: "draft", publishedAt: n, visibleFrom: n, short: sh.short })));
      if (isChange(mode) && !diff.length && Pack.shortSame(same, sh)) stop.push("Этот файл ничем не отличается от последнего загруженного расписания недели " + wk + ". Публиковать нечего. Если нужно только отметить сокращённый день — поставьте галочку ниже.");
    }
    return { groups, dates, week, stop, warn, same, switchTo, diff, short: sh.short, shortAdded, shortRemoved };
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
    const eds = published ? published.file.editions.slice().sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)) : [];
    U.openSheet(
      head("Учебная часть") +
        (note ? `<div class="card ${note.cls}"><p>${note.text}</p></div>` : "") +
        `<p>Сохраните Excel недели в программе учебной части, как обычно, и выберите, что делаете.</p><input type="file" id="adm-file" accept=".xlsx" hidden><div class="modes"><button class="mode blue" id="adm-new" ${published ? "" : "disabled"}><b>Новое расписание</b><small>На новую неделю. Студенты увидят сразу</small></button><button class="mode" id="adm-edit" ${
          published && eds.length ? "" : "disabled"
        }><b>Изменить расписание</b><small>Исправленный файл этой недели. Студенты увидят ночью ${AT}</small></button><button class="mode urgent" id="adm-urgent" ${
          published && eds.length ? "" : "disabled"
        }><b>Срочные изменения расписания</b><small>Исправленный файл этой недели. Студенты увидят сразу</small></button></div><div id="adm-draft"></div>` +
        `<details class="card" ${eds.length ? "open" : ""}><summary>Опубликовано сейчас: ${eds.length}</summary>${
          eds.length
            ? eds
                .map(
                  (e) =>
                    `<div class="ed"><div><b>${U.esc(edLabel(e))}</b><small>${U.esc(e.source || "")}</small><small>${
                      e.visibleFrom > nowIso ? "Студенты увидят " + U.esc(U.whenText(e.visibleFrom)) : "Видно студентам с " + U.esc(U.whenText(e.visibleFrom))
                    }</small></div><button class="btn danger" data-del="${U.esc(e.id)}">Убрать</button></div>`,
                )
                .join("")
            : "<p>Пока ничего не опубликовано.</p>"
        }</details><div class="actions"><a class="btn" id="adm-doc" href="instrukciya-uchebnaya.docx" download="Инструкция для учебной части - Расписание КузТАГиС.docx">📄 Инструкция для учебной части (Word)</a><button class="btn" id="adm-out">Выйти (стереть ключ с этого компьютера)</button></div>`,
    );
    U.$("sheet-x").onclick = U.closeSheet;
    U.$("adm-out").onclick = () => {
      U.LS.set("rasp-key", null);
      draft = null;
      U.closeSheet();
      U.toast("Ключ стёрт с этого компьютера");
    };
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
  async function parse(f, mode) {
    const box = U.$("adm-draft");
    box.innerHTML = '<p class="hint">Читаю файл…</p>';
    try {
      if (!/\.xlsx$/i.test(f.name)) throw Error("Нужен файл Excel (.xlsx)");
      const data = await Reader.read(f);
      draft = { data, name: f.name, mode, info: inspect(data, published && published.file, mode) };
      draft.short = draft.info.short;
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
  function showDraft() {
    const box = U.$("adm-draft");
    if (!box || !draft) return;
    const { data, name, info, mode } = draft;
    const n = U.now();
    const from = visibleFrom(mode, n);
    const later = from > n;
    const teachers = new Set(data.lessons.map((l) => l.teacher).filter(Boolean)).size;
    let diffHtml = "";
    const dd = (d) => `${U.DAY_S[U.at(d).getDay()]} ${U.dm(d)}`;
    const shortLines = info.shortAdded.map((d) => `<li><b>${dd(d)} — сокращённый день</b>, пары по 1 часу</li>`).concat(info.shortRemoved.map((d) => `<li><b>${dd(d)} — обычный день</b> (сокращённый отменён)</li>`));
    if (info.diff && !info.stop.length && !info.diff.length && shortLines.length) diffHtml = `<details class="card" open><summary>Что изменилось по сравнению с опубликованным</summary><ul>${shortLines.join("")}</ul></details>`;
    else if (info.diff && !info.stop.length) {
      const d = info.diff;
      const line = (x) => {
        const who = x.l.groups.join(", ") + (x.l.sub ? " (" + x.l.sub + " подгр.)" : "");
        const h = `${U.DAY_S[U.at(x.l.date).getDay()]} ${U.dm(x.l.date)}, ${x.l.period ? x.l.period + " пара" : "до первой пары"}, ${who}: `;
        const v = (l) => [l.subject, l.teacher, l.room ? "ауд. " + l.room : ""].filter(Boolean).join(", ");
        return U.esc(h) + (x.type === "removed" ? `<b>снята</b> — <s>${U.esc(v(x.l))}</s>` : x.type === "new" ? `<b>новая</b> — ${U.esc(v(x.l))}` : `${U.esc(v(x.l))} <s>было: ${U.esc(v(x.old))}</s>`);
      };
      diffHtml = d.length
        ? `<details class="card" open><summary>Что изменилось по сравнению с опубликованным: ${d.length}</summary><ul>${shortLines.join("")}${d
            .slice(0, 60)
            .map((x) => `<li>${line(x)}</li>`)
            .join("")}</ul>${d.length > 60 ? `<p class="hint">…и ещё ${d.length - 60}.</p>` : ""}</details>`
        : '<div class="card"><p>Отличий от уже опубликованного расписания этой недели нет.</p></div>';
    } else if (!info.stop.length) diffHtml = '<div class="card"><p>Это новая неделя: раньше её не публиковали.</p></div>';
    box.innerHTML =
      `<p class="sub-h">${MODE[mode]}</p><div class="card ${info.stop.length ? "bad" : "ok"}"><h3>${U.esc(name)}</h3>${
        info.stop.length
          ? info.stop.map((x) => `<p>${U.esc(x)}</p>`).join("") +
            (info.switchTo
              ? `<div class="actions">${info.switchTo
                  .map((m) => `<button class="btn${m === "urgent" ? " red" : " blue"}" data-switch="${m}">${m === "edit" ? `Изменить (студенты увидят ${AT})` : m === "urgent" ? "Срочные изменения (сразу)" : "Опубликовать как новое"}</button>`)
                  .join("")}</div>`
              : "")
          : `<p>Неделя ${U.esc(U.dm(info.dates[0]))}–${U.esc(U.dm(info.dates[info.dates.length - 1]))} · групп: ${info.groups.length} · преподавателей: ${teachers} · занятий: ${data.lessons.length}</p>`
      }</div>` +
      shortBlock(info) +
      (info.warn.length ? `<div class="card warn"><h3>Проверьте</h3><ul>${info.warn.map((x) => `<li>${U.esc(x)}</li>`).join("")}</ul></div>` : "") +
      diffHtml +
      (info.stop.length
        ? ""
        : `<div class="card when"><p id="adm-when">${
            later
              ? `Студенты увидят <b>${AT}</b>${C.hour >= 24 ? " (в полночь)" : ""}. Если нужно раньше — нажмите «Срочные изменения расписания».`
              : mode === "edit"
                ? `Уже позже ${C.hour}:00 — студенты увидят сразу.`
                : "Студенты увидят <b>сразу</b>, через 1–2 минуты."
          }</p></div>${
            info.warn.length ? '<div class="choice"><label><input type="checkbox" id="adm-sure"> <span>Я проверил замечания, файл правильный</span></label></div>' : ""
          }<div class="actions"><button class="btn blue" id="adm-publish" ${info.warn.length ? "disabled" : ""}>${mode === "urgent" ? "Опубликовать срочно" : isChange(mode) ? "Опубликовать изменения" : "Опубликовать"}</button><button class="btn" id="adm-cancel">Отмена</button></div>`);
    box.querySelectorAll("[data-switch]").forEach(
      (b) =>
        (b.onclick = () => {
          draft.mode = b.dataset.switch;
          draft.info = inspect(data, published && published.file, draft.mode, draft.short);
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
    const from = visibleFrom(draft.mode, n);
    const later = from > n;
    const ed = Pack.edition(draft.data, { id: n.getTime().toString(36), publishedAt: n.toISOString(), visibleFrom: from.toISOString(), kind: draft.mode, short: draft.short });
    const label = edLabel(ed);
    try {
      for (let attempt = 0; ; attempt++) {
        const cur = await readPublished();
        try {
          await writePublished(Pack.merge(cur.file, ed, n.toLocaleDateString("sv")), cur.sha, `Расписание: ${MODE[draft.mode].toLowerCase()}, ${label.toLowerCase()} (${draft.name})`);
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
          (later ? `Студенты увидят ${AT}.` : "У студентов появится через 1–2 минуты.") +
          (sd.length ? ` Сокращённые дни (пары по 1 часу): ${U.esc(sd.join(", "))}.` : "") +
          (isChange(m) ? " Подписанным придёт уведомление, а в приложении будет плашка «Изменения в расписании»." : " Подписанным придёт уведомление о новом расписании."),
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

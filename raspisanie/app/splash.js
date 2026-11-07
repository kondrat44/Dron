/* Заставка: логотип КузТАГиС рисуется линиями на весь экран, ниже надпись, затем открывается программа.
   Всё векторное (SVG), поэтому на любом экране логотип чёткий, без пикселей. Клик или клавиша — пропустить. */
(() => {
  const L = window.LOGO;
  if (!L) return;
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const NS = "http://www.w3.org/2000/svg";
  const box = document.createElement("div");
  box.className = "splash";
  box.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", L.viewBox);
  svg.setAttribute("class", "splash-logo");
  const lines = document.createElementNS(NS, "g");
  lines.setAttribute("fill", "none");
  lines.setAttribute("stroke", L.color);
  lines.setAttribute("stroke-width", "0.9");
  lines.setAttribute("stroke-linejoin", "round");
  for (const d of L.parts) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    lines.appendChild(p);
  }
  const fill = document.createElementNS(NS, "path");
  fill.setAttribute("d", L.d);
  fill.setAttribute("fill", L.color);
  fill.setAttribute("fill-rule", "evenodd");
  fill.setAttribute("class", "splash-fill");
  svg.append(lines, fill);
  const title = document.createElement("div");
  title.className = "splash-title";
  title.textContent = "КузТАГиС";
  const sub = document.createElement("div");
  sub.className = "splash-sub";
  sub.textContent = "Расписание · Дорожное отделение";
  box.append(svg, title, sub);
  document.body.appendChild(box);
  document.documentElement.classList.add("splash-on");
  /* Ось логотипа — середина книжки под глобусом. Центрируем по ней, чтобы надпись стояла ровно под логотипом. */
  try {
    const bb = fill.getBBox();
    const boxes = [...lines.children].map((p) => p.getBBox());
    const bottom = Math.max(...boxes.map((q) => q.y + q.height));
    const book = boxes.filter((q) => q.y > bottom - 45);
    const axis = (Math.min(...book.map((q) => q.x)) + Math.max(...book.map((q) => q.x + q.width))) / 2;
    const half = Math.max(axis - bb.x, bb.x + bb.width - axis) + 2;
    svg.setAttribute("viewBox", `${axis - half} ${bb.y - 2} ${half * 2} ${bb.height + 4}`);
  } catch {}

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    box.classList.add("out");
    document.documentElement.classList.remove("splash-on");
    setTimeout(() => box.remove(), 600);
  };
  box.addEventListener("click", finish);
  addEventListener("keydown", finish, { once: true });

  if (reduce) {
    box.classList.add("static");
    setTimeout(finish, 900);
    return;
  }
  /* каждая линия «рисуется» от начала до конца (Web Animations — работает сразу при загрузке) */
  const paths = [...lines.children];
  const total = 1.7; // секунды на рисование
  paths.forEach((p, i) => {
    let len = 300;
    try {
      len = p.getTotalLength() || 300;
    } catch {}
    p.style.strokeDasharray = len;
    p.style.strokeDashoffset = len;
    const delay = (i / paths.length) * 500;
    try {
      p.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], {
        duration: total * 1000 - delay,
        delay,
        easing: "cubic-bezier(.45,.05,.3,1)",
        fill: "forwards",
      });
    } catch {
      p.style.strokeDashoffset = 0;
    }
  });
  requestAnimationFrame(() => box.classList.add("draw"));
  setTimeout(() => box.classList.add("filled"), total * 1000);
  setTimeout(() => box.classList.add("text"), total * 1000 + 150);
  setTimeout(finish, total * 1000 + 1500);
})();

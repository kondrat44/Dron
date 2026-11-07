/* Тема оформления: «как в системе» (по умолчанию), светлая или тёмная. Выбор хранится в этом браузере. */
window.Theme = (() => {
  const KEY = "kuztagis-theme";
  const mq = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null;
  const get = () => {
    try {
      return localStorage.getItem(KEY) || "light";
    } catch {
      return "light";
    }
  };
  const apply = () => {
    const v = get();
    const dark = v === "dark" || (v === "auto" && mq && mq.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  };
  const set = (v) => {
    try {
      localStorage.setItem(KEY, v);
    } catch {}
    apply();
  };
  if (mq) (mq.addEventListener ? mq.addEventListener("change", apply) : mq.addListener(apply));
  apply();
  /* Кнопка солнце/луна в шапке: переключает светлую и тёмную тему */
  const isDark = () => document.documentElement.dataset.theme === "dark";
  const toggle = () => set(isDark() ? "light" : "dark");
  const label = () => {
    const b = document.getElementById("theme-btn");
    if (!b) return;
    const t = isDark() ? "Светлая тема" : "Тёмная тема";
    b.title = t;
    b.setAttribute("aria-label", t);
  };
  /* обработчик на весь документ: кнопка работает, даже если шапку перерисовали */
  document.addEventListener("click", (e) => {
    if (!e.target.closest || !e.target.closest("#theme-btn")) return;
    document.documentElement.classList.add("theme-anim");
    toggle();
    label();
    setTimeout(() => document.documentElement.classList.remove("theme-anim"), 450);
    if (typeof window.render === "function" && document.querySelector("[data-theme-set]")) window.render();
  });
  if (mq) (mq.addEventListener ? mq.addEventListener("change", label) : mq.addListener(label));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", label);
  else label();
  return { get, set, apply, toggle };
})();

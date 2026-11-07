/* Тема оформления: «как в системе» (по умолчанию), светлая или тёмная. Выбор хранится в этом браузере. */
window.Theme = (() => {
  const KEY = "kuztagis-theme";
  const mq = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null;
  const get = () => {
    try {
      return localStorage.getItem(KEY) || "auto";
    } catch {
      return "auto";
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
  const bind = () => {
    const b = document.getElementById("theme-btn");
    if (!b) return;
    const label = () => {
      const t = isDark() ? "Светлая тема" : "Тёмная тема";
      b.title = t;
      b.setAttribute("aria-label", t);
    };
    b.onclick = () => {
      document.documentElement.classList.add("theme-anim");
      toggle();
      label();
      setTimeout(() => document.documentElement.classList.remove("theme-anim"), 450);
      if (window.render && document.querySelector("[data-theme-set]")) window.render();
    };
    label();
    if (mq) (mq.addEventListener ? mq.addEventListener("change", label) : mq.addListener(label));
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
  return { get, set, apply, toggle };
})();

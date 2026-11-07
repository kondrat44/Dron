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
  return { get, set, apply };
})();

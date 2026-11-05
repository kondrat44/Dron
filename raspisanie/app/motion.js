/* Animate only changed cards (two per exchange); never animate the whole data set. */
window.Motion = (() => {
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const options = { duration: 280, easing: "cubic-bezier(.22,.72,.25,1)" };
  const play = (element, frames) => {
    if (!reduced() && element?.animate) return element.animate(frames, options);
  };
  function capture(ids) {
    if (reduced()) return [];
    return ids.flatMap((id) => {
      const el = document.querySelector(`[data-lesson="${CSS.escape(id)}"]`);
      return el
        ? [{ id, rect: el.getBoundingClientRect(), ghost: el.cloneNode(true) }]
        : [];
    });
  }
  function exchange(snapshots) {
    for (const { id, rect, ghost } of snapshots) {
      const target = document.querySelector(
        `[data-lesson="${CSS.escape(id)}"]`,
      );
      if (!target) continue;
      const end = target.getBoundingClientRect();
      ghost.removeAttribute("data-lesson");
      ghost.classList.add("motion-ghost");
      Object.assign(ghost.style, {
        left: rect.left + "px",
        top: rect.top + "px",
        width: rect.width + "px",
        height: rect.height + "px",
      });
      document.body.append(ghost);
      target.style.visibility = "hidden";
      const animation = play(ghost, [
        { transform: "translate(0,0) scale(1.02)", opacity: 1 },
        {
          transform: `translate(${end.left - rect.left}px,${end.top - rect.top}px) scale(1)`,
          opacity: 1,
        },
      ]);
      const clean = () => {
        ghost.remove();
        target.style.visibility = "";
      };
      if (animation) animation.finished.then(clean, clean);
      else clean();
    }
  }
  return { reduced, play, capture, exchange };
})();

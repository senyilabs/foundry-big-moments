// The splash itself. Takes everything it shows as arguments, so dev/preview.html can render it
// without Foundry. It never blocks clicks: the game carries on underneath.

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
};

// moment: { kind, title, subtitle, img }
// Returns how long it stays up, so the queue knows when to play the next one.
export function showSplash(moment, { duration = 2800 } = {}) {
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const root = el("div", `big-moment bm-${moment.kind}`);
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  root.style.setProperty("--bm-duration", `${duration}ms`);

  root.append(el("div", "bm-flash"));
  const band = el("div", "bm-band");
  const inner = el("div", "bm-inner");
  band.append(inner);
  if (moment.img) {
    const portrait = el("div", "bm-portrait");
    const img = el("img");
    img.src = moment.img;
    img.alt = "";
    img.addEventListener("error", () => portrait.remove(), { once: true });
    portrait.append(img);
    inner.append(portrait);
  }
  const text = el("div", "bm-text");
  text.append(el("div", "bm-title", moment.title));
  if (moment.subtitle) text.append(el("div", "bm-sub", moment.subtitle));
  inner.append(text);
  root.append(band);

  document.body.append(root);
  setTimeout(() => root.remove(), reduced ? Math.min(duration, 1800) : duration);
  return (reduced ? Math.min(duration, 1800) : duration) + 150;
}

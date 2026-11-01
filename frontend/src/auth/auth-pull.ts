const RAT_SRC = "/mouse_big.png";
const RAT_ROTATE_DEG = 115;
const RAT_HEIGHT_RATIO = 0.34;
const PEEK = 80;
const OPEN_FROM_CLOSED = 0.35;
const CLOSE_FROM_OPEN = 0.65;
const FLING = 0.6;
const RUBBER = 0.25; 

type State = "closed" | "open";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`Не загрузилась картинка ${src}`));
    im.src = src;
  });
}

/** Находит рамку непрозрачных пикселей */
function opaqueBounds(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const d = ctx.getImageData(0, 0, w, h).data;
  let l = w, t = h, r = -1, b = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 12) {
        if (x < l) l = x;
        if (x > r) r = x;
        if (y < t) t = y;
        if (y > b) b = y;
      }
    }
  }
  return r < 0 ? null : { l, t, r: r + 1, b: b + 1 };
}

/** Поворачивает мышь и обрезает прозрачные поля: голова точно сверху */
async function prepareRat(): Promise<string> {
  const im = await loadImage(RAT_SRC);
  const k = Math.min(1, 720 / Math.max(im.naturalWidth, im.naturalHeight));
  const w = im.naturalWidth * k;
  const h = im.naturalHeight * k;
  const a = (RAT_ROTATE_DEG * Math.PI) / 180;
  const cw = Math.ceil(Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a)));
  const ch = Math.ceil(Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a)));
  const c = document.createElement("canvas");
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate(a);
  ctx.drawImage(im, -w / 2, -h / 2, w, h);
  const bb = opaqueBounds(ctx, cw, ch);
  if (!bb) return RAT_SRC;
  const out = document.createElement("canvas");
  out.width = bb.r - bb.l;
  out.height = bb.b - bb.t;
  out.getContext("2d")!.drawImage(c, bb.l, bb.t, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

export function initAuthPull() {
  const login = document.getElementById("login");
  const pull = document.getElementById("pull");
  const panel = document.getElementById("auth-panel");
  const rat = document.getElementById("pull-rat") as HTMLButtonElement | null;
  if (!login || !pull || !panel || !rat) return;
  const img = rat.querySelector("img");
  const closeBtn = panel.querySelector<HTMLButtonElement>(".sheet-close");

  let state: State = "closed";
  let scale = 1;
  let closedY = 0;
  let openY = 0;
  let y = 0;

  let dragging = false;
  let moved = false;
  let startPointerY = 0;
  let startY = 0;
  let startState: State = "closed";
  let lastY = 0;
  let lastT = 0;
  let vel = 0;

  const apply = () => {
    pull.style.transform = `translate(-50%, ${y}px) scale(${scale})`;
  };

  const animate = (on: boolean) => pull.classList.toggle("pull-anim", on);

  function layout() {
    if (login!.hidden) return;
    const w = panel!.offsetWidth;
    const h = panel!.offsetHeight;
    if (!w || !h) return;
    scale = Math.min(1, (innerHeight - 8) / h, (innerWidth - 8) / w);
    const vh = h * scale;
    closedY = -vh + PEEK;
    openY = 0;
    if (img) img.style.height = `${Math.round(h * RAT_HEIGHT_RATIO)}px`;
  }

  function settle() {
    layout();
    animate(false);
    y = state === "open" ? openY : closedY;
    apply();
  }

  function setState(next: State, animated: boolean) {
    state = next;
    login!.dataset.state = next;
    rat!.setAttribute("aria-expanded", String(next === "open"));
    if (next === "open") panel!.removeAttribute("inert");
    else panel!.setAttribute("inert", "");
    animate(animated);
    y = next === "open" ? openY : closedY;
    apply();
    if (next === "open" && animated) {
      setTimeout(() => {
        if (state === "open") {
          panel!.querySelector<HTMLInputElement>("input[name=username]")?.focus({ preventScroll: true });
        }
      }, 450);
    }
  }

  function reset() {
    layout();
    setState("closed", false);
  }

  rat.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    rat.setPointerCapture(e.pointerId);
    dragging = true;
    moved = false;
    startPointerY = lastY = e.clientY;
    startY = y;
    startState = state;
    lastT = performance.now();
    vel = 0;
    animate(false);
    login.classList.add("pulling");
  });

  rat.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dy = e.clientY - startPointerY;
    if (Math.abs(dy) > 4) moved = true;
    let ny = startY + dy;
    if (ny > openY) ny = openY + (ny - openY) * RUBBER;
    if (ny < closedY) ny = closedY + (ny - closedY) * RUBBER;
    y = ny;
    apply();
    const now = performance.now();
    const dt = now - lastT;
    if (dt > 0) vel = 0.7 * vel + 0.3 * ((e.clientY - lastY) / dt);
    lastY = e.clientY;
    lastT = now;
  });

  const release = () => {
    if (!dragging) return;
    dragging = false;
    login.classList.remove("pulling");
    if (!moved) {
      // обычный клик по мыши — она просто дёргается, подсказывая «тяни»
      animate(true);
      y = startY;
      apply();
      rat.classList.remove("tug");
      void rat.offsetWidth;
      rat.classList.add("tug");
      return;
    }
    const p = (y - closedY) / (openY - closedY);
    let target: State;
    if (vel > FLING) target = "open";
    else if (vel < -FLING) target = "closed";
    else if (startState === "closed") target = p > OPEN_FROM_CLOSED ? "open" : "closed";
    else target = p < CLOSE_FROM_OPEN ? "closed" : "open";
    setState(target, true);
  };
  rat.addEventListener("pointerup", release);
  rat.addEventListener("pointercancel", release);
  rat.addEventListener("animationend", () => rat.classList.remove("tug"));

  // клавиатура: Enter / Пробел на мыши открывает, Esc или «×» сворачивает
  rat.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setState("open", true);
    }
  });
  const collapse = () => {
    setState("closed", true);
    rat.focus({ preventScroll: true });
  };
  closeBtn?.addEventListener("click", collapse);
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || state !== "open" || login.hidden) return;
    const modal = document.getElementById("register-modal");
    if (modal && !modal.hidden) return;
    collapse();
  });

  window.addEventListener("resize", settle);
  // высота окна меняется вместе с содержимым (ошибки, шрифты) — подстраиваемся
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => {
      if (!dragging) settle();
    }).observe(panel);
  }

  // когда экран входа снова показывают (выход, разрыв связи) — мышь опять висит
  new MutationObserver(() => {
    if (!login.hidden) requestAnimationFrame(reset);
  }).observe(login, { attributes: true, attributeFilter: ["hidden"] });

  reset();
  window.addEventListener("load", reset);

  // мышь готовим асинхронно; пока не готова — невидима
  prepareRat()
    .catch(() => RAT_SRC)
    .then((src) => {
      if (img) img.src = src;
      rat.classList.add("ready");
      if (!dragging) settle();
    });
}
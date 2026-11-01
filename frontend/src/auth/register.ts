// @ts-ignore
import "./register.css";
import { http } from "../network/api";
import { trimTransparent } from "./trim-image";

const MARKUP = `
  <button type="button" class="reg-close" id="close-register" aria-label="Закрыть регистрацию">&times;</button>
  <div class="reg-stage">
    <div class="reg-ring">
      <div class="reg-form-wrap">
        <h1 class="auth-title">Регистрация</h1>
        <form id="reg-form" class="auth-form" novalidate>
          <input name="username" class="auth-input" placeholder="Придумайте имя" autocomplete="username" required maxlength="40">
          <input name="password" class="auth-input" type="password" placeholder="Придумайте пароль" autocomplete="new-password" required minlength="4">
          <input name="password2" class="auth-input" type="password" placeholder="Повторите пароль" autocomplete="new-password" required>
          <button type="submit" class="btn-primary">Создать аккаунт</button>
        </form>
          <p id="reg-notice" class="reg-note" role="status" aria-live="polite"></p>
          <button type="button" class="btn-link reg-back" id="reg-back">Уже есть аккаунт? Войти</button>
      </div>
    </div>
    <img class="reg-mouse" src="/nose-mouse.png" alt="" draggable="false">
    <img class="reg-cone" src="/konus.png" alt="" draggable="false">
  </div>
`;

export function initRegister() {
  const screen = document.createElement("section");
  // id оставлен прежним: auth-pull.ts по нему понимает, что регистрация открыта (Esc)
  screen.id = "register-modal";
  screen.hidden = true;
  screen.innerHTML = MARKUP;
  document.getElementById("app")!.append(screen);

  const form = screen.querySelector<HTMLFormElement>("#reg-form")!;
  const note = screen.querySelector<HTMLElement>("#reg-notice")!;
  const mouse = screen.querySelector<HTMLImageElement>(".reg-mouse")!;
  const openBtn = document.getElementById("open-register");
  void trimTransparent(mouse);
  const cone = screen.querySelector<HTMLImageElement>(".reg-cone");
  if (cone) void trimTransparent(cone);

  let closeTimer: number | undefined;

  const say = (text: string, kind: "" | "error" | "ok" = "") => {
    note.textContent = text;
    note.dataset.kind = kind;
  };

  function open() {
    clearTimeout(closeTimer);
    form.reset();
    say("");
    screen.hidden = false;
    screen.classList.remove("reg-in");
    void screen.offsetWidth; // перезапуск анимации появления
    screen.classList.add("reg-in");
    setTimeout(() => form.querySelector<HTMLInputElement>("input[name=username]")?.focus({ preventScroll: true }), 250);
  }

  function close(prefillLogin?: string) {
    clearTimeout(closeTimer);
    screen.hidden = true;
    const loginName = document.querySelector<HTMLInputElement>("#auth input[name=username]");
    if (prefillLogin && loginName) {
      loginName.value = prefillLogin;
      document.querySelector<HTMLInputElement>("#auth input[name=password]")?.focus({ preventScroll: true });
    } else {
      openBtn?.focus({ preventScroll: true });
    }
  }

  openBtn?.addEventListener("click", open);
  screen.querySelector("#close-register")!.addEventListener("click", () => close());
  screen.querySelector("#reg-back")!.addEventListener("click", () => close());

  // initRegister() вызывается после initAuthPull(), поэтому на Esc сначала отрабатывает
  // обработчик окна входа (он видит, что регистрация открыта, и ничего не сворачивает)
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !screen.hidden) close();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    const username = String(data.username ?? "").trim();

    if (username.length < 2) return say("Логин слишком короткий", "error");
    if (String(data.password ?? "").length < 4) return say("Пароль: минимум 4 символа", "error");
    if (data.password !== data.password2) return say("Пароли не совпадают", "error");

    say("Регистрация…");
    try {
      await http("/api/auth/register", { username, password: data.password });
      say("Аккаунт создан! Теперь войдите.", "ok");
      closeTimer = window.setTimeout(() => close(username), 1200);
    } catch (error) {
      say(String(error).replace(/^Error:\s*/, ""), "error");
    }
  });
}
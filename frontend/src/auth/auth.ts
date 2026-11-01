// @ts-ignore
import "./style.css";
import { initAuthPull } from "./auth-pull";
import { initRegister } from "./register";

export function initAuth() {
document.querySelector("#auth-root")!.outerHTML = `
  <section id="login" data-state="closed">
    <div id="pull">
      <div class="auth-sheet" id="auth-panel" inert>
        <button type="button" class="sheet-close" aria-label="Свернуть окно">&times;</button>
        <div class="sheet-stage">
          <div class="sheet-ring">
            <div class="sheet-form">
              <h1 class="auth-title">Авторизация</h1>
              <form id="auth" class="auth-form">
                <input name="username" class="auth-input" placeholder="Имя" aria-label="Имя" autocomplete="username" required>
                <input name="password" class="auth-input" type="password" placeholder="Пароль" aria-label="Пароль" autocomplete="current-password" required>
                <button type="submit" class="btn-primary">Войти</button>
              </form>
              <div class="auth-divider">
                <span>Или</span>
              </div>
              <button type="button" id="open-register" class="btn-register">Зарегистрироваться</button>
            </div>
          </div>
          <img class="fallen-mouse" src="/mouce_maskot.png" alt="" draggable="false">
        </div>
        <div class="auth-footer sheet-links">
            <p id="notice" role="status" aria-live="polite" hidden></p>
        </div>
      </div>
      <button type="button" id="pull-rat" class="pull-rat" aria-expanded="false" aria-controls="auth-panel" aria-label="Потяните мышку вниз, чтобы открыть вход">
        <img alt="" draggable="false">
        <span class="pull-hint">Потяни мышку вниз ↓</span>
      </button>
    </div>
  </section>
`;

// Инициализация анимаций
initAuthPull();
initRegister();
}

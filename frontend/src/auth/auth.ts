// @ts-ignore
import "./style.css";
import { initAuthPull } from "./auth-pull";
import { initRegister } from "./register";

// ТОЛЬКО HTML авторизации
document.querySelector("#app")!.innerHTML = `
  <canvas id="view" aria-label="Учебный город"></canvas>
  
  <section id="login" data-state="closed">
    <div id="pull">
      <div class="auth-sheet" id="auth-panel" inert>
        <button type="button" class="sheet-close" aria-label="Свернуть окно">&times;</button>
        <div class="sheet-stage">
          <div class="sheet-ring">
            <div class="sheet-form">
              <h1 class="auth-title">Авторизация</h1>
              <form id="auth" class="auth-form">
                <input name="username" class="auth-input" placeholder="Имя" autocomplete="username" required maxlength="40">
                <input name="password" class="auth-input" type="password" placeholder="Пароль" autocomplete="current-password" required>
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
            <p id="notice" hidden></p>
        </div>
      </div>
      <button type="button" id="pull-rat" class="pull-rat" aria-expanded="false" aria-controls="auth-panel" aria-label="Потяните мышку вниз, чтобы открыть вход">
        <img alt="" draggable="false">
        <span class="pull-hint">Потяни мышку вниз ↓</span>
      </button>
    </div>
  </section>
  
  
  <header>
    <div class="brand">АВТОШКОЛА <span>Говорящий город</span></div>
    <div id="connection">Нет подключения</div>
  </header>
  <aside id="diag" class="panel"></aside>
  <footer>
    <div id="hint">WASD — движение · Пробел — тормоз · E — выйти / сесть · мышь — обзор</div>
    <strong><span id="speed">0</span> <small>км/ч</small></strong>
  </footer>

  <section id="talk" class="panel" hidden>
    <button id="close-talk" class="close">×</button>
    <h2 id="sign-name">Знак-помощник</h2>
    <div id="messages" aria-live="polite"></div>
    <form id="ask"><input name="question" placeholder="Вопрос знаку…" maxlength="1000" required><button>Спросить</button></form>
  </section>
  <section id="chat" class="panel" hidden>
    <div id="chat-log" aria-live="polite"></div>
    <form id="chat-form"><input name="text" placeholder="Сообщение участникам" maxlength="500" required><button>↗</button></form>
  </section>

  <div id="feedback" role="status" hidden></div>
  <div id="preview-banner" hidden>ТЕСТ СЦЕНЫ · без сервера, ИИ, сохранений и мультиплеера <button id="leave-preview">Завершить</button></div>
`;

// Инициализация анимаций
initAuthPull();
initRegister();
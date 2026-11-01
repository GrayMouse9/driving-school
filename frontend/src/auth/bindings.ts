import { login, logout } from './actions';
import { notice } from '../ui/dom';

export function bindAuthentication(connect: () => Promise<void>, disconnect: () => void) {
  const authForm = document.getElementById('auth') as HTMLFormElement;
  const logoutBtn = document.getElementById('logout');

  authForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await login(Object.fromEntries(new FormData(authForm)));
      await connect();
    } catch (error) {
      notice(String(error).replace(/^Error:\s*/, ''));
    }
  });

  logoutBtn?.addEventListener('click', async () => {
    try {
      await logout();
      disconnect();
      notice('Вы вышли из аккаунта');
    } catch (error) {
      notice(String(error).replace(/^Error:\s*/, ''));
    }
  });
}

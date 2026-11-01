import { login, register, logout } from './actions';

export function bindAuthentication(connect: () => Promise<void>, disconnect: () => void) {
  const authForm = document.getElementById('auth') as HTMLFormElement;
  const reconnectBtn = document.getElementById('reconnect');
  const logoutBtn = document.getElementById('logout');

  authForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await login(Object.fromEntries(new FormData(authForm)));
      await connect();
    } catch (error) {
      console.error('Login failed:', error);
    }
  });

  reconnectBtn?.addEventListener('click', () => void connect());

  logoutBtn?.addEventListener('click', async () => {
    try {
      await logout();
      disconnect();
    } catch (error) {
      console.error('Logout failed:', error);
    }
  });
}
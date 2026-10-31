import { $, notice } from '../ui/dom';
import { login, register, logout } from './actions';
export function bindAuthentication(connect: () => Promise<void>, disconnect: () => void) {
    $('auth').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            await login(Object.fromEntries(new FormData($<HTMLFormElement>('auth'))));
            await connect();
        }
        catch (error) {
            notice(String(error));
        }
    });
    $('register').onclick = async () => {
        const form = $<HTMLFormElement>('auth');
        if (!form.reportValidity())
            return;
        try {
            await register(Object.fromEntries(new FormData(form)));
            notice('Учётная запись создана. Нажмите «Войти».');
        }
        catch (error) {
            notice(String(error));
        }
    };
    $('reconnect').onclick = () => void connect();
    $('logout').onclick = async () => {
        try {
            await logout();
            disconnect();
            notice('Вы вышли из аккаунта.');
        }
        catch (error) {
            notice(String(error));
        }
    };
}

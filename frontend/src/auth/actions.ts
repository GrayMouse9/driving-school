import { API, http } from '../network/api';
export type Credentials = Record<string, FormDataEntryValue>;
export function login(credentials: Credentials) {
    return http(`${API}/auth/login`, credentials);
}
export function register(credentials: Credentials) {
    return http(`${API}/auth/register`, credentials);
}
export function logout() {
    return http(`${API}/auth/logout`, {});
}

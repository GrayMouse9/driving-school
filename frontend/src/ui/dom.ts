export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export function notice(text: string) {
    $('notice').textContent = text;
    $('feedback').textContent = text;
    $('feedback').hidden = !text;
}
export function log(id: string, text: string) {
    const line = document.createElement('p');
    line.textContent = text;
    $(id).append(line);
    while ($(id).childElementCount > 30)
        $(id).firstElementChild?.remove();
    $(id).scrollTop = $(id).scrollHeight;
}

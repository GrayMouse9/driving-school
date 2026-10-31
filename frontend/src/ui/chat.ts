import { $ } from './dom';
import { requestId, type Network } from '../network/api';
export function bindChat(network: Network) {
    $('chat-form').addEventListener('submit', e => {
        e.preventDefault();
        const form = $<HTMLFormElement>('chat-form');
        const text = String(new FormData(form).get('text')).trim();
        if (text && network.send('chat_send', { text }, requestId()))
            form.reset();
    });
}

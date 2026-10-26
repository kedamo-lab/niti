import { handleApi } from './api.js';
import { assets } from './assets.js';

export default {
  async fetch(request, env) {
    const response = await handleApi(request, env);
    if (response) return response;
    const url = new URL(request.url);
    const filename = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const asset = Object.hasOwn(assets, filename) ? assets[filename] : null;
    const headers = {
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    };
    if (!asset) return new Response('Страница не найдена.', { status: 404, headers });
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response('Метод не поддерживается.', { status: 405, headers: { ...headers, allow: 'GET, HEAD' } });
    }
    return new Response(request.method === 'HEAD' ? null : asset.body, {
      headers: { ...headers, 'content-type': asset.type },
    });
  },
};

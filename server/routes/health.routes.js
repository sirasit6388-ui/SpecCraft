import { sendJson } from '../utils/api-response.js';

export function createHealthRoute() {
  return async function healthRoute(request, response) {
    const requestUrl = new URL(request.url, 'http://localhost');

    if (request.method !== 'GET' || requestUrl.pathname !== '/api/health') {
      return false;
    }

    sendJson(response, 200, {
      status: 'ok',
      service: 'pc-build-api',
      phase: 1
    });
    return true;
  };
}

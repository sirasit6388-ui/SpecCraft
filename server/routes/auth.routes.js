import {
  changePassword as changePasswordService,
  clearSessionCookie,
  createSessionCookie,
  getCurrentUser as getCurrentUserService,
  getSessionToken,
  loginUser as loginUserService,
  logoutUser as logoutUserService,
  registerUser as registerUserService
} from '../services/auth.service.js';
import { sendJson } from '../utils/api-response.js';
import { createLoginRateLimiter } from '../utils/login-rate-limiter.js';
import { readJsonBody } from '../utils/read-json-body.js';

export function createAuthRoutes(options = {}) {
  const getCurrentUser = options.getCurrentUser || getCurrentUserService;
  const changePassword = options.changePassword || changePasswordService;
  const loginUser = options.loginUser || loginUserService;
  const logoutUser = options.logoutUser || logoutUserService;
  const registerUser = options.registerUser || registerUserService;
  const loginRateLimiter = options.loginRateLimiter || createLoginRateLimiter();
  const registerRateLimiter = options.registerRateLimiter || createLoginRateLimiter({
    maxAttempts: 3,
    windowMs: 60 * 60 * 1000
  });

  return async function authRoutes(request, response) {
    const requestUrl = new URL(request.url, 'http://localhost');

    try {
      if (request.method === 'GET' && requestUrl.pathname === '/api/me') {
        const user = await getCurrentUser(request);
        sendJson(response, user ? 200 : 401, { user });
        return true;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/auth/logout') {
        await logoutUser(getSessionToken(request));
        sendJson(response, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
        return true;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/auth/change-password') {
        const user = await getCurrentUser(request);

        if (!user) {
          sendJson(response, 401, { error: 'Authentication required' });
          return true;
        }

        await changePassword(user.id, await readJsonBody(request));
        sendJson(response, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
        return true;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/auth/login') {
        const body = await readJsonBody(request);
        const loginKey = getLoginKey(request, body.username);

        if (!loginRateLimiter.consume(loginKey)) {
          sendJson(response, 429, {
            error: 'Too many login attempts',
            message: 'Please try again in 15 minutes'
          });
          return true;
        }

        const result = await loginUser(body);
        loginRateLimiter.reset(loginKey);
        sendJson(response, 200, { user: result.user }, { 'Set-Cookie': createSessionCookie(result.token) });
        return true;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/auth/register') {
        const body = await readJsonBody(request);

        if (!registerRateLimiter.consume(getRequestAddress(request))) {
          sendJson(response, 429, {
            error: 'Too many registration attempts',
            message: 'Please try again in 1 hour'
          });
          return true;
        }

        const result = await registerUser(body);
        sendJson(response, 201, { user: result.user }, { 'Set-Cookie': createSessionCookie(result.token) });
        return true;
      }
    } catch (error) {
      sendJson(response, error.code === 'REQUEST_BODY_TOO_LARGE' ? 413 : 400, {
        error: 'Authentication failed',
        message: error.message
      });
      return true;
    }

    return false;
  };
}

function getLoginKey(request, username) {
  return `${getRequestAddress(request)}:${String(username || '').trim().toLowerCase()}`;
}

function getRequestAddress(request) {
  const address = request.socket?.remoteAddress || request.headers?.['x-forwarded-for'] || 'unknown';
  return String(address).split(',')[0].trim();
}

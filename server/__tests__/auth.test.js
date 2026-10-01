import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAuthRoutes } from '../routes/auth.routes.js';
import {
  changePassword,
  contactEmailSchemaQuery,
  createPasswordHash,
  getCurrentUser,
  isValidEmail,
  normalizeEmail,
  parseCookies,
  registerUser,
  verifyPasswordHash
} from '../services/auth.service.js';
import { createLoginRateLimiter } from '../utils/login-rate-limiter.js';

test('password hashes verify matching passwords only', () => {
  const hash = createPasswordHash('secret123');

  assert.equal(verifyPasswordHash('secret123', hash), true);
  assert.equal(verifyPasswordHash('wrong', hash), false);
  assert.notEqual(hash, 'secret123');
});

test('parseCookies reads the pc_session cookie', () => {
  const cookies = parseCookies('theme=dark; pc_session=abc123; other=yes');

  assert.equal(cookies.pc_session, 'abc123');
  assert.equal(cookies.theme, 'dark');
});

test('registerUser always assigns the user role', async () => {
  let query = '';
  const result = await registerUser({
    username: 'new-admin-attempt',
    email: 'attempt@example.com',
    password: 'secret123',
    role: 'admin'
  }, {
    runQuery: async (sql) => {
      query = sql;
      return JSON.stringify({ id: 9, username: 'new-admin-attempt', role: 'user' });
    }
  });

  assert.match(query, /INSERT INTO users \(username, password_hash, role, contact_email\)\s+VALUES \('new-admin-attempt', '[^']+', 'user', 'attempt@example\.com'\)/);
  assert.equal(result.user.role, 'user');
});

test('registerUser requires a valid email and never touches the database without one', async () => {
  let called = false;
  const options = { runQuery: async () => { called = true; return '{}'; } };

  for (const email of [undefined, '', '   ', 'no-at-sign', 'a@b', 'a b@example.com', 'a@@example.com', `${'x'.repeat(250)}@example.com`]) {
    await assert.rejects(
      () => registerUser({ username: 'someone', email, password: 'secret123' }, options),
      /valid email address is required/,
      `ควรปฏิเสธอีเมล: ${String(email).slice(0, 20)}`
    );
  }

  assert.equal(called, false);
});

test('registerUser stores the email trimmed and lowercased, and escapes quotes in it', async () => {
  let query = '';
  await registerUser({ username: 'sam', email: "  Sam.O'Brien@Example.COM ", password: 'secret123' }, {
    runQuery: async (sql) => {
      query = sql;
      return JSON.stringify({ id: 3, username: 'sam', role: 'user' });
    }
  });

  assert.match(query, /'sam\.o\\'brien@example\.com'\);/);
  assert.equal(normalizeEmail("  Sam@Example.COM "), 'sam@example.com');
  assert.equal(isValidEmail('sam@example.com'), true);
  assert.equal(isValidEmail('sam@example'), false);
});

test('registerUser turns MySQL duplicate-key errors into short messages the page can match', async () => {
  const failWith = (message) => ({ runQuery: async () => { throw new Error(message); } });
  const input = { username: 'sam', email: 'sam@example.com', password: 'secret123' };

  await assert.rejects(
    () => registerUser(input, failWith("ERROR 1062 (23000) at line 5: Duplicate entry 'sam@example.com' for key 'users.contact_email'")),
    (error) => error.message === 'This email is already registered'
  );
  await assert.rejects(
    () => registerUser(input, failWith("ERROR 1062 (23000) at line 5: Duplicate entry 'sam' for key 'users.username'")),
    (error) => error.message === 'This username is already taken'
  );
  await assert.rejects(
    () => registerUser(input, failWith('ERROR 2002: cannot connect')),
    /cannot connect/
  );
});

test('contact_email migration adds a nullable UNIQUE column only when missing', () => {
  const sql = contactEmailSchemaQuery();

  assert.match(sql, /ADD COLUMN contact_email VARCHAR\(255\) NULL UNIQUE/);
  assert.match(sql, /COLUMN_NAME = 'contact_email'/);
  assert.match(sql, /SET @noop = 1/);
});

test('changePassword verifies the old password and clears every user session', async () => {
  const previousHash = createPasswordHash('old-secret');
  const queries = [];

  await changePassword(7, { currentPassword: 'old-secret', newPassword: 'new-secret' }, {
    runQuery: async (query) => {
      queries.push(query);
      return queries.length === 1 ? JSON.stringify([{ id: 7, passwordHash: previousHash }]) : '';
    }
  });

  assert.match(queries[1], /UPDATE users SET password_hash/);
  assert.match(queries[1], /DELETE FROM user_sessions WHERE user_id = 7/);
  await assert.rejects(
    () => changePassword(7, { currentPassword: 'wrong', newPassword: 'new-secret' }, {
      runQuery: async () => JSON.stringify([{ id: 7, passwordHash: previousHash }])
    }),
    /Current password is incorrect/
  );
});

test('POST /api/auth/login returns user and session cookie', async () => {
  let payload;
  const route = createAuthRoutes({
    loginUser: async (body) => {
      payload = body;
      return {
        token: 'session-token',
        user: { id: 4, username: 'bank', role: 'admin' }
      };
    }
  });
  const response = createMockResponse();
  const handled = await route(createJsonRequest('/api/auth/login', { username: 'bank', password: 'secret' }), response);
  const body = JSON.parse(response.body);

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.equal(payload.username, 'bank');
  assert.equal(body.user.role, 'admin');
  assert.match(response.headers['Set-Cookie'], /pc_session=session-token/);
  assert.match(response.headers['Set-Cookie'], /HttpOnly/);
  assert.match(response.headers['Set-Cookie'], /Max-Age=604800/);
});

test('POST /api/auth/change-password requires a signed-in user and clears the cookie', async () => {
  let changedUserId = 0;
  const route = createAuthRoutes({
    getCurrentUser: async () => ({ id: 12, username: 'bank', role: 'user' }),
    changePassword: async (userId, payload) => {
      changedUserId = userId;
      assert.equal(payload.currentPassword, 'old-secret');
    }
  });
  const response = createMockResponse();

  await route(createJsonRequest('/api/auth/change-password', { currentPassword: 'old-secret', newPassword: 'new-secret' }), response);

  assert.equal(response.statusCode, 200);
  assert.equal(changedUserId, 12);
  assert.match(response.headers['Set-Cookie'], /Max-Age=0/);
});

test('login route rejects oversized JSON bodies', async () => {
  const route = createAuthRoutes();
  const response = createMockResponse();
  const request = {
    ...createRequest('POST', '/api/auth/login'),
    async *[Symbol.asyncIterator]() {
      yield Buffer.from('x'.repeat(64 * 1024 + 1));
    }
  };

  await route(request, response);

  assert.equal(response.statusCode, 413);
  assert.match(JSON.parse(response.body).message, /too large/);
});

test('login route limits repeated password attempts and resets after a successful login', async () => {
  const rateLimiter = createLoginRateLimiter({ maxAttempts: 2, windowMs: 60000 });
  let shouldSucceed = false;
  const route = createAuthRoutes({
    loginRateLimiter: rateLimiter,
    loginUser: async () => {
      if (!shouldSucceed) {
        throw new Error('Invalid username or password');
      }

      return { token: 'fresh-token', user: { id: 3, username: 'bank', role: 'user' } };
    }
  });
  const headers = { 'x-forwarded-for': '127.0.0.1' };

  const firstResponse = createMockResponse();
  await route(createJsonRequest('/api/auth/login', { username: 'bank', password: 'wrong' }, headers), firstResponse);
  assert.equal(firstResponse.statusCode, 400);

  const secondResponse = createMockResponse();
  await route(createJsonRequest('/api/auth/login', { username: 'bank', password: 'wrong' }, headers), secondResponse);
  assert.equal(secondResponse.statusCode, 400);

  const blockedResponse = createMockResponse();
  await route(createJsonRequest('/api/auth/login', { username: 'bank', password: 'wrong' }, headers), blockedResponse);
  assert.equal(blockedResponse.statusCode, 429);

  const successfulLimiter = createLoginRateLimiter({ maxAttempts: 2, windowMs: 60000 });
  assert.equal(successfulLimiter.consume('127.0.0.1:bank'), true);
  const successfulRoute = createAuthRoutes({ loginRateLimiter: successfulLimiter, loginUser: async () => ({ token: 'fresh-token', user: { id: 3, username: 'bank', role: 'user' } }) });
  const successfulResponse = createMockResponse();
  await successfulRoute(createJsonRequest('/api/auth/login', { username: 'bank', password: 'correct' }, headers), successfulResponse);
  assert.equal(successfulResponse.statusCode, 200);
  assert.equal(successfulLimiter.consume('127.0.0.1:bank'), true);
  assert.equal(successfulLimiter.consume('127.0.0.1:bank'), true);
  assert.equal(successfulLimiter.consume('127.0.0.1:bank'), false);
});

test('login rate limiter allows attempts again after its time window expires', () => {
  const limiter = createLoginRateLimiter({ maxAttempts: 2, windowMs: 100 });

  assert.equal(limiter.consume('bank', 1000), true);
  assert.equal(limiter.consume('bank', 1001), true);
  assert.equal(limiter.consume('bank', 1002), false);
  assert.equal(limiter.consume('bank', 1100), true);
});

test('registration route limits account creation attempts by IP address', async () => {
  const rateLimiter = createLoginRateLimiter({ maxAttempts: 2, windowMs: 60000 });
  const route = createAuthRoutes({
    registerRateLimiter: rateLimiter,
    registerUser: async (body) => ({
      token: `token-${body.username}`,
      user: { id: 7, username: body.username, role: 'user' }
    })
  });
  const headers = { 'x-forwarded-for': '127.0.0.1' };
  const firstResponse = createMockResponse();
  const secondResponse = createMockResponse();
  const blockedResponse = createMockResponse();

  await route(createJsonRequest('/api/auth/register', { username: 'first', password: 'secret123' }, headers), firstResponse);
  await route(createJsonRequest('/api/auth/register', { username: 'second', password: 'secret123' }, headers), secondResponse);
  await route(createJsonRequest('/api/auth/register', { username: 'third', password: 'secret123' }, headers), blockedResponse);

  assert.equal(firstResponse.statusCode, 201);
  assert.equal(secondResponse.statusCode, 201);
  assert.equal(blockedResponse.statusCode, 429);
});

test('current user query ignores sessions older than seven days', async () => {
  let query = '';
  await getCurrentUser(createRequest('GET', '/api/me', { cookie: 'pc_session=expired-token' }), {
    runQuery: async (sql) => {
      query = sql;
      return '[]';
    }
  });

  assert.match(query, /created_at > DATE_SUB\(UTC_TIMESTAMP\(\), INTERVAL 604800 SECOND\)/);
  assert.match(query, /users\.is_active = 1/);
});

test('GET /api/me returns current session user', async () => {
  const route = createAuthRoutes({
    getCurrentUser: async () => ({ id: 3, username: 'user', role: 'user' })
  });
  const response = createMockResponse();
  const handled = await route(createRequest('GET', '/api/me'), response);

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).user.username, 'user');
});

test('POST /api/auth/logout clears the session cookie', async () => {
  let token;
  const route = createAuthRoutes({
    logoutUser: async (requestToken) => {
      token = requestToken;
    }
  });
  const response = createMockResponse();
  const handled = await route(createRequest('POST', '/api/auth/logout', { cookie: 'pc_session=old-token' }), response);

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.equal(token, 'old-token');
  assert.match(response.headers['Set-Cookie'], /Max-Age=0/);
});

function createJsonRequest(url, payload, headers = {}) {
  return {
    ...createRequest('POST', url, headers),
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(payload));
    }
  };
}

function createRequest(method, url, headers = {}) {
  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
    }
  };
}

function createMockResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = '') {
      this.body = body;
    }
  };
}

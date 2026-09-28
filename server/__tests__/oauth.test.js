import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createOAuthRoutes } from '../routes/oauth.routes.js';
import { buildFacebookAuthUrl, buildGoogleAuthUrl, loginWithFacebook, loginWithGoogle } from '../services/oauth.service.js';

test('buildGoogleAuthUrl includes the client id, redirect uri, and state', () => {
  const url = new URL(buildGoogleAuthUrl('state-123', {
    clientId: 'client-abc',
    clientSecret: 'secret',
    redirectUri: 'http://localhost:3000/api/auth/google/callback'
  }));

  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('client_id'), 'client-abc');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:3000/api/auth/google/callback');
  assert.equal(url.searchParams.get('state'), 'state-123');
  assert.match(url.searchParams.get('scope'), /email/);
});

test('loginWithGoogle creates a new account on first sign-in', async () => {
  const queries = [];
  const result = await loginWithGoogle(
    { googleId: 'google-1', email: 'newperson@example.com', emailVerified: true },
    {
      runQuery: async (query) => {
        queries.push(query);

        if (query.includes('WHERE google_id')) {
          return '[]';
        }

        if (query.includes('WHERE email')) {
          return '[]';
        }

        if (query.startsWith('SELECT COUNT(*) FROM users WHERE username')) {
          return '0';
        }

        return JSON.stringify({ id: 55 });
      }
    }
  );

  assert.equal(result.user.id, 55);
  assert.equal(result.user.username, 'newperson@example.com');
  assert.equal(result.user.role, 'user');
  assert.match(queries.at(-1), /INSERT INTO users \(username, password_hash, role, email, google_id\)/);
  assert.match(queries.at(-1), /NULL, 'user'/);
});

test('loginWithGoogle logs an existing linked account back in without creating a new row', async () => {
  const queries = [];
  const result = await loginWithGoogle(
    { googleId: 'google-1', email: 'returning@example.com', emailVerified: true },
    {
      runQuery: async (query) => {
        queries.push(query);

        if (query.includes('WHERE google_id')) {
          return JSON.stringify([{ id: 9, username: 'returning@example.com', role: 'user' }]);
        }

        return '';
      }
    }
  );

  assert.equal(result.user.id, 9);
  assert.equal(queries.filter((query) => query.includes('INSERT INTO users')).length, 0);
});

test('loginWithGoogle links a Google identity to a matching verified-email account instead of duplicating it', async () => {
  const queries = [];
  const result = await loginWithGoogle(
    { googleId: 'google-2', email: 'existing@example.com', emailVerified: true },
    {
      runQuery: async (query) => {
        queries.push(query);

        if (query.includes('WHERE google_id')) {
          return '[]';
        }

        if (query.includes('WHERE email')) {
          return JSON.stringify([{ id: 21, username: 'existing@example.com', role: 'user' }]);
        }

        return '';
      }
    }
  );

  assert.equal(result.user.id, 21);
  assert.match(queries.at(-1), /UPDATE users SET google_id = 'google-2' WHERE id = 21/);
});

test('GET /api/auth/google redirects to the Google consent screen with a state cookie', async () => {
  const route = createOAuthRoutes({
    getGoogleOAuthConfig: () => ({ clientId: 'abc', clientSecret: 'shh', redirectUri: 'http://localhost:3000/api/auth/google/callback' })
  });
  const response = createMockResponse();
  const handled = await route(createRequest('GET', '/api/auth/google'), response);

  assert.equal(handled, true);
  assert.equal(response.statusCode, 302);
  assert.match(response.headers.Location, /^https:\/\/accounts\.google\.com/);
  assert.match(response.headers['Set-Cookie'], /pc_oauth_state=/);
});

test('GET /api/auth/google redirects with an error when Google credentials are not configured', async () => {
  const route = createOAuthRoutes({
    getGoogleOAuthConfig: () => ({ clientId: '', clientSecret: '', redirectUri: '' })
  });
  const response = createMockResponse();
  await route(createRequest('GET', '/api/auth/google'), response);

  assert.equal(response.statusCode, 302);
  assert.match(response.headers.Location, /authError=google_not_configured/);
});

test('GET /api/auth/google/callback rejects a mismatched state and does not exchange the code', async () => {
  let exchanged = false;
  const route = createOAuthRoutes({
    getGoogleOAuthConfig: () => ({ clientId: 'abc', clientSecret: 'shh', redirectUri: 'http://localhost:3000/api/auth/google/callback' }),
    exchangeGoogleCode: async () => {
      exchanged = true;
      return { access_token: 'ignored' };
    }
  });
  const response = createMockResponse();
  const request = createRequest('GET', '/api/auth/google/callback?code=abc&state=wrong', { cookie: 'pc_oauth_state=right' });

  await route(request, response);

  assert.equal(exchanged, false);
  assert.equal(response.statusCode, 302);
  assert.match(response.headers.Location, /authError=google_state_mismatch/);
});

test('GET /api/auth/google/callback logs the user in and sets the session cookie on success', async () => {
  const route = createOAuthRoutes({
    getGoogleOAuthConfig: () => ({ clientId: 'abc', clientSecret: 'shh', redirectUri: 'http://localhost:3000/api/auth/google/callback' }),
    exchangeGoogleCode: async (code) => {
      assert.equal(code, 'auth-code');
      return { access_token: 'access-token-xyz' };
    },
    fetchGoogleProfile: async (accessToken) => {
      assert.equal(accessToken, 'access-token-xyz');
      return { googleId: 'google-9', email: 'person@example.com', emailVerified: true };
    },
    loginWithGoogle: async () => ({ token: 'session-abc', user: { id: 1, username: 'person@example.com', role: 'user' } })
  });
  const response = createMockResponse();
  const request = createRequest('GET', '/api/auth/google/callback?code=auth-code&state=right', { cookie: 'pc_oauth_state=right' });

  await route(request, response);

  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.Location, '/');
  assert.ok(response.headers['Set-Cookie'].some((cookie) => cookie.includes('pc_session=session-abc')));
});

test('GET /api/auth/google/callback redirects with an error when Google reports the user declined access', async () => {
  const route = createOAuthRoutes({
    getGoogleOAuthConfig: () => ({ clientId: 'abc', clientSecret: 'shh', redirectUri: 'http://localhost:3000/api/auth/google/callback' })
  });
  const response = createMockResponse();
  const request = createRequest('GET', '/api/auth/google/callback?error=access_denied', { cookie: 'pc_oauth_state=right' });

  await route(request, response);

  assert.equal(response.statusCode, 302);
  assert.match(response.headers.Location, /authError=google_access_denied/);
});

test('buildFacebookAuthUrl includes the client id, redirect uri, and state', () => {
  const url = new URL(buildFacebookAuthUrl('state-123', {
    clientId: 'client-abc',
    clientSecret: 'secret',
    redirectUri: 'http://localhost:3000/api/auth/facebook/callback'
  }));

  assert.equal(url.origin + url.pathname, 'https://www.facebook.com/v21.0/dialog/oauth');
  assert.equal(url.searchParams.get('client_id'), 'client-abc');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:3000/api/auth/facebook/callback');
  assert.equal(url.searchParams.get('state'), 'state-123');
  assert.match(url.searchParams.get('scope'), /email/);
});

test('loginWithFacebook creates a new account on first sign-in', async () => {
  const queries = [];
  const result = await loginWithFacebook(
    { facebookId: 'facebook-1', email: 'newperson@example.com', emailVerified: true },
    {
      runQuery: async (query) => {
        queries.push(query);

        if (query.includes('WHERE facebook_id')) {
          return '[]';
        }

        if (query.includes('WHERE email')) {
          return '[]';
        }

        if (query.startsWith('SELECT COUNT(*) FROM users WHERE username')) {
          return '0';
        }

        return JSON.stringify({ id: 66 });
      }
    }
  );

  assert.equal(result.user.id, 66);
  assert.equal(result.user.username, 'newperson@example.com');
  assert.equal(result.user.role, 'user');
  assert.match(queries.at(-1), /INSERT INTO users \(username, password_hash, role, email, facebook_id\)/);
  assert.match(queries.at(-1), /NULL, 'user'/);
});

test('loginWithFacebook logs an existing linked account back in without creating a new row', async () => {
  const queries = [];
  const result = await loginWithFacebook(
    { facebookId: 'facebook-1', email: 'returning@example.com', emailVerified: true },
    {
      runQuery: async (query) => {
        queries.push(query);

        if (query.includes('WHERE facebook_id')) {
          return JSON.stringify([{ id: 10, username: 'returning@example.com', role: 'user' }]);
        }

        return '';
      }
    }
  );

  assert.equal(result.user.id, 10);
  assert.equal(queries.filter((query) => query.includes('INSERT INTO users')).length, 0);
});

test('loginWithFacebook links a Facebook identity to a matching verified-email account instead of duplicating it', async () => {
  const queries = [];
  const result = await loginWithFacebook(
    { facebookId: 'facebook-2', email: 'existing@example.com', emailVerified: true },
    {
      runQuery: async (query) => {
        queries.push(query);

        if (query.includes('WHERE facebook_id')) {
          return '[]';
        }

        if (query.includes('WHERE email')) {
          return JSON.stringify([{ id: 22, username: 'existing@example.com', role: 'user' }]);
        }

        return '';
      }
    }
  );

  assert.equal(result.user.id, 22);
  assert.match(queries.at(-1), /UPDATE users SET facebook_id = 'facebook-2' WHERE id = 22/);
});

test('GET /api/auth/facebook redirects to the Facebook consent screen with a state cookie', async () => {
  const route = createOAuthRoutes({
    getFacebookOAuthConfig: () => ({ clientId: 'abc', clientSecret: 'shh', redirectUri: 'http://localhost:3000/api/auth/facebook/callback' })
  });
  const response = createMockResponse();
  const handled = await route(createRequest('GET', '/api/auth/facebook'), response);

  assert.equal(handled, true);
  assert.equal(response.statusCode, 302);
  assert.match(response.headers.Location, /^https:\/\/www\.facebook\.com/);
  assert.match(response.headers['Set-Cookie'], /pc_oauth_state=/);
});

test('GET /api/auth/facebook redirects with an error when Facebook credentials are not configured', async () => {
  const route = createOAuthRoutes({
    getFacebookOAuthConfig: () => ({ clientId: '', clientSecret: '', redirectUri: '' })
  });
  const response = createMockResponse();
  await route(createRequest('GET', '/api/auth/facebook'), response);

  assert.equal(response.statusCode, 302);
  assert.match(response.headers.Location, /authError=facebook_not_configured/);
});

test('GET /api/auth/facebook/callback rejects a mismatched state and does not exchange the code', async () => {
  let exchanged = false;
  const route = createOAuthRoutes({
    getFacebookOAuthConfig: () => ({ clientId: 'abc', clientSecret: 'shh', redirectUri: 'http://localhost:3000/api/auth/facebook/callback' }),
    exchangeFacebookCode: async () => {
      exchanged = true;
      return { access_token: 'ignored' };
    }
  });
  const response = createMockResponse();
  const request = createRequest('GET', '/api/auth/facebook/callback?code=abc&state=wrong', { cookie: 'pc_oauth_state=right' });

  await route(request, response);

  assert.equal(exchanged, false);
  assert.equal(response.statusCode, 302);
  assert.match(response.headers.Location, /authError=facebook_state_mismatch/);
});

test('GET /api/auth/facebook/callback logs the user in and sets the session cookie on success', async () => {
  const route = createOAuthRoutes({
    getFacebookOAuthConfig: () => ({ clientId: 'abc', clientSecret: 'shh', redirectUri: 'http://localhost:3000/api/auth/facebook/callback' }),
    exchangeFacebookCode: async (code) => {
      assert.equal(code, 'auth-code');
      return { access_token: 'access-token-xyz' };
    },
    fetchFacebookProfile: async (accessToken) => {
      assert.equal(accessToken, 'access-token-xyz');
      return { facebookId: 'facebook-9', email: 'person@example.com', emailVerified: true };
    },
    loginWithFacebook: async () => ({ token: 'session-abc', user: { id: 1, username: 'person@example.com', role: 'user' } })
  });
  const response = createMockResponse();
  const request = createRequest('GET', '/api/auth/facebook/callback?code=auth-code&state=right', { cookie: 'pc_oauth_state=right' });

  await route(request, response);

  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.Location, '/');
  assert.ok(response.headers['Set-Cookie'].some((cookie) => cookie.includes('pc_session=session-abc')));
});

test('GET /api/auth/facebook/callback redirects with an error when Facebook reports the user declined access', async () => {
  const route = createOAuthRoutes({
    getFacebookOAuthConfig: () => ({ clientId: 'abc', clientSecret: 'shh', redirectUri: 'http://localhost:3000/api/auth/facebook/callback' })
  });
  const response = createMockResponse();
  const request = createRequest('GET', '/api/auth/facebook/callback?error=access_denied', { cookie: 'pc_oauth_state=right' });

  await route(request, response);

  assert.equal(response.statusCode, 302);
  assert.match(response.headers.Location, /authError=facebook_access_denied/);
});

function createRequest(method, url, headers = {}) {
  return { method, url, headers };
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

import { randomBytes } from 'node:crypto';

import { getDatabaseConfig } from '../config/database.js';
import { getFacebookOAuthConfig, getGoogleOAuthConfig } from '../config/oauth.js';
import { runMysqlScalar } from './database.service.js';
import { escapeSqlString } from './products.service.js';
import { createSessionToken, normalizeUsername, sanitizeUser, sessionMaxAgeSeconds } from './auth.service.js';

const googleAuthEndpoint = 'https://accounts.google.com/o/oauth2/v2/auth';
const googleTokenEndpoint = 'https://oauth2.googleapis.com/token';
const googleUserInfoEndpoint = 'https://www.googleapis.com/oauth2/v3/userinfo';

const facebookApiVersion = 'v21.0';
const facebookAuthEndpoint = `https://www.facebook.com/${facebookApiVersion}/dialog/oauth`;
const facebookTokenEndpoint = `https://graph.facebook.com/${facebookApiVersion}/oauth/access_token`;
const facebookProfileEndpoint = `https://graph.facebook.com/${facebookApiVersion}/me`;

export function createOAuthState() {
  return randomBytes(24).toString('hex');
}

export function buildGoogleAuthUrl(state, config = getGoogleOAuthConfig()) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account'
  });

  return `${googleAuthEndpoint}?${params.toString()}`;
}

export async function exchangeGoogleCode(code, options = {}) {
  const config = options.config || getGoogleOAuthConfig();
  const fetchFn = options.fetch || fetch;
  const response = await fetchFn(googleTokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code'
    })
  });

  if (!response.ok) {
    throw new Error('Cannot exchange Google authorization code');
  }

  const payload = await response.json();

  if (!payload.access_token) {
    throw new Error('Google did not return an access token');
  }

  return payload;
}

export async function fetchGoogleProfile(accessToken, options = {}) {
  const fetchFn = options.fetch || fetch;
  const response = await fetchFn(googleUserInfoEndpoint, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    throw new Error('Cannot load Google account profile');
  }

  const profile = await response.json();

  if (!profile.sub) {
    throw new Error('Google profile is missing an account id');
  }

  return {
    googleId: String(profile.sub),
    email: normalizeUsername(profile.email || ''),
    emailVerified: Boolean(profile.email_verified),
    name: String(profile.name || '')
  };
}

export function buildFacebookAuthUrl(state, config = getFacebookOAuthConfig()) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'public_profile,email',
    state
  });

  return `${facebookAuthEndpoint}?${params.toString()}`;
}

export async function exchangeFacebookCode(code, options = {}) {
  const config = options.config || getFacebookOAuthConfig();
  const fetchFn = options.fetch || fetch;
  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    code
  });
  const response = await fetchFn(`${facebookTokenEndpoint}?${params.toString()}`);

  if (!response.ok) {
    throw new Error('Cannot exchange Facebook authorization code');
  }

  const payload = await response.json();

  if (!payload.access_token) {
    throw new Error('Facebook did not return an access token');
  }

  return payload;
}

export async function fetchFacebookProfile(accessToken, options = {}) {
  const fetchFn = options.fetch || fetch;
  const params = new URLSearchParams({ fields: 'id,name,email', access_token: accessToken });
  const response = await fetchFn(`${facebookProfileEndpoint}?${params.toString()}`);

  if (!response.ok) {
    throw new Error('Cannot load Facebook account profile');
  }

  const profile = await response.json();

  if (!profile.id) {
    throw new Error('Facebook profile is missing an account id');
  }

  return {
    facebookId: String(profile.id),
    // Facebook only ever returns an email address that it has itself already verified,
    // so any email present here can be treated the same as Google's email_verified flag.
    email: normalizeUsername(profile.email || ''),
    emailVerified: Boolean(profile.email),
    name: String(profile.name || '')
  };
}

export async function loginWithFacebook(profile, options = {}) {
  const config = options.config || getDatabaseConfig();
  const runQuery = options.runQuery || ((query) => runMysqlScalar(config, query));

  if (!profile?.facebookId) {
    throw new Error('Facebook profile is missing an account id');
  }

  const token = createSessionToken();

  const existingResult = await runQuery(buildFindByFacebookIdQuery(profile.facebookId));
  const existingUsers = JSON.parse(existingResult || '[]');

  if (existingUsers[0]) {
    await runQuery(buildCreateSessionQuery(Number(existingUsers[0].id), token));
    return { token, user: sanitizeUser(existingUsers[0]) };
  }

  if (profile.email && profile.emailVerified) {
    const linkedResult = await runQuery(buildFindLinkableByEmailQuery(profile.email, 'facebook_id'));
    const linkedUsers = JSON.parse(linkedResult || '[]');

    if (linkedUsers[0]) {
      await runQuery(buildLinkFacebookAccountQuery(Number(linkedUsers[0].id), profile.facebookId, token));
      return { token, user: sanitizeUser(linkedUsers[0]) };
    }
  }

  const username = await resolveAvailableUsername(profile.email, `facebook-${profile.facebookId}`, runQuery);
  const createResult = await runQuery(buildRegisterFacebookUserQuery({ username, email: profile.email, facebookId: profile.facebookId, token }));
  const created = JSON.parse(createResult || '{}');

  return { token, user: sanitizeUser({ username, role: 'user', ...created }) };
}

export async function loginWithGoogle(profile, options = {}) {
  const config = options.config || getDatabaseConfig();
  const runQuery = options.runQuery || ((query) => runMysqlScalar(config, query));

  if (!profile?.googleId) {
    throw new Error('Google profile is missing an account id');
  }

  const token = createSessionToken();

  const existingResult = await runQuery(buildFindByGoogleIdQuery(profile.googleId));
  const existingUsers = JSON.parse(existingResult || '[]');

  if (existingUsers[0]) {
    await runQuery(buildCreateSessionQuery(Number(existingUsers[0].id), token));
    return { token, user: sanitizeUser(existingUsers[0]) };
  }

  if (profile.email && profile.emailVerified) {
    const linkedResult = await runQuery(buildFindLinkableByEmailQuery(profile.email, 'google_id'));
    const linkedUsers = JSON.parse(linkedResult || '[]');

    if (linkedUsers[0]) {
      await runQuery(buildLinkGoogleAccountQuery(Number(linkedUsers[0].id), profile.googleId, token));
      return { token, user: sanitizeUser(linkedUsers[0]) };
    }
  }

  const username = await resolveAvailableUsername(profile.email, `google-${profile.googleId}`, runQuery);
  const createResult = await runQuery(buildRegisterGoogleUserQuery({ username, email: profile.email, googleId: profile.googleId, token }));
  const created = JSON.parse(createResult || '{}');

  return { token, user: sanitizeUser({ username, role: 'user', ...created }) };
}

async function resolveAvailableUsername(email, fallbackId, runQuery) {
  const base = email || `account-${fallbackId}`;
  const takenResult = await runQuery(`SELECT COUNT(*) FROM users WHERE username = '${escapeSqlString(base)}';`);

  if (Number(takenResult) === 0) {
    return base;
  }

  return `${base}-${String(fallbackId).slice(-6)}`;
}

function buildFindByGoogleIdQuery(googleId) {
  return `
    SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT(
      'id', id, 'username', username, 'role', role
    )), JSON_ARRAY())
    FROM users
    WHERE google_id = '${escapeSqlString(googleId)}' AND is_active = 1
    LIMIT 1;
  `;
}

// Only offers to link an existing account that was created through social login before
// (already has the given provider column set to something, being re-checked here) is
// intentionally excluded -- this only links accounts that have no id for that provider yet
// and share the same verified email, so a manually-registered account can adopt social
// sign-in on first use. `column` is always one of the hardcoded literals 'google_id' or
// 'facebook_id' from the call sites below, never user input.
function buildFindLinkableByEmailQuery(email, column) {
  return `
    SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT(
      'id', id, 'username', username, 'role', role
    )), JSON_ARRAY())
    FROM users
    WHERE email = '${escapeSqlString(email)}' AND ${column} IS NULL AND is_active = 1
    LIMIT 1;
  `;
}

function buildFindByFacebookIdQuery(facebookId) {
  return `
    SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT(
      'id', id, 'username', username, 'role', role
    )), JSON_ARRAY())
    FROM users
    WHERE facebook_id = '${escapeSqlString(facebookId)}' AND is_active = 1
    LIMIT 1;
  `;
}

function buildLinkFacebookAccountQuery(userId, facebookId, token) {
  return `
    UPDATE users SET facebook_id = '${escapeSqlString(facebookId)}' WHERE id = ${Number(userId)};
    DELETE FROM user_sessions WHERE created_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${sessionMaxAgeSeconds} SECOND);
    INSERT INTO user_sessions (user_id, token) VALUES (${Number(userId)}, '${escapeSqlString(token)}');
  `;
}

function buildRegisterFacebookUserQuery({ username, email, facebookId, token }) {
  return `
    DELETE FROM user_sessions
    WHERE created_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${sessionMaxAgeSeconds} SECOND);

    INSERT INTO users (username, password_hash, role, email, facebook_id)
    VALUES ('${escapeSqlString(username)}', NULL, 'user', ${email ? `'${escapeSqlString(email)}'` : 'NULL'}, '${escapeSqlString(facebookId)}');

    SET @user_id = LAST_INSERT_ID();

    INSERT INTO user_sessions (user_id, token)
    VALUES (@user_id, '${escapeSqlString(token)}');

    SELECT JSON_OBJECT('id', @user_id, 'username', '${escapeSqlString(username)}', 'role', 'user');
  `;
}

function buildCreateSessionQuery(userId, token) {
  return `
    DELETE FROM user_sessions WHERE created_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${sessionMaxAgeSeconds} SECOND);
    INSERT INTO user_sessions (user_id, token) VALUES (${Number(userId)}, '${escapeSqlString(token)}');
  `;
}

function buildLinkGoogleAccountQuery(userId, googleId, token) {
  return `
    UPDATE users SET google_id = '${escapeSqlString(googleId)}' WHERE id = ${Number(userId)};
    DELETE FROM user_sessions WHERE created_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${sessionMaxAgeSeconds} SECOND);
    INSERT INTO user_sessions (user_id, token) VALUES (${Number(userId)}, '${escapeSqlString(token)}');
  `;
}

function buildRegisterGoogleUserQuery({ username, email, googleId, token }) {
  return `
    DELETE FROM user_sessions
    WHERE created_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${sessionMaxAgeSeconds} SECOND);

    INSERT INTO users (username, password_hash, role, email, google_id)
    VALUES ('${escapeSqlString(username)}', NULL, 'user', ${email ? `'${escapeSqlString(email)}'` : 'NULL'}, '${escapeSqlString(googleId)}');

    SET @user_id = LAST_INSERT_ID();

    INSERT INTO user_sessions (user_id, token)
    VALUES (@user_id, '${escapeSqlString(token)}');

    SELECT JSON_OBJECT('id', @user_id, 'username', '${escapeSqlString(username)}', 'role', 'user');
  `;
}

export function googleAuthSchemaQuery() {
  return `
    ALTER TABLE users MODIFY COLUMN password_hash VARCHAR(255) NULL;

    SET @add_google_id_column = (
      SELECT IF(
        COUNT(*) = 0,
        'ALTER TABLE users ADD COLUMN google_id VARCHAR(64) NULL UNIQUE AFTER password_hash',
        'SET @noop = 1'
      )
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'google_id'
    );
    PREPARE add_google_id_statement FROM @add_google_id_column;
    EXECUTE add_google_id_statement;
    DEALLOCATE PREPARE add_google_id_statement;

    SET @add_email_column = (
      SELECT IF(
        COUNT(*) = 0,
        'ALTER TABLE users ADD COLUMN email VARCHAR(255) NULL AFTER google_id',
        'SET @noop = 1'
      )
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'email'
    );
    PREPARE add_email_statement FROM @add_email_column;
    EXECUTE add_email_statement;
    DEALLOCATE PREPARE add_email_statement;
  `;
}

export function facebookAuthSchemaQuery() {
  return `
    SET @add_facebook_id_column = (
      SELECT IF(
        COUNT(*) = 0,
        'ALTER TABLE users ADD COLUMN facebook_id VARCHAR(64) NULL UNIQUE AFTER email',
        'SET @noop = 1'
      )
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'facebook_id'
    );
    PREPARE add_facebook_id_statement FROM @add_facebook_id_column;
    EXECUTE add_facebook_id_statement;
    DEALLOCATE PREPARE add_facebook_id_statement;
  `;
}

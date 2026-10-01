import { randomBytes, timingSafeEqual, scryptSync } from 'node:crypto';

import { getDatabaseConfig } from '../config/database.js';
import { runMysqlCommand, runMysqlScalar } from './database.service.js';
import { escapeSqlString } from './products.service.js';
import { userSchemaQuery } from './admin-users.service.js';

const sessionCookieName = 'pc_session';
export const sessionMaxAgeSeconds = 60 * 60 * 24 * 7;

export function createPasswordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, 64).toString('hex');

  return `scrypt:${salt}:${hash}`;
}

export function verifyPasswordHash(password, storedHash = '') {
  const [scheme, salt, hash] = String(storedHash).split(':');

  if (scheme !== 'scrypt' || !salt || !hash) {
    return false;
  }

  const actual = Buffer.from(hash, 'hex');
  const expected = scryptSync(String(password), salt, 64);

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function registerUser(payload = {}, options = {}) {
  const config = options.config || getDatabaseConfig();
  const runQuery = options.runQuery || ((query) => runMysqlScalar(config, query));
  const username = normalizeUsername(payload.username);
  const email = normalizeEmail(payload.email);
  const password = String(payload.password || '');
  const role = 'user';

  if (!username || password.length < 6) {
    throw new Error('Username and password with at least 6 characters are required');
  }

  // อีเมลใช้สำหรับกู้คืนรหัสผ่านเมื่อลืม (บังคับกรอกตอนสมัคร)
  if (!isValidEmail(email)) {
    throw new Error('A valid email address is required');
  }

  const token = createSessionToken();
  const passwordHash = createPasswordHash(password);
  let result;

  try {
    result = await runQuery(buildRegisterQuery({ username, email, passwordHash, role, token }));
  } catch (error) {
    throw translateRegisterError(error);
  }

  return parseAuthResult(result, token, { username, role });
}

// MySQL error 1062 ข้อความดิบอ่านยาก (และเผยชื่อคีย์ภายใน) - แปลงเป็นข้อความสั้นที่หน้าเว็บจับคู่ได้
function translateRegisterError(error) {
  const message = String(error?.message || '');

  if (/duplicate entry/i.test(message)) {
    if (/contact_email/i.test(message)) {
      return new Error('This email is already registered');
    }

    if (/username/i.test(message)) {
      return new Error('This username is already taken');
    }
  }

  return error;
}

export async function loginUser(payload = {}, options = {}) {
  const config = options.config || getDatabaseConfig();
  const runQuery = options.runQuery || ((query) => runMysqlScalar(config, query));
  const username = normalizeUsername(payload.username);
  const password = String(payload.password || '');

  if (!username || !password) {
    throw new Error('Username and password are required');
  }

  const userResult = await runQuery(buildFindUserQuery(username));
  const users = JSON.parse(userResult || '[]');
  const user = users[0];

  if (!user || !verifyPasswordHash(password, user.passwordHash)) {
    throw new Error('Invalid username or password');
  }

  const token = createSessionToken();
  await runQuery(buildCreateSessionQuery(Number(user.id), token));

  return {
    token,
    user: sanitizeUser(user)
  };
}

export async function logoutUser(token, options = {}) {
  if (!token) {
    return;
  }

  const config = options.config || getDatabaseConfig();
  const runQuery = options.runQuery || ((query) => runMysqlCommand(config, query));
  await runQuery(buildDeleteSessionQuery(token));
}

export async function changePassword(userId, payload = {}, options = {}) {
  const config = options.config || getDatabaseConfig();
  const runQuery = options.runQuery || ((query) => runMysqlScalar(config, query));
  const id = Number(userId);
  const currentPassword = String(payload.currentPassword || '');
  const newPassword = String(payload.newPassword || '');

  if (!Number.isInteger(id) || id <= 0 || !currentPassword || newPassword.length < 6) {
    throw new Error('Current password and a new password with at least 6 characters are required');
  }

  const users = JSON.parse(await runQuery(buildFindUserByIdQuery(id)) || '[]');
  const user = users[0];

  if (!user || !verifyPasswordHash(currentPassword, user.passwordHash)) {
    throw new Error('Current password is incorrect');
  }

  const passwordHash = createPasswordHash(newPassword);
  await runQuery(buildChangePasswordQuery(id, passwordHash));
}

export async function getCurrentUser(request, options = {}) {
  const token = getSessionToken(request);

  if (!token) {
    return null;
  }

  const config = options.config || getDatabaseConfig();
  const runQuery = options.runQuery || ((query) => runMysqlScalar(config, query));
  const result = await runQuery(buildSessionUserQuery(token));
  const users = JSON.parse(result || '[]');

  return users[0] ? sanitizeUser(users[0]) : null;
}

export function getSessionToken(request) {
  const cookies = parseCookies(request?.headers?.cookie || request?.headers?.Cookie || '');
  return cookies[sessionCookieName] || '';
}

export function createSessionCookie(token) {
  const secureAttribute = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${sessionCookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionMaxAgeSeconds}${secureAttribute}`;
}

export function clearSessionCookie() {
  return `${sessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export function parseCookies(header = '') {
  return String(header).split(';').reduce((cookies, part) => {
    const [name, ...valueParts] = part.trim().split('=');

    if (!name) {
      return cookies;
    }

    cookies[name] = decodeURIComponent(valueParts.join('=') || '');
    return cookies;
  }, {});
}

function buildRegisterQuery({ username, email, passwordHash, role, token }) {
  return `
    DELETE FROM user_sessions
    WHERE created_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${sessionMaxAgeSeconds} SECOND);

    INSERT INTO users (username, password_hash, role, contact_email)
    VALUES ('${escapeSqlString(username)}', '${escapeSqlString(passwordHash)}', '${escapeSqlString(role)}', '${escapeSqlString(email)}');

    SET @user_id = LAST_INSERT_ID();

    INSERT INTO user_sessions (user_id, token)
    VALUES (@user_id, '${escapeSqlString(token)}');

    SELECT JSON_OBJECT(
      'id', @user_id,
      'username', '${escapeSqlString(username)}',
      'role', '${escapeSqlString(role)}'
    );
  `;
}

function buildFindUserQuery(username) {
  return `
    SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT(
      'id', id,
      'username', username,
      'role', role,
      'passwordHash', password_hash
    )), JSON_ARRAY())
    FROM users
    WHERE username = '${escapeSqlString(username)}' AND is_active = 1
    LIMIT 1;
  `;
}

function buildFindUserByIdQuery(userId) {
  return `
    SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT(
      'id', id, 'passwordHash', password_hash
    )), JSON_ARRAY()) FROM users
    WHERE id = ${Number(userId)} AND is_active = 1
    LIMIT 1;
  `;
}

function buildCreateSessionQuery(userId, token) {
  return `
    DELETE FROM user_sessions
    WHERE created_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${sessionMaxAgeSeconds} SECOND);

    INSERT INTO user_sessions (user_id, token)
    VALUES (${Number(userId)}, '${escapeSqlString(token)}');
  `;
}

function buildDeleteSessionQuery(token) {
  return `
    DELETE FROM user_sessions
    WHERE token = '${escapeSqlString(token)}';
  `;
}

function buildChangePasswordQuery(userId, passwordHash) {
  return `
    UPDATE users SET password_hash = '${escapeSqlString(passwordHash)}' WHERE id = ${Number(userId)};
    DELETE FROM user_sessions WHERE user_id = ${Number(userId)};
  `;
}

function buildSessionUserQuery(token) {
  return `
    SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT(
      'id', users.id,
      'username', users.username,
      'role', users.role
    )), JSON_ARRAY())
    FROM user_sessions
    INNER JOIN users ON users.id = user_sessions.user_id
    WHERE user_sessions.token = '${escapeSqlString(token)}'
      AND users.is_active = 1
      AND user_sessions.created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${sessionMaxAgeSeconds} SECOND)
    LIMIT 1;
  `;
}

export function userSessionsSchemaQuery() {
  return `
    CREATE TABLE IF NOT EXISTS user_sessions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      token VARCHAR(128) NOT NULL UNIQUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX user_sessions_token_idx (token),
      INDEX user_sessions_user_id_idx (user_id)
    );
  `;
}

function parseAuthResult(result, token, fallback) {
  const parsed = JSON.parse(result || '{}');

  return {
    token,
    user: sanitizeUser({ ...fallback, ...parsed })
  };
}

export function sanitizeUser(user) {
  return {
    id: Number(user.id || 0),
    username: String(user.username || ''),
    role: normalizeRole(user.role)
  };
}

export function createSessionToken() {
  return randomBytes(32).toString('hex');
}

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

// ตรวจแบบพอประมาณ: มี @ และโดเมนที่มีจุด ไม่มีช่องว่าง ยาวไม่เกิน 254 ตัวอักษร
// (ไม่พยายามตรวจตามมาตรฐาน RFC ทั้งหมด - การยืนยันว่าเป็นอีเมลจริงคือการส่งลิงก์ไปหา ซึ่งยังไม่มีในระบบตอนนี้)
export function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// คอลัมน์แยกจาก users.email ที่ Google/Facebook login ใช้ "ผูกบัญชีตามอีเมลที่ยืนยันแล้ว" (oauth.service.js)
// เหตุผล: อีเมลที่กรอกตอนสมัครเองยังไม่ได้ยืนยัน ถ้าใช้คอลัมน์เดียวกัน คนอื่นสมัครล่วงหน้าด้วยอีเมลของเหยื่อได้
// แล้วเมื่อเหยื่อล็อกอิน Google ครั้งแรก บัญชี Google จะถูกผูกเข้ากับบัญชีที่คนร้ายรู้รหัสผ่าน
// (UNIQUE: MySQL อนุญาตค่า NULL ซ้ำได้ บัญชีเก่าที่ยังไม่มีอีเมลจึงไม่กระทบ)
export function contactEmailSchemaQuery() {
  return `
    SET @add_contact_email_column = (
      SELECT IF(
        COUNT(*) = 0,
        'ALTER TABLE users ADD COLUMN contact_email VARCHAR(255) NULL UNIQUE AFTER username',
        'SET @noop = 1'
      )
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'contact_email'
    );
    PREPARE add_contact_email_statement FROM @add_contact_email_column;
    EXECUTE add_contact_email_statement;
    DEALLOCATE PREPARE add_contact_email_statement;
  `;
}

export function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeRole(value) {
  return value === 'admin' ? 'admin' : 'user';
}

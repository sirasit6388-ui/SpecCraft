import { getDatabaseConfig } from '../config/database.js';
import { runMysqlCommand, runMysqlScalar } from './database.service.js';
import { escapeSqlString, normalizeLimit, normalizeOffset } from './products.service.js';

// createPasswordHash lives in auth.service.js, which itself imports
// userSchemaQuery from this file - a circular import, but a safe one: both
// sides only reach for the other's export inside a function body (never at
// module-eval time), so by the time either function actually runs both
// modules have finished initializing.
import { createPasswordHash } from './auth.service.js';

export async function listAdminUsers(filters = {}, config = getDatabaseConfig()) {
  const limit = Math.min(normalizeLimit(filters.limit || 50), 100);
  const offset = normalizeOffset(filters.offset);
  const search = String(filters.search || '').trim();
  const where = search ? `WHERE username LIKE '%${escapeSqlString(search)}%'` : '';
  const result = await runMysqlScalar(config, `
    SELECT JSON_OBJECT(
      'users', COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
        'id', id, 'username', username, 'role', role, 'isActive', is_active, 'createdAt', created_at
      )) FROM (
        SELECT id, username, role, is_active, created_at FROM users ${where}
        ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}
      ) AS user_page), JSON_ARRAY()),
      'total', (SELECT COUNT(*) FROM users ${where}),
      'limit', ${limit}, 'offset', ${offset}
    );
  `);

  return JSON.parse(result || '{"users":[],"total":0,"limit":50,"offset":0}');
}

export async function updateAdminUser(userId, payload = {}, actor = {}, config = getDatabaseConfig()) {
  const id = normalizeUserId(userId);
  const role = payload.role === 'admin' ? 'admin' : 'user';
  const isActive = payload.isActive === true || payload.isActive === 1 || payload.isActive === 'true' || payload.isActive === '1';
  // Admin-initiated password reset - optional, and unlike the self-service
  // "เปลี่ยนรหัสผ่าน" flow (auth.service.js changePassword) it doesn't need
  // the user's current password, since an admin is doing this on their
  // behalf. An empty/missing password means "leave it as-is".
  const password = String(payload.password || '');
  const changingPassword = password.length > 0;

  if (!id) {
    throw new Error('Invalid user id');
  }

  if (changingPassword && password.length < 6) {
    throw new Error('New password must be at least 6 characters');
  }

  if (Number(actor.id) === id && (role !== 'admin' || !isActive)) {
    throw new Error('You cannot remove your own admin access or disable your account');
  }

  const current = await getAdminUser(id, config);

  if (!current) {
    throw new Error('User not found');
  }

  if (current.role === 'admin' && current.isActive && (role !== 'admin' || !isActive)) {
    const activeAdminCount = Number(await runMysqlScalar(config, 'SELECT COUNT(*) FROM users WHERE role = \'admin\' AND is_active = 1;'));

    if (activeAdminCount <= 1) {
      throw new Error('At least one active admin account is required');
    }
  }

  const passwordAssignment = changingPassword ? `, password_hash = '${escapeSqlString(createPasswordHash(password))}'` : '';
  // A password reset (like a deactivation) should force every existing
  // session for that account to re-authenticate with the new password,
  // rather than leaving already-logged-in sessions valid on the old one.
  const shouldClearSessions = !isActive || changingPassword;

  await runMysqlCommand(config, `
    UPDATE users SET role = '${role}', is_active = ${isActive ? 1 : 0}${passwordAssignment} WHERE id = ${id};
    ${shouldClearSessions ? `DELETE FROM user_sessions WHERE user_id = ${id};` : ''}
  `);

  return getAdminUser(id, config);
}

async function getAdminUser(id, config) {
  const result = await runMysqlScalar(config, `
    SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT(
      'id', id, 'username', username, 'role', role, 'isActive', is_active, 'createdAt', created_at
    )), JSON_ARRAY()) FROM users WHERE id = ${id} LIMIT 1;
  `);
  return JSON.parse(result || '[]')[0] || null;
}

export function userSchemaQuery() {
  return `
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(80) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('user','admin') NOT NULL DEFAULT 'user',
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    SET @add_is_active_column = (
      SELECT IF(
        COUNT(*) = 0,
        'ALTER TABLE users ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER role',
        'SET @noop = 1'
      )
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'users'
        AND COLUMN_NAME = 'is_active'
    );
    PREPARE add_is_active_statement FROM @add_is_active_column;
    EXECUTE add_is_active_statement;
    DEALLOCATE PREPARE add_is_active_statement;
  `;
}

function normalizeUserId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

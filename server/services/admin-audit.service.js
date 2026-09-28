import { getDatabaseConfig } from '../config/database.js';
import { runMysqlCommand, runMysqlScalar } from './database.service.js';
import { escapeSqlString, normalizeLimit, normalizeOffset } from './products.service.js';

export async function recordAdminActivity(entry = {}, config = getDatabaseConfig()) {
  const actorId = Number(entry.actorId);
  const targetId = Number(entry.targetId);

  if (!Number.isInteger(actorId) || actorId <= 0 || !String(entry.action || '').trim() || !String(entry.targetType || '').trim()) {
    throw new Error('Audit activity is incomplete');
  }

  const details = JSON.stringify(entry.details || {});
  await runMysqlCommand(config, `
    INSERT INTO admin_audit_logs (actor_id, action, target_type, target_id, details)
    VALUES (${actorId}, '${escapeSqlString(entry.action)}', '${escapeSqlString(entry.targetType)}', ${Number.isInteger(targetId) && targetId > 0 ? targetId : 'NULL'}, CAST('${escapeSqlString(details)}' AS JSON));
  `);
}

export async function listAdminAuditLogs(filters = {}, config = getDatabaseConfig()) {
  const limit = Math.min(normalizeLimit(filters.limit || 50), 100);
  const offset = normalizeOffset(filters.offset);
  const where = buildAuditWhere(filters.search);
  const result = await runMysqlScalar(config, `
    SELECT JSON_OBJECT(
      'logs', COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
        'id', id, 'actorUsername', actor_username, 'action', action,
        'targetType', target_type, 'targetId', target_id,
        'details', details, 'createdAt', created_at
      )) FROM (
        SELECT audit.id, users.username AS actor_username, audit.action, audit.target_type, audit.target_id, audit.details, audit.created_at
        FROM admin_audit_logs AS audit INNER JOIN users ON users.id = audit.actor_id
        ${where}
        ORDER BY audit.created_at DESC, audit.id DESC LIMIT ${limit} OFFSET ${offset}
      ) AS activity_page), JSON_ARRAY()),
      'total', (SELECT COUNT(*) FROM admin_audit_logs AS audit INNER JOIN users ON users.id = audit.actor_id ${where}), 'limit', ${limit}, 'offset', ${offset}
    );
  `);

  return JSON.parse(result || '{"logs":[],"total":0,"limit":50,"offset":0}');
}

function buildAuditWhere(search) {
  const value = String(search || '').trim();

  if (!value) {
    return '';
  }

  const pattern = `%${escapeSqlString(value)}%`;
  return `WHERE users.username LIKE '${pattern}' OR audit.action LIKE '${pattern}' OR audit.target_type LIKE '${pattern}'`;
}

export function auditSchemaQuery() {
  return `
    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      actor_id BIGINT UNSIGNED NOT NULL,
      action VARCHAR(80) NOT NULL,
      target_type VARCHAR(80) NOT NULL,
      target_id BIGINT UNSIGNED NULL,
      details JSON NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX admin_audit_logs_created_idx (created_at),
      INDEX admin_audit_logs_actor_idx (actor_id)
    );
  `;
}

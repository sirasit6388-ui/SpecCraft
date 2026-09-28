import { getDatabaseConfig } from '../config/database.js';
import { runMysqlScalar } from './database.service.js';

export async function getAdminDashboard(config = getDatabaseConfig()) {
  const result = await runMysqlScalar(config, `
    SELECT JSON_OBJECT(
      'products', (SELECT COUNT(*) FROM products),
      'users', (SELECT COUNT(*) FROM users),
      'activeUsers', (SELECT COUNT(*) FROM users WHERE is_active = 1),
      'suspendedUsers', (SELECT COUNT(*) FROM users WHERE is_active = 0),
      'savedBuilds', (SELECT COUNT(*) FROM builds),
      'productCategories', COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
        'category', category, 'total', total
      )) FROM (
        SELECT category, COUNT(*) AS total FROM products
        GROUP BY category ORDER BY total DESC, category ASC LIMIT 8
      ) AS category_page), JSON_ARRAY()),
      'savedBuildModes', COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
        'mode', mode, 'total', total
      )) FROM (
        SELECT mode, COUNT(*) AS total FROM builds
        GROUP BY mode ORDER BY total DESC, mode ASC LIMIT 5
      ) AS mode_page), JSON_ARRAY()),
      'recentActivities', COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
        'id', activity.id, 'actorUsername', users.username, 'action', activity.action,
        'targetType', activity.target_type, 'targetId', activity.target_id, 'details', activity.details,
        'createdAt', activity.created_at
      )) FROM (
        SELECT * FROM admin_audit_logs ORDER BY created_at DESC, id DESC LIMIT 5
      ) AS activity INNER JOIN users ON users.id = activity.actor_id), JSON_ARRAY())
    );
  `);

  return JSON.parse(result || '{"products":0,"users":0,"activeUsers":0,"suspendedUsers":0,"savedBuilds":0,"productCategories":[],"savedBuildModes":[],"recentActivities":[]}');
}

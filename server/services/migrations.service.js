import { getDatabaseConfig } from '../config/database.js';
import { auditSchemaQuery } from './admin-audit.service.js';
import { userSchemaQuery } from './admin-users.service.js';
import { buildTableSchemaQuery } from './builds.service.js';
import { userSessionsSchemaQuery } from './auth.service.js';
import { facebookAuthSchemaQuery, googleAuthSchemaQuery } from './oauth.service.js';
import { runMysqlCommand } from './database.service.js';

export async function migrateDatabase(config = getDatabaseConfig()) {
  await runMysqlCommand(config, `
    ${userSchemaQuery()}
    ${googleAuthSchemaQuery()}
    ${facebookAuthSchemaQuery()}
    ${userSessionsSchemaQuery()}
    ${buildTableSchemaQuery()}
    ${auditSchemaQuery()}
  `);
}

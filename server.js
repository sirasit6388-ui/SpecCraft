import { startHttpServer } from './server/server.js';
import { applyEnv, loadEnvFromFile } from './server/config/env.js';
import { migrateDatabase } from './server/services/migrations.service.js';

applyEnv(loadEnvFromFile());
migrateDatabase().then(() => startHttpServer()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

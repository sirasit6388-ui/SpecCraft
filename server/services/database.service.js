import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getDatabaseConfig } from '../config/database.js';

export async function checkDatabaseConnection(config = getDatabaseConfig()) {
  const productCount = await runMysqlScalar(config, 'SELECT COUNT(*) FROM products;');

  return {
    ok: true,
    database: config.database,
    productCount: Number(productCount)
  };
}

export async function runMysqlScalar(config, query) {
  const credentialsDirectory = await mkdtemp(join(tmpdir(), 'pc-build-mysql-'));
  const credentialsPath = join(credentialsDirectory, 'client.cnf');

  try {
    await writeFile(credentialsPath, createMysqlCredentials(config), { encoding: 'utf8', mode: 0o600 });
    return await runMysqlWithCredentials(config, query, credentialsPath);
  } finally {
    await rm(credentialsDirectory, { force: true, recursive: true });
  }
}

function runMysqlWithCredentials(config, query, credentialsPath) {
  return new Promise((resolve, reject) => {
    const args = [
      `--defaults-extra-file=${credentialsPath}`,
      `--host=${config.host}`,
      `--port=${config.port}`,
      `--user=${config.user}`,
      '--batch',
      '--raw',
      '--skip-column-names',
      config.database,
      '--execute',
      query
    ];
    const mysql = spawn(config.mysqlBin, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';

    mysql.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    mysql.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    mysql.on('error', reject);
    mysql.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `mysql exited with code ${code}`));
        return;
      }

      resolve(stdout.trim());
    });
  });
}

export function createMysqlCredentials(config) {
  return [
    '[client]',
    `host=${config.host}`,
    `port=${config.port}`,
    `user=${config.user}`,
    `password=${config.password}`,
    `database=${config.database}`
  ].join('\n');
}

export function runMysqlCommand(config, query) {
  return runMysqlScalar(config, query);
}

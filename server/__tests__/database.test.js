import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadEnvFile } from '../config/env.js';
import { getDatabaseConfig } from '../config/database.js';
import { createMysqlCredentials } from '../services/database.service.js';
import { createDatabaseHealthRoute } from '../routes/database.routes.js';

test('loadEnvFile parses database values from .env text', () => {
  const values = loadEnvFile('DB_HOST=localhost\nDB_PASSWORD=6388\n# ignored\nDB_NAME=pc_builder\n');

  assert.deepEqual(values, {
    DB_HOST: 'localhost',
    DB_PASSWORD: '6388',
    DB_NAME: 'pc_builder'
  });
});

test('getDatabaseConfig returns MySQL connection defaults', () => {
  const config = getDatabaseConfig({
    DB_PASSWORD: '6388'
  });

  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3306);
  assert.equal(config.user, 'root');
  assert.equal(config.password, '6388');
  assert.equal(config.database, 'pc_builder');
  assert.equal(config.usdToThbRate, 36.5);
  assert.match(config.mysqlBin, /mysql/i);
});

test('MySQL credentials are prepared in an option file instead of command-line arguments', () => {
  const credentials = createMysqlCredentials(getDatabaseConfig({ DB_PASSWORD: 'test-password' }));

  assert.match(credentials, /^\[client\]/);
  assert.match(credentials, /password=test-password/);
  assert.doesNotMatch(credentials, /--password/);
});

test('GET /api/database/health reports a connected database', async () => {
  const route = createDatabaseHealthRoute({
    checkConnection: async () => ({
      ok: true,
      database: 'pc_builder',
      productCount: 45951
    })
  });
  const response = createMockResponse();
  const handled = await route({ method: 'GET', url: '/api/database/health' }, response);

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    status: 'ok',
    database: 'pc_builder',
    productCount: 45951
  });
});

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

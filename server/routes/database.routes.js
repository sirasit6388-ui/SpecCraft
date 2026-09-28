import { checkDatabaseConnection } from '../services/database.service.js';
import { sendJson } from '../utils/api-response.js';

export function createDatabaseHealthRoute(options = {}) {
  const checkConnection = options.checkConnection || checkDatabaseConnection;

  return async function databaseHealthRoute(request, response) {
    const requestUrl = new URL(request.url, 'http://localhost');

    if (request.method !== 'GET' || requestUrl.pathname !== '/api/database/health') {
      return false;
    }

    try {
      const result = await checkConnection();
      sendJson(response, 200, {
        status: result.ok ? 'ok' : 'error',
        database: result.database,
        productCount: result.productCount
      });
    } catch (error) {
      sendJson(response, 503, {
        status: 'error',
        message: error.message
      });
    }

    return true;
  };
}

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize } from 'node:path';

import { createAuthRoutes } from './routes/auth.routes.js';
import { createOAuthRoutes } from './routes/oauth.routes.js';
import { createAdminRoutes } from './routes/admin.routes.js';
import { createBuilderRoutes } from './routes/builder.routes.js';
import { createBuildRoutes, createPublicBuildRoutes } from './routes/builds.routes.js';
import { createDatabaseHealthRoute } from './routes/database.routes.js';
import { createHealthRoute } from './routes/health.routes.js';
import { createProductRoutes } from './routes/products.routes.js';
import { sendJson } from './utils/api-response.js';

const staticRoot = new URL('../src/', import.meta.url);
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

export function createHttpServer() {
  const authRoutes = createAuthRoutes();
  const oauthRoutes = createOAuthRoutes();
  const adminRoutes = createAdminRoutes();
  const builderRoutes = createBuilderRoutes();
  const buildRoutes = createBuildRoutes();
  const publicBuildRoutes = createPublicBuildRoutes();
  const databaseHealthRoute = createDatabaseHealthRoute();
  const healthRoute = createHealthRoute();
  const productRoutes = createProductRoutes();

  return createServer(async (request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    if (await healthRoute(request, response)) {
      return;
    }

    if (await authRoutes(request, response)) {
      return;
    }

    if (await oauthRoutes(request, response)) {
      return;
    }

    if (await adminRoutes(request, response)) {
      return;
    }

    if (await databaseHealthRoute(request, response)) {
      return;
    }

    if (await productRoutes(request, response)) {
      return;
    }

    if (await builderRoutes(request, response)) {
      return;
    }

    if (await buildRoutes(request, response)) {
      return;
    }

    if (await publicBuildRoutes(request, response)) {
      return;
    }

    if (request.method === 'GET' && await serveStaticFile(request, response)) {
      return;
    }

    sendJson(response, 404, {
      error: 'Not Found',
      path: request.url
    });
  });
}

export function startHttpServer(options = {}) {
  const port = Number(options.port ?? process.env.PORT ?? 3000);
  const host = options.host ?? '0.0.0.0';
  const server = createHttpServer();

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const displayHost = host === '0.0.0.0' ? 'localhost' : host;
      console.log(`SpecCraft API running at http://${displayHost}:${server.address().port}`);
      resolve(server);
    });
  });
}

async function serveStaticFile(request, response) {
  const requestUrl = new URL(request.url, 'http://localhost');
  const pathname = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
  const safePath = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const fileUrl = new URL(`.${safePath}`, staticRoot);

  if (!fileUrl.href.startsWith(staticRoot.href)) {
    return false;
  }

  try {
    const file = await readFile(fileUrl);
    response.writeHead(200, {
      'Content-Type': contentTypes[extname(fileUrl.pathname)] || 'application/octet-stream'
    });
    response.end(file);
    return true;
  } catch {
    return false;
  }
}

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';

import { createHttpServer } from '../server.js';

async function withServer(run) {
  const server = createHttpServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('GET /api/health returns Phase 1 service status', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'pc-build-api');
    assert.equal(body.phase, 1);
  });
});

test('HTTP server does not enable wildcard cross-origin access', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'https://untrusted.example' }
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal(response.headers.get('access-control-allow-credentials'), null);
  });
});

test('GET / serves the Phase 1 frontend shell', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(html, /SpecCraft/);
    assert.match(html, /data-auth-open/);
    assert.doesNotMatch(html, /href="\/api\/database\/health"/);
    assert.match(html, /data-auth-modal/);
    assert.match(html, /data-profile-link/);
    assert.match(html, /data-change-password-form/);
    assert.doesNotMatch(html, /data-auth-user-name/);
    assert.doesNotMatch(html, /data-auth-user-role/);
    assert.match(html, /data-auth-modal-status/);
    assert.doesNotMatch(html, /data-auth-status/);
    assert.match(html, /data-auth-mode="login"/);
    assert.match(html, /data-auth-mode="register"/);
    assert.match(html, /data-build-form/);
    assert.match(html, /data-save-build/);
    const saveBuildActions = html.match(/<div class="save-build-actions">[\s\S]*?<\/div>/)?.[0] || '';
    assert.match(saveBuildActions, /data-save-build/);
    assert.match(saveBuildActions, /บันทึกสเปค/);
    assert.match(html, /data-reset-build/);
    assert.doesNotMatch(html, /data-view-link="builder"/);
    assert.match(html, /data-view-link="history"/);
    assert.match(html, /data-view-link="admin"/);
    assert.match(html, /data-admin-link/);
    assert.match(html, /data-admin-users-link/);
    assert.match(html, /data-admin-audit-link/);
    assert.match(html, /data-admin-panel/);
    assert.match(html, /data-admin-products/);
    assert.match(html, /data-admin-pagination/);
    assert.match(html, /data-admin-form/);
    assert.match(html, /data-admin-image-file/);
    assert.match(html, /data-admin-image-preview/);
    assert.match(html, /data-admin-dashboard-panel/);
    assert.match(html, /data-admin-users-panel/);
    assert.match(html, /data-admin-audit-panel/);
    assert.match(html, /data-admin-audit-search-form/);
    assert.match(html, /data-admin-audit-pagination/);
    assert.match(html, /data-history-panel/);
    assert.match(html, /data-saved-build-detail/);
    const historyPanel = html.match(/<section class="saved-build-list-panel history-panel"[\s\S]*?<\/section>/)?.[0] || '';
    assert.doesNotMatch(historyPanel, /<p class="eyebrow">History<\/p>/);
    assert.doesNotMatch(historyPanel, /data-save-build(?:\s|=|>)/);
    assert.doesNotMatch(historyPanel, /data-saved-build-refresh/);
    assert.match(html, /data-saved-build-result[^>]*data-view-panel="products"/);
    assert.doesNotMatch(html, /บันทึกสเปคลง MySQL/);
    assert.match(html, /data-saved-build-result/);
    assert.match(html, /data-filter-form/);
    assert.match(html, /data-manual-categories/);
    assert.doesNotMatch(html, /data-category-strip/);
    assert.doesNotMatch(html, /data-categories/);
    assert.doesNotMatch(html, /data-refresh/);
    assert.doesNotMatch(html, /หมวดหมู่สินค้า/);
    assert.doesNotMatch(html, /Product Categories/);
    assert.doesNotMatch(html, /Phase 4/);
    assert.match(html, /data-pagination/);
    assert.doesNotMatch(html, /data-cart-items/);
    assert.doesNotMatch(html, /data-db-status/);
  });
});

test('GET /styles/main.css hides the login button after authentication', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/styles/main.css`);
    const css = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/css/);
    assert.match(css, /\[hidden\]\s*{[\s\S]*display:\s*none\s*!important/);
    assert.match(css, /\.auth-open-button\[hidden\]\s*{[\s\S]*display:\s*none/);
    assert.doesNotMatch(css, /\.auth-account-card\s*{/);
    assert.doesNotMatch(css, /\.auth-role-badge\s*{/);
    assert.doesNotMatch(css, /#0f5aae|#159ad7|#0c4f9d|#118bc4|#1498d4/);
    assert.match(css, /\.auth-user\s*{[\s\S]*justify-content:\s*flex-end/);
  });
});

test('frontend supports printing saved builds as PDF', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/main.js`);
    const script = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /javascript/);
    assert.match(script, /createSavedBuildPrintDocument/);
    assert.match(script, /renderCompatibilityReport/);
    assert.match(script, /\/api\/auth\/change-password/);
    assert.match(script, /data-print-saved-build/);
    assert.match(script, /data-saved-build-id/);
    assert.match(script, /data-history-back/);
    assert.match(script, /\/api\/admin\/products/);
    assert.match(script, /\/api\/admin\/users/);
    assert.match(script, /\/api\/admin\/audit-logs/);
    assert.match(script, /data-admin-audit-page/);
    assert.match(script, /\/api\/admin\/dashboard/);
    assert.match(script, /\/api\/admin\/product-images/);
    assert.match(script, /discardPendingAdminImage/);
    assert.match(script, /data-admin-page/);
    assert.match(script, /state\.user\?\.role !== 'admin'/);
    assert.match(script, /getSafeImageUrl/);
    assert.doesNotMatch(script, /data-load-saved-build/);
    assert.doesNotMatch(script, /โหลดเข้า cart/);
    assert.match(script, /window\.open/);
  });
});

test('node server.js starts the HTTP server', async () => {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('../..', import.meta.url),
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  try {
    const port = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Server did not start. stdout=${stdout} stderr=${stderr}`));
      }, 3000);

      child.stdout.on('data', () => {
        const match = stdout.match(/http:\/\/localhost:(\d+)/);
        if (match) {
          clearTimeout(timeout);
          resolve(Number(match[1]));
        }
      });

      child.once('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`Server exited early with code ${code}. stdout=${stdout} stderr=${stderr}`));
      });
    });

    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(response.status, 200);
  } finally {
    child.kill();
  }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBuildRoutes, createPublicBuildRoutes } from '../routes/builds.routes.js';
import {
  adminUnlistBuild,
  createBuildSnapshot,
  deleteSavedBuild,
  disableBuildSharing,
  enableBuildSharing,
  getPublicBuildByShareToken,
  listPublicGalleryBuilds,
  listSavedBuilds,
  saveBuild,
  setBuildListed,
  updateBuildItems
} from '../services/builds.service.js';

const items = [
  { id: 1, category: 'cpu', name: 'AMD Ryzen 7 7800X3D', price: 12412 },
  { id: 2, category: 'motherboard', name: 'B650 Board', price: 5200 }
];

test('createBuildSnapshot normalizes build items and totals price', () => {
  const snapshot = createBuildSnapshot({ name: 'Gaming Build', mode: 'gaming', items });

  assert.equal(snapshot.name, 'Gaming Build');
  assert.equal(snapshot.mode, 'gaming');
  assert.equal(snapshot.total, 17612);
  assert.deepEqual(snapshot.items.map((item) => item.category), ['cpu', 'motherboard']);
});

test('saveBuild inserts build and build item rows', async () => {
  const queries = [];
  const saved = await saveBuild(
    { name: 'My Build', mode: 'work', userId: 11, items },
    {
      runQuery: async (query) => {
        queries.push(query);
        return '42';
      }
    }
  );

  assert.equal(saved.id, 42);
  assert.equal(saved.total, 17612);
  assert.equal(saved.ownerToken, undefined, 'a logged-in save should not carry an anonymous owner token');
  assert.equal(queries.length, 1);
  assert.match(queries[0], /START TRANSACTION/);
  assert.match(queries[0], /COMMIT/);
  assert.match(queries[0], /INSERT INTO builds \(user_id, name, mode, total_thb, owner_token, hidden_from_history\)/);
  assert.match(queries[0], /11,\s*\n\s*'My Build'/);
  assert.match(queries[0], /AMD Ryzen 7 7800X3D/);
});

// ---- ปุ่ม "แชร์ลิงก์" ตรงๆ ไม่ต้องบันทึกเข้าหน้าประวัติ ----
// (ผู้ใช้ขอให้กดแชร์สเปคแบบลิงก์จากการ์ด "จัดสเปคเอง" แล้วไม่ต้องโผล่ในหน้า
// "สเปคที่บันทึกไว้" ของตัวเอง ดูคอมเมนต์ hiddenFromHistory ใน createBuildSnapshot)

test('createBuildSnapshot defaults hiddenFromHistory to false for a normal save', () => {
  const snapshot = createBuildSnapshot({ name: 'Gaming Build', mode: 'gaming', items });

  assert.equal(snapshot.hiddenFromHistory, false);
});

test('createBuildSnapshot marks hiddenFromHistory when the share-only flow requests it', () => {
  const snapshot = createBuildSnapshot({ name: 'Gaming Build', mode: 'gaming', items, hiddenFromHistory: true });

  assert.equal(snapshot.hiddenFromHistory, true);
});

test('saveBuild writes hidden_from_history = 1 for a share-only build', async () => {
  const queries = [];
  await saveBuild(
    { name: 'Share Only Build', mode: 'manual', userId: 11, items, hiddenFromHistory: true },
    {
      runQuery: async (query) => {
        queries.push(query);
        return '44';
      }
    }
  );

  assert.match(queries[0], /INSERT INTO builds \(user_id, name, mode, total_thb, owner_token, hidden_from_history\)/);
  assert.match(queries[0], /NULL,\s*\n\s*1\s*\n\s*\);/, 'hidden_from_history should be 1 and owner_token should stay NULL for a logged-in user');
});

test('saveBuild writes hidden_from_history = 0 for a normal save', async () => {
  const queries = [];
  await saveBuild(
    { name: 'Normal Build', mode: 'manual', userId: 11, items },
    {
      runQuery: async (query) => {
        queries.push(query);
        return '45';
      }
    }
  );

  assert.match(queries[0], /NULL,\s*\n\s*0\s*\n\s*\);/, 'hidden_from_history should default to 0 for a normal save');
});

test('POST /api/builds marks the build hidden from history when saveToHistory is false', async () => {
  let requestPayload;
  const route = createBuildRoutes({
    getCurrentUser: async () => ({ id: 11, username: 'bank', role: 'user' }),
    saveBuild: async (payload) => {
      requestPayload = payload;
      return { id: 8, name: 'Shared', total: 17612, items };
    }
  });
  const response = createMockResponse();
  const handled = await route(createJsonRequest('/api/builds', { items, saveToHistory: false }), response);

  assert.equal(handled, true);
  assert.equal(response.statusCode, 201);
  assert.equal(requestPayload.hiddenFromHistory, true);
});

test('POST /api/builds keeps the build visible in history by default (saveToHistory omitted)', async () => {
  let requestPayload;
  const route = createBuildRoutes({
    getCurrentUser: async () => ({ id: 11, username: 'bank', role: 'user' }),
    saveBuild: async (payload) => {
      requestPayload = payload;
      return { id: 9, name: 'Saved', total: 17612, items };
    }
  });
  const response = createMockResponse();
  const handled = await route(createJsonRequest('/api/builds', { items }), response);

  assert.equal(handled, true);
  assert.equal(requestPayload.hiddenFromHistory, false);
});

test('listSavedBuilds excludes builds hidden from history', async () => {
  await listSavedBuilds({
    userId: 11,
    runQuery: async (query) => {
      assert.match(query, /WHERE builds.user_id = 11 AND builds.hidden_from_history = 0/);

      return JSON.stringify({ builds: [], total: 0, limit: 10, offset: 0 });
    }
  });
});

test('saveBuild issues an owner token for an anonymous (not logged-in) build', async () => {
  const queries = [];
  const saved = await saveBuild(
    { name: 'Anon Build', mode: 'manual', items },
    {
      runQuery: async (query) => {
        queries.push(query);
        return '43';
      }
    }
  );

  assert.equal(saved.id, 43);
  assert.match(saved.ownerToken, /^[\w-]{20,}$/, 'anonymous saves should get a random owner token back');
  assert.match(queries[0], /VALUES \(\s*NULL,/, 'user_id should be NULL for an anonymous build');
  assert.ok(queries[0].includes(saved.ownerToken), 'the generated owner token should be written to the insert query');
});

test('listSavedBuilds returns saved builds for a user with their items', async () => {
  const builds = await listSavedBuilds({
    userId: 11,
    runQuery: async (query) => {
      assert.match(query, /FROM builds/);
      assert.match(query, /build_items/);
      assert.match(query, /WHERE builds.user_id = 11/);

      return JSON.stringify({
        builds: [{
          id: 7,
          name: 'Saved Gaming Build',
          mode: 'gaming',
          total: 17612,
          createdAt: '2026-06-29 20:00:00',
          items
        }],
        total: 1,
        limit: 10,
        offset: 0
      });
    }
  });

  assert.equal(builds.total, 1);
  assert.equal(builds.builds[0].id, 7);
  assert.equal(builds.builds[0].items.length, 2);
  assert.equal(builds.builds[0].items[0].category, 'cpu');
});

test('deleteSavedBuild removes only the current user build in a transaction', async () => {
  const queries = [];
  const result = await deleteSavedBuild(7, 11, {
    runQuery: async (query) => {
      queries.push(query);
      return '1';
    }
  });

  assert.deepEqual(result, { id: 7, deleted: true });
  assert.match(queries[0], /START TRANSACTION/);
  assert.match(queries[0], /DELETE FROM builds WHERE id = 7 AND user_id = 11/);
  assert.match(queries[0], /COMMIT/);
});

test('POST /api/builds returns saved build', async () => {
  let requestPayload;
  const route = createBuildRoutes({
    getCurrentUser: async () => ({ id: 11, username: 'bank', role: 'user' }),
    saveBuild: async (payload) => {
      requestPayload = payload;
      return { id: 7, name: 'Saved', total: 17612, items };
    }
  });
  const response = createMockResponse();
  const handled = await route(createJsonRequest('/api/builds', { name: 'Saved', items }), response);

  assert.equal(handled, true);
  assert.equal(response.statusCode, 201);
  assert.equal(requestPayload.name, 'Saved');
  assert.equal(requestPayload.userId, 11);
  assert.equal(JSON.parse(response.body).build.id, 7);
});

test('GET /api/builds returns saved builds for current user', async () => {
  let listOptions;
  const route = createBuildRoutes({
    getCurrentUser: async () => ({ id: 11, username: 'bank', role: 'user' }),
    listBuilds: async (options) => {
      listOptions = options;
      return [{ id: 7, name: 'Saved', total: 17612, items }];
    }
  });
  const response = createMockResponse();
  const handled = await route(createRequest('GET', '/api/builds'), response);

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.equal(listOptions.userId, 11);
  assert.equal(JSON.parse(response.body).builds[0].id, 7);
});

test('DELETE /api/builds/:id removes a saved build belonging to the current user', async () => {
  let deleted;
  const route = createBuildRoutes({
    getCurrentUser: async () => ({ id: 11, username: 'bank', role: 'user' }),
    deleteBuild: async (buildId, userId) => {
      deleted = { buildId, userId };
      return { id: Number(buildId), deleted: true };
    }
  });
  const response = createMockResponse();
  const handled = await route(createRequest('DELETE', '/api/builds/7'), response);

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(deleted, { buildId: '7', userId: 11 });
});

test('GET /api/builds rejects anonymous users', async () => {
  const route = createBuildRoutes({
    getCurrentUser: async () => null
  });
  const response = createMockResponse();
  const handled = await route(createRequest('GET', '/api/builds'), response);

  assert.equal(handled, true);
  assert.equal(response.statusCode, 401);
});

test('POST /api/builds rejects empty build items', async () => {
  const route = createBuildRoutes({
    getCurrentUser: async () => ({ id: 11, username: 'bank', role: 'user' }),
    saveBuild: async () => {
      throw new Error('Build must include at least one item');
    }
  });
  const response = createMockResponse();
  const handled = await route(createJsonRequest('/api/builds', { items: [] }), response);

  assert.equal(handled, true);
  assert.equal(response.statusCode, 400);
  assert.match(JSON.parse(response.body).message, /at least one item/);
});

// ---- ซิงก์ตะกร้าล่าสุดเข้า build เดิมที่เคยบันทึก/แชร์ไปแล้ว (id/share_token เดิม) ----

test('updateBuildItems replaces items and total for the owner\'s build', async () => {
  const queries = [];
  const result = await updateBuildItems(7, 11, items, {
    runQuery: async (query) => {
      queries.push(query);
      return '1';
    }
  });

  assert.equal(result.id, 7);
  assert.equal(result.total, 17612);
  assert.equal(result.items.length, 2);
  assert.match(queries[0], /START TRANSACTION/);
  assert.match(queries[0], /UPDATE builds SET total_thb = 17612 WHERE id = 7 AND user_id = 11/);
  assert.match(queries[0], /DELETE FROM build_items WHERE build_id = 7/);
  assert.match(queries[0], /INSERT INTO build_items/);
  assert.match(queries[0], /AMD Ryzen 7 7800X3D/);
  assert.match(queries[0], /COMMIT/);
});

test('updateBuildItems rejects a build that does not belong to the current user', async () => {
  await assert.rejects(
    updateBuildItems(7, 11, items, { runQuery: async () => '0' }),
    /Saved build not found/
  );
});

test('updateBuildItems rejects an empty item list', async () => {
  await assert.rejects(
    updateBuildItems(7, 11, [], { runQuery: async () => '1' }),
    /at least one item/
  );
});

test('PUT /api/builds/:id syncs items for the owner\'s build', async () => {
  let calledWith;
  const route = createBuildRoutes({
    getCurrentUser: async () => ({ id: 11, username: 'bank', role: 'user' }),
    updateBuildItems: async (buildId, userId, syncedItems) => {
      calledWith = { buildId, userId, syncedItems };
      return { id: Number(buildId), total: 17612, items };
    }
  });
  const response = createMockResponse();
  const handled = await route(createJsonRequest('/api/builds/7', { items }, 'PUT'), response);

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calledWith, { buildId: '7', userId: 11, syncedItems: items });
  assert.equal(JSON.parse(response.body).build.total, 17612);
});

// ---- ระบบแชร์สเปคแบบลิงก์สาธารณะ ----

test('enableBuildSharing sets a random share token scoped to the owner', async () => {
  const queries = [];
  const result = await enableBuildSharing(7, 11, {
    runQuery: async (query) => {
      queries.push(query);
      return '1';
    }
  });

  assert.equal(result.id, 7);
  assert.match(result.shareToken, /^[\w-]{20,}$/, 'token should be a non-trivial random base64url string');
  assert.match(queries[0], /UPDATE builds SET share_token = '.+' WHERE id = 7 AND user_id = 11/);
});

test('enableBuildSharing rejects a build that does not belong to the current user', async () => {
  await assert.rejects(
    enableBuildSharing(7, 11, { runQuery: async () => '0' }),
    /Saved build not found/
  );
});

test('disableBuildSharing clears the share token scoped to the owner', async () => {
  const queries = [];
  const result = await disableBuildSharing(7, 11, {
    runQuery: async (query) => {
      queries.push(query);
      return '1';
    }
  });

  assert.deepEqual(result, { id: 7, shared: false });
  assert.match(queries[0], /UPDATE builds SET share_token = NULL, listed_at = NULL WHERE id = 7 AND user_id = 11/);
});

test('setBuildListed(true) lists a build, generating a share token if it does not have one yet', async () => {
  const queries = [];
  const result = await setBuildListed(7, 11, true, {
    runQuery: async (query) => {
      queries.push(query);

      if (query.includes('SELECT share_token FROM builds')) {
        return 'share_token\nfallback-token-abc';
      }

      return '1';
    }
  });

  assert.equal(result.id, 7);
  assert.equal(result.listed, true);
  assert.equal(result.shareToken, 'fallback-token-abc');
  assert.match(queries[0], /UPDATE builds\s+SET\s+share_token = COALESCE\(share_token, '.+'\),\s+listed_at = NOW\(\)\s+WHERE id = 7 AND user_id = 11/);
});

test('setBuildListed(false) clears listed_at without touching the share token', async () => {
  const queries = [];
  const result = await setBuildListed(7, 11, false, {
    runQuery: async (query) => {
      queries.push(query);
      return '1';
    }
  });

  assert.deepEqual(result, { id: 7, listed: false });
  assert.match(queries[0], /UPDATE builds SET listed_at = NULL WHERE id = 7 AND user_id = 11/);
});

test('setBuildListed rejects a build that does not belong to the current user', async () => {
  await assert.rejects(
    setBuildListed(7, 11, true, { runQuery: async () => '0' }),
    /Saved build not found/
  );
});

// แอดมิน "ถอดสเปคออกจากคลังสาธารณะ" - ต่างจาก setBuildListed(false) ด้านบนตรงที่ไม่มี
// buildOwnerWhereClause เลย (ไม่เช็ค user_id/owner_token) เพราะแอดมินต้องถอดสเปค
// ของใครก็ได้ ไม่ใช่แค่ของตัวเอง
test('adminUnlistBuild clears listed_at for any build regardless of owner', async () => {
  const queries = [];
  const result = await adminUnlistBuild(7, {
    runQuery: async (query) => {
      queries.push(query);
      return '1';
    }
  });

  assert.deepEqual(result, { id: 7, listed: false });
  assert.match(queries[0], /UPDATE builds SET listed_at = NULL WHERE id = 7/);
  assert.doesNotMatch(queries[0], /user_id|owner_token/);
});

test('adminUnlistBuild throws when the build does not exist', async () => {
  await assert.rejects(
    adminUnlistBuild(999, { runQuery: async () => '0' }),
    /Saved build not found/
  );
});

test('adminUnlistBuild throws on an invalid build id', async () => {
  await assert.rejects(
    adminUnlistBuild('not-an-id', { runQuery: async () => '1' }),
    /Invalid saved build/
  );
});

// เดิม anonymous build (จัดสเปคแบบไม่ล็อกอิน) เคยลงคลังได้ผ่าน ownerToken เหมือนแชร์
// ลิงก์ปกติ แต่การ์ดในคลังตอนนี้โชว์ username ของเจ้าของด้วย (ตามที่ผู้ใช้ยืนยัน) เลย
// ต้องบังคับให้มีบัญชีจริงเท่านั้นถึงจะลงคลังได้ - ownerToken ยังใช้ยกเลิกแชร์/ลบออก
// จากคลังได้ตามเดิม แค่ "ลง" คลังใหม่ทำไม่ได้แล้วถ้าไม่ล็อกอิน
test('setBuildListed(true) rejects an anonymous build (no logged-in user) even with a matching owner token', async () => {
  await assert.rejects(
    setBuildListed(9, 0, true, {
      ownerToken: 'secret-owner-token',
      runQuery: async () => '1'
    }),
    /เข้าสู่ระบบ/
  );
});

test('listPublicGalleryBuilds returns listed builds with the owner username', async () => {
  const result = await listPublicGalleryBuilds({
    runQuery: async (query) => {
      assert.match(query, /WHERE builds.share_token IS NOT NULL AND builds.listed_at IS NOT NULL/);
      assert.match(query, /LEFT JOIN users ON users.id = builds.user_id/);
      assert.match(query, /'username', username/);

      return JSON.stringify({
        builds: [{
          id: 7, name: 'Saved Gaming Build', mode: 'gaming', total: 17612,
          shareToken: 'abc', itemCount: 2, username: 'bank'
        }],
        total: 1,
        limit: 12,
        offset: 0
      });
    }
  });

  assert.equal(result.builds.length, 1);
  assert.equal(result.builds[0].id, 7);
  assert.equal(result.builds[0].username, 'bank');
  assert.equal(result.total, 1);
});

test('getPublicBuildByShareToken returns the build for a valid token without owner info', async () => {
  const build = await getPublicBuildByShareToken('abc123', {
    runQuery: async (query) => {
      assert.match(query, /WHERE builds.share_token = 'abc123'/);
      assert.doesNotMatch(query, /user_id/);

      return JSON.stringify({ id: 7, name: 'Saved Gaming Build', mode: 'gaming', total: 17612, items });
    }
  });

  assert.equal(build.id, 7);
  assert.equal(build.name, 'Saved Gaming Build');
  assert.equal(build.items.length, 2);
  assert.equal(build.userId, undefined, 'public build payload should never carry the owner user id');
});

test('getPublicBuildByShareToken returns null for an unknown or revoked token', async () => {
  const build = await getPublicBuildByShareToken('does-not-exist', {
    runQuery: async () => ''
  });

  assert.equal(build, null);
});

test('POST /api/builds/:id/share enables sharing for the owner', async () => {
  let calledWith;
  const route = createBuildRoutes({
    getCurrentUser: async () => ({ id: 11, username: 'bank', role: 'user' }),
    enableBuildSharing: async (buildId, userId) => {
      calledWith = { buildId, userId };
      return { id: 7, shareToken: 'random-token' };
    }
  });
  const response = createMockResponse();
  const handled = await route(createRequest('POST', '/api/builds/7/share'), response);

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calledWith, { buildId: '7', userId: 11 });
  assert.equal(JSON.parse(response.body).shareToken, 'random-token');
});

test('DELETE /api/builds/:id/share disables sharing for the owner', async () => {
  let calledWith;
  const route = createBuildRoutes({
    getCurrentUser: async () => ({ id: 11, username: 'bank', role: 'user' }),
    disableBuildSharing: async (buildId, userId) => {
      calledWith = { buildId, userId };
      return { id: 7, shared: false };
    }
  });
  const response = createMockResponse();
  const handled = await route(createRequest('DELETE', '/api/builds/7/share'), response);

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calledWith, { buildId: '7', userId: 11 });
});

test('POST /api/builds/:id/share rejects an anonymous request with no owner token', async () => {
  const route = createBuildRoutes({
    getCurrentUser: async () => null,
    enableBuildSharing: async () => {
      throw new Error('Invalid saved build');
    }
  });
  const response = createMockResponse();
  const handled = await route(createRequest('POST', '/api/builds/7/share'), response);

  assert.equal(handled, true);
  assert.equal(response.statusCode, 400, 'anonymous sharing is allowed, but only with a valid owner token');
});

test('POST /api/builds/:id/share enables sharing for an anonymous build via its owner token', async () => {
  let calledWith;
  const route = createBuildRoutes({
    getCurrentUser: async () => null,
    enableBuildSharing: async (buildId, userId, authOptions) => {
      calledWith = { buildId, userId, authOptions };
      return { id: 7, shareToken: 'random-token' };
    }
  });
  const response = createMockResponse();
  const handled = await route(createJsonRequest('/api/builds/7/share', { ownerToken: 'secret-owner-token' }, 'POST'), response);

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calledWith, { buildId: '7', userId: 0, authOptions: { ownerToken: 'secret-owner-token' } });
});

test('POST /api/builds/:id/list adds a build to the public gallery for the owner', async () => {
  let calledWith;
  const route = createBuildRoutes({
    getCurrentUser: async () => ({ id: 11, username: 'bank', role: 'user' }),
    setBuildListed: async (buildId, userId, isListed, authOptions) => {
      calledWith = { buildId, userId, isListed, authOptions };
      return { id: 7, listed: true, shareToken: 'random-token' };
    }
  });
  const response = createMockResponse();
  const handled = await route(createRequest('POST', '/api/builds/7/list'), response);

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calledWith, { buildId: '7', userId: 11, isListed: true, authOptions: { ownerToken: '' } });
  assert.equal(JSON.parse(response.body).shareToken, 'random-token');
});

test('DELETE /api/builds/:id/list removes a build from the public gallery for the owner', async () => {
  let calledWith;
  const route = createBuildRoutes({
    getCurrentUser: async () => ({ id: 11, username: 'bank', role: 'user' }),
    setBuildListed: async (buildId, userId, isListed, authOptions) => {
      calledWith = { buildId, userId, isListed, authOptions };
      return { id: 7, listed: false };
    }
  });
  const response = createMockResponse();
  const handled = await route(createRequest('DELETE', '/api/builds/7/list'), response);

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calledWith, { buildId: '7', userId: 11, isListed: false, authOptions: { ownerToken: '' } });
});

test('POST /api/builds/:id/list lists an anonymous build via its owner token', async () => {
  let calledWith;
  const route = createBuildRoutes({
    getCurrentUser: async () => null,
    setBuildListed: async (buildId, userId, isListed, authOptions) => {
      calledWith = { buildId, userId, isListed, authOptions };
      return { id: 7, listed: true, shareToken: 'random-token' };
    }
  });
  const response = createMockResponse();
  const handled = await route(createJsonRequest('/api/builds/7/list', { ownerToken: 'secret-owner-token' }, 'POST'), response);

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calledWith, { buildId: '7', userId: 0, isListed: true, authOptions: { ownerToken: 'secret-owner-token' } });
});

test('PUT /api/builds/:id syncs items for an anonymous build via its owner token', async () => {
  let calledWith;
  const route = createBuildRoutes({
    getCurrentUser: async () => null,
    updateBuildItems: async (buildId, userId, syncedItems, authOptions) => {
      calledWith = { buildId, userId, syncedItems, authOptions };
      return { id: 7, total: 17612, items };
    }
  });
  const response = createMockResponse();
  const handled = await route(
    createJsonRequest('/api/builds/7', { items, ownerToken: 'secret-owner-token' }, 'PUT'),
    response
  );

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calledWith, {
    buildId: '7',
    userId: 0,
    syncedItems: items,
    authOptions: { ownerToken: 'secret-owner-token' }
  });
});

test('POST /api/builds creates an anonymous build without requiring login', async () => {
  let requestPayload;
  const route = createBuildRoutes({
    getCurrentUser: async () => null,
    saveBuild: async (payload) => {
      requestPayload = payload;
      return { id: 9, name: 'Saved', total: 17612, items, ownerToken: 'secret-owner-token' };
    }
  });
  const response = createMockResponse();
  const handled = await route(createJsonRequest('/api/builds', { items }), response);

  assert.equal(handled, true);
  assert.equal(response.statusCode, 201);
  assert.equal(requestPayload.userId, 0);
  assert.equal(JSON.parse(response.body).build.ownerToken, 'secret-owner-token');
});

test('enableBuildSharing authorizes an anonymous build via a matching owner token', async () => {
  const queries = [];
  const result = await enableBuildSharing(7, 0, {
    ownerToken: 'secret-owner-token',
    runQuery: async (query) => {
      queries.push(query);
      return '1';
    }
  });

  assert.equal(result.id, 7);
  assert.match(
    queries[0],
    /UPDATE builds SET share_token = '.+' WHERE id = 7 AND user_id IS NULL AND owner_token = 'secret-owner-token'/
  );
});

test('enableBuildSharing rejects an anonymous request with no owner token at all', async () => {
  await assert.rejects(
    enableBuildSharing(7, 0, { runQuery: async () => '1' }),
    /Invalid saved build/
  );
});

test('GET /api/public/builds/:token returns the build with no login required', async () => {
  const route = createPublicBuildRoutes({
    getPublicBuild: async (token) => {
      assert.equal(token, 'abc123');
      return { id: 7, name: 'Saved Gaming Build', total: 17612, items };
    }
  });
  const response = createMockResponse();
  const handled = await route(createRequest('GET', '/api/public/builds/abc123'), response);

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).build.id, 7);
});

test('GET /api/public/builds/:token returns 404 for an unknown or revoked token', async () => {
  const route = createPublicBuildRoutes({
    getPublicBuild: async () => null
  });
  const response = createMockResponse();
  const handled = await route(createRequest('GET', '/api/public/builds/does-not-exist'), response);

  assert.equal(handled, true);
  assert.equal(response.statusCode, 404);
});

test('GET /api/public/builds returns the gallery list with no login required', async () => {
  let calledWith;
  const route = createPublicBuildRoutes({
    listGalleryBuilds: async (options) => {
      calledWith = options;
      return { builds: [{ id: 7, name: 'Saved Gaming Build', total: 17612, shareToken: 'abc' }], total: 1, limit: 12, offset: 0 };
    }
  });
  const response = createMockResponse();
  const handled = await route(createRequest('GET', '/api/public/builds?limit=12&offset=0'), response);

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calledWith, { limit: '12', offset: '0' });
  assert.equal(JSON.parse(response.body).builds.length, 1);
});

function createJsonRequest(url, payload, method = 'POST') {
  return {
    ...createRequest(method, url),
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(payload));
    }
  };
}

function createRequest(method, url) {
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {
    }
  };
}

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

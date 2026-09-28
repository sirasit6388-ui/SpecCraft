import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAdminRoutes } from '../routes/admin.routes.js';
import { createAdminProduct } from '../services/admin-products.service.js';
import { updateAdminUser } from '../services/admin-users.service.js';

test('admin product routes reject anonymous and standard users', async () => {
  const anonymousRoute = createAdminRoutes({ getCurrentUser: async () => null });
  const userRoute = createAdminRoutes({ getCurrentUser: async () => ({ id: 2, role: 'user' }) });

  const anonymousResponse = createMockResponse();
  const userResponse = createMockResponse();

  await anonymousRoute(createRequest('GET', '/api/admin/products'), anonymousResponse);
  await userRoute(createRequest('GET', '/api/admin/products'), userResponse);

  assert.equal(anonymousResponse.statusCode, 401);
  assert.equal(userResponse.statusCode, 403);
});

test('admin product routes support list, create, update, and delete', async () => {
  const calls = [];
  const route = createAdminRoutes({
    getCurrentUser: async () => ({ id: 1, role: 'admin' }),
    listProducts: async (filters) => {
      calls.push(['list', filters]);
      return { products: [{ id: 7, name: 'CPU' }], total: 1, limit: 20, offset: 0 };
    },
    createProduct: async (payload) => {
      calls.push(['create', payload]);
      return { id: 8, ...payload };
    },
    updateProduct: async (id, payload) => {
      calls.push(['update', id, payload]);
      return { id: Number(id), ...payload };
    },
    deleteProduct: async (id) => {
      calls.push(['delete', id]);
      return { id: Number(id) };
    },
    recordActivity: async (entry) => {
      calls.push(['audit', entry.action, entry.targetId]);
    }
  });

  const listResponse = createMockResponse();
  const createResponse = createMockResponse();
  const updateResponse = createMockResponse();
  const deleteResponse = createMockResponse();

  await route(createRequest('GET', '/api/admin/products?search=ryzen&limit=20'), listResponse);
  await route(createJsonRequest('POST', '/api/admin/products', { category: 'cpu', name: 'Ryzen', priceThb: 8990 }), createResponse);
  await route(createJsonRequest('PUT', '/api/admin/products/8', { category: 'cpu', name: 'Ryzen Updated', priceThb: 9990 }), updateResponse);
  await route(createRequest('DELETE', '/api/admin/products/8'), deleteResponse);

  assert.equal(listResponse.statusCode, 200);
  assert.equal(createResponse.statusCode, 201);
  assert.equal(updateResponse.statusCode, 200);
  assert.equal(deleteResponse.statusCode, 200);
  assert.deepEqual(calls[0], ['list', { search: 'ryzen', limit: '20', offset: '' }]);
  assert.deepEqual(calls.find((call) => call[0] === 'delete'), ['delete', '8']);
  assert.deepEqual(calls.filter((call) => call[0] === 'audit').map((call) => call[1]), ['product.create', 'product.update', 'product.delete']);
});

// แอดมิน "ถอดสเปคออกจากคลังสาธารณะ" (ปุ่มบนหน้า "สเปคทั้งหมด") - ดูคอมเมนต์ที่
// adminUnlistBuild ใน builds.service.js ว่าทำไมไม่ใช้ endpoint DELETE .../list เดิม
// ของเจ้าของสเปคเอง (endpoint นี้ไม่เช็คความเป็นเจ้าของเลย ถอดของใครก็ได้)
test('admin build routes unlist a build from the public gallery and record it in the audit log', async () => {
  const calls = [];
  const route = createAdminRoutes({
    getCurrentUser: async () => ({ id: 1, role: 'admin' }),
    unlistBuild: async (id) => {
      calls.push(['unlist', id]);
      return { id: Number(id), listed: false };
    },
    recordActivity: async (entry) => {
      calls.push(['audit', entry.action, entry.targetType, entry.targetId]);
    }
  });

  const response = createMockResponse();
  await route(createRequest('DELETE', '/api/admin/builds/42/list'), response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body).build, { id: 42, listed: false });
  assert.deepEqual(calls, [
    ['unlist', '42'],
    ['audit', 'build.unlist', 'build', 42]
  ]);
});

test('admin build unlist route rejects anonymous and standard users', async () => {
  const anonymousRoute = createAdminRoutes({ getCurrentUser: async () => null });
  const userRoute = createAdminRoutes({ getCurrentUser: async () => ({ id: 2, role: 'user' }) });

  const anonymousResponse = createMockResponse();
  const userResponse = createMockResponse();

  await anonymousRoute(createRequest('DELETE', '/api/admin/builds/42/list'), anonymousResponse);
  await userRoute(createRequest('DELETE', '/api/admin/builds/42/list'), userResponse);

  assert.equal(anonymousResponse.statusCode, 401);
  assert.equal(userResponse.statusCode, 403);
});

test('admin routes manage users and return audit logs', async () => {
  const calls = [];
  const route = createAdminRoutes({
    getCurrentUser: async () => ({ id: 1, role: 'admin' }),
    listUsers: async () => ({ users: [{ id: 2, username: 'bank', role: 'user', isActive: true }], total: 1 }),
    updateUser: async (id, payload, actor) => {
      calls.push(['update-user', id, payload, actor.id]);
      return { id: Number(id), username: 'bank', ...payload };
    },
    listAuditLogs: async (filters) => {
      calls.push(['list-audit', filters]);
      return { logs: [{ id: 1, action: 'user.update' }], total: 1 };
    },
    recordActivity: async (entry) => calls.push(['audit', entry.action, entry.targetId])
  });
  const usersResponse = createMockResponse();
  const updateResponse = createMockResponse();
  const auditResponse = createMockResponse();

  await route(createRequest('GET', '/api/admin/users?search=bank'), usersResponse);
  await route(createJsonRequest('PATCH', '/api/admin/users/2', { role: 'admin', isActive: true }), updateResponse);
  await route(createRequest('GET', '/api/admin/audit-logs?search=bank&limit=10&offset=20'), auditResponse);

  assert.equal(usersResponse.statusCode, 200);
  assert.equal(updateResponse.statusCode, 200);
  assert.equal(auditResponse.statusCode, 200);
  assert.deepEqual(calls[0], ['update-user', '2', { role: 'admin', isActive: true }, 1]);
  assert.deepEqual(calls[1], ['audit', 'user.update', 2]);
  assert.deepEqual(calls[2], ['list-audit', { search: 'bank', limit: '10', offset: '20' }]);
});

test('admin routes return dashboard data and accept validated product image uploads', async () => {
  const activities = [];
  const deletedImages = [];
  const route = createAdminRoutes({
    getCurrentUser: async () => ({ id: 1, role: 'admin' }),
    getDashboard: async () => ({
      products: 10,
      users: 2,
      productCategories: [{ category: 'cpu', total: 4 }],
      savedBuildModes: [{ mode: 'gaming', total: 3 }],
      recentActivities: []
    }),
    saveProductImage: async (payload) => {
      assert.equal(payload.mimeType, 'image/png');
      return { imageUrl: '/uploads/product.png' };
    },
    deleteProductImage: async (imageUrl) => {
      deletedImages.push(imageUrl);
      return { deleted: true };
    },
    recordActivity: async (entry) => activities.push(entry)
  });
  const dashboardResponse = createMockResponse();
  const uploadResponse = createMockResponse();
  const deleteImageResponse = createMockResponse();

  await route(createRequest('GET', '/api/admin/dashboard'), dashboardResponse);
  await route(createJsonRequest('POST', '/api/admin/product-images', { mimeType: 'image/png', data: 'iVBORw0=' }), uploadResponse);
  await route(createRequest('DELETE', '/api/admin/product-images?imageUrl=%2Fuploads%2Fproduct.png'), deleteImageResponse);

  assert.equal(dashboardResponse.statusCode, 200);
  const dashboard = JSON.parse(dashboardResponse.body).dashboard;
  assert.equal(dashboard.products, 10);
  assert.deepEqual(dashboard.productCategories, [{ category: 'cpu', total: 4 }]);
  assert.deepEqual(dashboard.savedBuildModes, [{ mode: 'gaming', total: 3 }]);
  assert.equal(uploadResponse.statusCode, 201);
  assert.equal(JSON.parse(uploadResponse.body).imageUrl, '/uploads/product.png');
  assert.equal(deleteImageResponse.statusCode, 200);
  assert.deepEqual(deletedImages, ['/uploads/product.png']);
  assert.equal(activities[0].action, 'product.image-upload');
});

test('admin products reject unsafe URLs and invalid specification data before writing to MySQL', async () => {
  await assert.rejects(
    () => createAdminProduct({ category: 'cpu', name: 'Unsafe CPU', priceThb: 5000, imageUrl: 'javascript:alert(1)' }),
    /Image URL must be a valid http or https URL/
  );
  await assert.rejects(
    () => createAdminProduct({ category: 'cpu', name: 'Invalid Specs CPU', priceThb: 5000, specs: '[]' }),
    /Specifications must be a JSON object/
  );
  await assert.rejects(
    () => createAdminProduct({ category: 'cpu', name: 'Unsafe Local CPU', priceThb: 5000, imageUrl: '/uploads/not-a-product.txt' }),
    /Image URL must be a valid http or https URL/
  );
});

test('admin cannot disable or demote their own account', async () => {
  await assert.rejects(
    () => updateAdminUser(1, { role: 'user', isActive: true }, { id: 1, role: 'admin' }),
    /cannot remove your own admin access/
  );
  await assert.rejects(
    () => updateAdminUser(1, { role: 'admin', isActive: false }, { id: 1, role: 'admin' }),
    /cannot remove your own admin access/
  );
});

function createJsonRequest(method, url, payload) {
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
    headers: {},
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

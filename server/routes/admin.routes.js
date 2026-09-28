import { getCurrentUser as getCurrentUserService } from '../services/auth.service.js';
import {
  createAdminProduct,
  deleteAdminProduct,
  getAdminProduct,
  listAdminProducts,
  updateAdminProduct
} from '../services/admin-products.service.js';
import { adminUnlistBuild as adminUnlistBuildService } from '../services/builds.service.js';
import { listAdminAuditLogs, recordAdminActivity } from '../services/admin-audit.service.js';
import { getAdminDashboard } from '../services/admin-dashboard.service.js';
import { deleteUnusedProductImage, saveAdminProductImage } from '../services/admin-images.service.js';
import { listAdminUsers, updateAdminUser } from '../services/admin-users.service.js';
import { sendJson } from '../utils/api-response.js';
import { readJsonBody } from '../utils/read-json-body.js';

export function createAdminRoutes(options = {}) {
  const getCurrentUser = options.getCurrentUser || getCurrentUserService;
  const listProducts = options.listProducts || listAdminProducts;
  const getProduct = options.getProduct || getAdminProduct;
  const createProduct = options.createProduct || createAdminProduct;
  const updateProduct = options.updateProduct || updateAdminProduct;
  const deleteProduct = options.deleteProduct || deleteAdminProduct;
  const listUsers = options.listUsers || listAdminUsers;
  const updateUser = options.updateUser || updateAdminUser;
  const listAuditLogs = options.listAuditLogs || listAdminAuditLogs;
  const recordActivity = options.recordActivity || recordAdminActivity;
  const getDashboard = options.getDashboard || getAdminDashboard;
  const saveProductImage = options.saveProductImage || saveAdminProductImage;
  const deleteProductImage = options.deleteProductImage || deleteUnusedProductImage;
  const unlistBuild = options.unlistBuild || adminUnlistBuildService;

  return async function adminRoutes(request, response) {
    const requestUrl = new URL(request.url, 'http://localhost');

    if (!requestUrl.pathname.startsWith('/api/admin/')) {
      return false;
    }

    const user = await getCurrentUser(request);

    if (!user) {
      sendJson(response, 401, { error: 'Authentication required' });
      return true;
    }

    if (user.role !== 'admin') {
      sendJson(response, 403, { error: 'Admin access required' });
      return true;
    }

    try {
      const productId = requestUrl.pathname.match(/^\/api\/admin\/products\/(\d+)$/)?.[1];
      const userId = requestUrl.pathname.match(/^\/api\/admin\/users\/(\d+)$/)?.[1];
      const unlistBuildId = requestUrl.pathname.match(/^\/api\/admin\/builds\/(\d+)\/list$/)?.[1];

      // แอดมิน "ถอดสเปคออกจากคลังสาธารณะ" (หน้า "สเปคทั้งหมด") - ดูคอมเมนต์ที่
      // adminUnlistBuild ใน builds.service.js ว่าทำไมไม่ใช้ setBuildListed เดิม
      if (request.method === 'DELETE' && unlistBuildId) {
        const unlisted = await unlistBuild(unlistBuildId);
        await recordActivity({ actorId: user.id, action: 'build.unlist', targetType: 'build', targetId: unlisted.id, details: {} });
        sendJson(response, 200, { build: unlisted });
        return true;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/api/admin/dashboard') {
        sendJson(response, 200, { dashboard: await getDashboard() });
        return true;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/admin/product-images') {
        const image = await saveProductImage(await readJsonBody(request, { maxBytes: 3 * 1024 * 1024 }));
        await recordActivity({ actorId: user.id, action: 'product.image-upload', targetType: 'product-image', details: {} });
        sendJson(response, 201, image);
        return true;
      }

      if (request.method === 'DELETE' && requestUrl.pathname === '/api/admin/product-images') {
        const result = await deleteProductImage(requestUrl.searchParams.get('imageUrl') || '');
        sendJson(response, 200, result);
        return true;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/api/admin/users') {
        sendJson(response, 200, await listUsers({
          search: requestUrl.searchParams.get('search') || '',
          limit: requestUrl.searchParams.get('limit') || '',
          offset: requestUrl.searchParams.get('offset') || ''
        }));
        return true;
      }

      if (request.method === 'PATCH' && userId) {
        const updatedUser = await updateUser(userId, await readJsonBody(request), user);
        await recordActivity({
          actorId: user.id,
          action: 'user.update',
          targetType: 'user',
          targetId: updatedUser.id,
          details: { username: updatedUser.username, role: updatedUser.role, isActive: updatedUser.isActive }
        });
        sendJson(response, 200, { user: updatedUser });
        return true;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/api/admin/audit-logs') {
        sendJson(response, 200, await listAuditLogs({
          search: requestUrl.searchParams.get('search') || '',
          limit: requestUrl.searchParams.get('limit') || '',
          offset: requestUrl.searchParams.get('offset') || ''
        }));
        return true;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/api/admin/products') {
        sendJson(response, 200, await listProducts({
          search: requestUrl.searchParams.get('search') || '',
          category: requestUrl.searchParams.get('category') || '',
          limit: requestUrl.searchParams.get('limit') || '',
          offset: requestUrl.searchParams.get('offset') || ''
        }));
        return true;
      }

      if (request.method === 'GET' && productId) {
        const product = await getProduct(productId);
        sendJson(response, product ? 200 : 404, product ? { product } : { error: 'Product not found' });
        return true;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/admin/products') {
        const product = await createProduct(await readJsonBody(request));
        await recordActivity({ actorId: user.id, action: 'product.create', targetType: 'product', targetId: product.id, details: { name: product.name, category: product.category } });
        sendJson(response, 201, { product });
        return true;
      }

      if (request.method === 'PUT' && productId) {
        const product = await updateProduct(productId, await readJsonBody(request));
        await deleteProductImage(product.previousImageUrl || '');
        await recordActivity({ actorId: user.id, action: 'product.update', targetType: 'product', targetId: product.id, details: { name: product.name, category: product.category } });
        sendJson(response, 200, { product });
        return true;
      }

      if (request.method === 'DELETE' && productId) {
        const deleted = await deleteProduct(productId);
        await deleteProductImage(deleted.imageUrl || '');
        await recordActivity({ actorId: user.id, action: 'product.delete', targetType: 'product', targetId: deleted.id, details: {} });
        sendJson(response, 200, { deleted });
        return true;
      }
    } catch (error) {
      sendJson(response, error.code === 'REQUEST_BODY_TOO_LARGE' ? 413 : 400, { error: 'Admin product request failed', message: error.message });
      return true;
    }

    return false;
  };
}

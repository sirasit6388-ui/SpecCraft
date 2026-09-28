import {
  deleteSavedBuild as deleteSavedBuildService,
  disableBuildSharing as disableBuildSharingService,
  enableBuildSharing as enableBuildSharingService,
  getPublicBuildByShareToken as getPublicBuildByShareTokenService,
  listPublicGalleryBuilds as listPublicGalleryBuildsService,
  listSavedBuilds,
  saveBuild as saveBuildService,
  setBuildListed as setBuildListedService,
  updateBuildItems as updateBuildItemsService
} from '../services/builds.service.js';
import { getCurrentUser as getCurrentUserService } from '../services/auth.service.js';
import { sendJson } from '../utils/api-response.js';
import { readJsonBody } from '../utils/read-json-body.js';

export function createBuildRoutes(options = {}) {
  const getCurrentUser = options.getCurrentUser || getCurrentUserService;
  const listBuilds = options.listBuilds || listSavedBuilds;
  const saveBuild = options.saveBuild || saveBuildService;
  const deleteBuild = options.deleteBuild || deleteSavedBuildService;
  const enableBuildSharing = options.enableBuildSharing || enableBuildSharingService;
  const disableBuildSharing = options.disableBuildSharing || disableBuildSharingService;
  const updateBuildItems = options.updateBuildItems || updateBuildItemsService;
  const setBuildListed = options.setBuildListed || setBuildListedService;

  return async function buildRoutes(request, response) {
    const requestUrl = new URL(request.url, 'http://localhost');

    const shareBuildId = requestUrl.pathname.match(/^\/api\/builds\/(\d+)\/share$/)?.[1];
    const listBuildId = requestUrl.pathname.match(/^\/api\/builds\/(\d+)\/list$/)?.[1];
    const buildId = requestUrl.pathname.match(/^\/api\/builds\/(\d+)$/)?.[1];

    if (requestUrl.pathname !== '/api/builds' && !buildId && !shareBuildId && !listBuildId) {
      return false;
    }

    try {
      const user = await getCurrentUser(request);

      // เปิด/ปิดแชร์ลิงก์ - รองรับทั้งคนล็อกอิน (เช็คด้วย user_id จาก session) และคน
      // จัดสเปคแบบไม่ล็อกอิน (เช็คด้วย ownerToken ลับที่ฝั่งหน้าเว็บส่งมาใน body แทน
      // ดู buildOwnerWhereClause ใน builds.service.js) ไม่บังคับล็อกอินเหมือนก่อนหน้านี้
      if (shareBuildId && (request.method === 'POST' || request.method === 'DELETE')) {
        const body = await readJsonBody(request);
        const authOptions = { ownerToken: body.ownerToken || '' };
        const result = request.method === 'POST'
          ? await enableBuildSharing(shareBuildId, user?.id || 0, authOptions)
          : await disableBuildSharing(shareBuildId, user?.id || 0, authOptions);

        sendJson(response, 200, result);
        return true;
      }

      if (shareBuildId) {
        return false;
      }

      // ลง/ถอนออกจากคลังสาธารณะ - แยกอิสระจากปุ่มแชร์ลิงก์ด้านบน (ดูคอมเมนต์ที่
      // setBuildListed ใน builds.service.js) รองรับคนไม่ล็อกอินผ่าน ownerToken เหมือนกัน
      if (listBuildId && (request.method === 'POST' || request.method === 'DELETE')) {
        const body = await readJsonBody(request);
        const authOptions = { ownerToken: body.ownerToken || '' };
        const result = await setBuildListed(
          listBuildId,
          user?.id || 0,
          request.method === 'POST',
          authOptions
        );

        sendJson(response, 200, result);
        return true;
      }

      if (listBuildId) {
        return false;
      }

      // ดูรายการสเปคที่บันทึกไว้ (หน้าประวัติ) ผูกกับบัญชีเสมอ ต้องล็อกอินเท่านั้น
      if (request.method === 'GET') {
        if (!user) {
          sendJson(response, 401, {
            error: 'Authentication required',
            message: 'Please log in before using saved builds'
          });
          return true;
        }

        const result = await listBuilds({
          userId: user.id,
          user,
          limit: requestUrl.searchParams.get('limit') || '',
          offset: requestUrl.searchParams.get('offset') || ''
        });
        const builds = Array.isArray(result) ? result : result.builds || [];
        sendJson(response, 200, {
          builds,
          total: Array.isArray(result) ? builds.length : Number(result.total || 0),
          limit: Array.isArray(result) ? builds.length : Number(result.limit || 0),
          offset: Array.isArray(result) ? 0 : Number(result.offset || 0)
        });
        return true;
      }

      // ลบสเปคที่บันทึกไว้ถาวร ยังคงบังคับล็อกอินไว้ก่อน (คนไม่ล็อกอินยกเลิกแชร์
      // ได้อยู่แล้วผ่าน DELETE .../share ด้านบน แค่ลบแถวถาวรไม่รองรับ)
      if (request.method === 'DELETE' && buildId) {
        if (!user) {
          sendJson(response, 401, {
            error: 'Authentication required',
            message: 'Please log in before using saved builds'
          });
          return true;
        }

        sendJson(response, 200, { build: await deleteBuild(buildId, user.id) });
        return true;
      }

      // ใช้ตอนแก้ตะกร้าต่อหลังจากแชร์ลิงก์ไปแล้ว - อัปเดตแค่รายการสินค้า/ยอดรวม
      // ของ build เดิม (id เดิม, share_token เดิม) ไม่สร้าง build ใหม่ เพื่อให้ลิงก์
      // เดิมที่แชร์ไปแล้วอัปเดตตามตะกร้าปัจจุบันได้ทันที ไม่ใช่ภาพนิ่งค้างของเก่า -
      // รองรับคนไม่ล็อกอินด้วย (ownerToken) เหมือนกับปุ่มแชร์ด้านบน
      if (request.method === 'PUT' && buildId) {
        const body = await readJsonBody(request);
        const build = await updateBuildItems(buildId, user?.id || 0, body.items, {
          ownerToken: body.ownerToken || ''
        });

        sendJson(response, 200, { build });
        return true;
      }

      if (request.method !== 'POST' || buildId) {
        return false;
      }

      // บันทึกสเปคใหม่ - คนไม่ล็อกอินก็บันทึก/แชร์ลิงก์ได้เหมือนกัน (จะได้ owner
      // Token กลับมาแทนบัญชี ดู createBuildSnapshot ใน builds.service.js) ส่วนหน้า
      // "ประวัติ" ของตัวเองยังต้องล็อกอินอยู่ดี เพราะผูกกับ user_id เท่านั้น
      //
      // saveToHistory: false มาจากปุ่ม "แชร์สเปคนี้แบบลิงก์สาธารณะ" ตรงๆ (ดู
      // shareCurrentCart ใน main.js) ที่ยังไม่เคยกด "บันทึกสเปค" มาก่อน - ต้องสร้างแถว
      // build จริงเพื่อให้แชร์ลิงก์ได้ แต่ผู้ใช้ไม่ได้ตั้งใจบันทึกมันเข้าหน้าประวัติ
      // ถ้าไม่ส่งมาเลย (undefined) ถือว่าเป็นการบันทึกปกติเหมือนเดิม (true)
      const body = await readJsonBody(request);
      const build = await saveBuild({
        userId: user?.id || 0,
        name: body.name,
        mode: body.mode,
        items: body.items,
        hiddenFromHistory: body.saveToHistory === false
      });

      sendJson(response, 201, { build });
    } catch (error) {
      sendJson(response, error.code === 'REQUEST_BODY_TOO_LARGE' ? 413 : 400, {
        error: 'Cannot save build',
        message: error.message
      });
    }

    return true;
  };
}

// เส้นทางแยกต่างหาก ไม่ผ่าน getCurrentUser เลย - เจตนาให้คนที่ไม่ได้ล็อกอินก็เปิด
// ลิงก์แชร์สาธารณะดูสเปคได้ (ตรงข้ามกับ /api/builds ด้านบนที่บังคับล็อกอินทุก method)
export function createPublicBuildRoutes(options = {}) {
  const getPublicBuild = options.getPublicBuild || getPublicBuildByShareTokenService;
  const listGalleryBuilds = options.listGalleryBuilds || listPublicGalleryBuildsService;

  return async function publicBuildRoutes(request, response) {
    const requestUrl = new URL(request.url, 'http://localhost');
    const token = requestUrl.pathname.match(/^\/api\/public\/builds\/([\w-]+)$/)?.[1];
    const isGalleryList = requestUrl.pathname === '/api/public/builds';

    if (request.method !== 'GET' || (!token && !isGalleryList)) {
      return false;
    }

    try {
      // คลังสาธารณะ - รายการสเปคที่ถูกกด "ลงคลัง" ไว้ (ดู listPublicGalleryBuilds ใน
      // builds.service.js) ไม่ต้องล็อกอินเหมือนกับการดูสเปคเดี่ยวจากลิงก์แชร์ด้านล่าง
      if (isGalleryList) {
        const result = await listGalleryBuilds({
          limit: requestUrl.searchParams.get('limit') || '',
          offset: requestUrl.searchParams.get('offset') || ''
        });

        sendJson(response, 200, result);
        return true;
      }

      const build = await getPublicBuild(token);

      if (!build) {
        sendJson(response, 404, {
          error: 'Not Found',
          message: 'This build is not shared or no longer exists'
        });
        return true;
      }

      sendJson(response, 200, { build });
    } catch (error) {
      sendJson(response, 400, {
        error: 'Cannot load shared build',
        message: error.message
      });
    }

    return true;
  };
}

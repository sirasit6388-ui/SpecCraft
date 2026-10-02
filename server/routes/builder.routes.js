import { createBuildRecommendation, describeBuild } from '../services/builder.service.js';
import { sendJson } from '../utils/api-response.js';
import { readJsonBody } from '../utils/read-json-body.js';

const CHECKABLE_CATEGORIES = new Set([
  'cpu', 'motherboard', 'video-card', 'memory', 'internal-hard-drive',
  'power-supply', 'case', 'cpu-cooler', 'monitor'
]);

export function createBuilderRoutes(options = {}) {
  const recommendBuild = options.recommendBuild || createBuildRecommendation;
  const checkBuild = options.checkBuild || describeBuild;

  return async function builderRoutes(request, response) {
    const requestUrl = new URL(request.url, 'http://localhost');

    // ตรวจความเข้ากันได้ของสเปคที่ผู้ใช้แก้ต่อเองหลังจัดอัตโนมัติ (ใช้อัปเดตกรอบ "สเปคที่ระบบแนะนำ")
    // คำนวณอย่างเดียว ไม่แตะฐานข้อมูล รับได้ไม่เกิน 30 ชิ้น และเฉพาะหมวดที่ระบบรู้จัก
    if (request.method === 'POST' && requestUrl.pathname === '/api/build/check') {
      try {
        const body = await readJsonBody(request);

        if (!Array.isArray(body.items) || body.items.length > 30) {
          sendJson(response, 400, { error: 'Cannot check build', message: 'items must be an array of at most 30 products' });
          return true;
        }

        const items = body.items.filter((item) => item && typeof item === 'object' && CHECKABLE_CATEGORIES.has(item.category));
        sendJson(response, 200, { check: checkBuild(items) });
      } catch (error) {
        sendJson(response, error.code === 'REQUEST_BODY_TOO_LARGE' ? 413 : 400, {
          error: 'Cannot check build',
          message: error.message
        });
      }

      return true;
    }

    if (request.method !== 'POST' || requestUrl.pathname !== '/api/build/recommend') {
      return false;
    }

    try {
      const body = await readJsonBody(request);
      const build = await recommendBuild({
        mode: body.mode,
        budget: body.budget,
        cpuBrand: body.cpuBrand,
        includeMonitor: body.includeMonitor === true
      });

      sendJson(response, 200, { build });
    } catch (error) {
      sendJson(response, error.code === 'REQUEST_BODY_TOO_LARGE' ? 413 : 400, {
        error: 'Cannot recommend build',
        message: error.message
      });
    }

    return true;
  };
}

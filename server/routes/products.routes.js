import { filterCompatibleProducts } from '../services/builder.service.js';
import { normalizeMonitorFilters } from '../services/monitor-filters.js';
import { listCategories, listProductFilters, listProducts, normalizeAvailability, normalizeLimit, normalizeOffset } from '../services/products.service.js';
import { sendJson } from '../utils/api-response.js';

const SELECTED_PRODUCT_KEYS = ['cpu', 'motherboard', 'videoCard', 'case', 'cpuCooler'];
// Cap on how many category candidates we pull from the DB before filtering
// by compatibility in JS - the DB's own LIMIT/OFFSET can't produce the final
// page once a JS filter runs after it, so this stands in as "the whole
// category" for pagination purposes. Matches normalizeLimit's own ceiling.
const COMPATIBILITY_POOL_LIMIT = 1000;

// `selected` arrives as a JSON object of the manual builder's current cart,
// keyed by SELECTED_PRODUCT_KEYS - e.g. { cpu: {...}, motherboard: {...} }.
// Parsed defensively since it's client-supplied: anything malformed or
// carrying unexpected keys just means "no compatibility filtering" rather
// than a request error.
function parseSelectedProducts(raw) {
  if (!raw) {
    return null;
  }

  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const selected = {};

  for (const key of SELECTED_PRODUCT_KEYS) {
    if (parsed[key] && typeof parsed[key] === 'object' && !Array.isArray(parsed[key])) {
      selected[key] = parsed[key];
    }
  }

  return Object.keys(selected).length ? selected : null;
}

export function createProductRoutes(options = {}) {
  const getCategories = options.listCategories || listCategories;
  const getProductFilters = options.listProductFilters || listProductFilters;
  const getProducts = options.listProducts || listProducts;
  const filterCompatible = options.filterCompatibleProducts || filterCompatibleProducts;

  return async function productRoutes(request, response) {
    const requestUrl = new URL(request.url, 'http://localhost');

    if (request.method !== 'GET') {
      return false;
    }

    if (requestUrl.pathname === '/api/categories') {
      try {
        sendJson(response, 200, {
          categories: await getCategories()
        });
      } catch (error) {
        sendJson(response, 503, {
          error: 'Cannot load categories',
          message: error.message
        });
      }

      return true;
    }

    if (requestUrl.pathname === '/api/products') {
      try {
        const category = requestUrl.searchParams.get('category') || '';
        const baseFilters = {
          category,
          brand: requestUrl.searchParams.get('brand') || '',
          series: requestUrl.searchParams.get('series') || '',
          socket: requestUrl.searchParams.get('socket') || '',
          search: requestUrl.searchParams.get('search') || ''
        };
        // ใส่เฉพาะเมื่อเป็นค่าที่อนุญาต (th / not-th / unknown) - ไม่ใส่คีย์ว่างเพื่อให้รูปแบบตัวกรองเดิมไม่เปลี่ยน
        const availability = normalizeAvailability(requestUrl.searchParams.get('availability'));

        if (availability) {
          baseFilters.availability = availability;
        }

        // ตัวกรองสเปคจอ: รับเฉพาะค่าที่อยู่ในรายการอนุญาต (ค่าแปลกถูกทิ้ง) และมีผลเฉพาะหมวด monitor
        Object.assign(baseFilters, normalizeMonitorFilters(requestUrl.searchParams));

        // Only meaningful (and only parsed) when browsing a single category -
        // that's the manual builder's "pick a part" view, the only place a
        // cross-category compatibility filter makes sense.
        const selected = category ? parseSelectedProducts(requestUrl.searchParams.get('selected')) : null;

        let products;
        let total;
        let limit;
        let offset;

        if (selected) {
          const pool = await getProducts({ ...baseFilters, limit: String(COMPATIBILITY_POOL_LIMIT), offset: '0' });
          const poolProducts = Array.isArray(pool) ? pool : pool.products;
          const filtered = filterCompatible(category, poolProducts, selected);

          limit = normalizeLimit(requestUrl.searchParams.get('limit') || '');
          offset = normalizeOffset(requestUrl.searchParams.get('offset') || '');
          products = filtered.slice(offset, offset + limit);
          total = filtered.length;
        } else {
          const productResult = await getProducts({
            ...baseFilters,
            limit: requestUrl.searchParams.get('limit') || '',
            offset: requestUrl.searchParams.get('offset') || ''
          });

          products = Array.isArray(productResult) ? productResult : productResult.products;
          total = Array.isArray(productResult) ? products.length : productResult.total;
          limit = Array.isArray(productResult) ? products.length : productResult.limit;
          offset = Array.isArray(productResult) ? 0 : productResult.offset;
        }

        sendJson(response, 200, { products, total, limit, offset });
      } catch (error) {
        sendJson(response, 503, {
          error: 'Cannot load products',
          message: error.message
        });
      }

      return true;
    }

    if (requestUrl.pathname === '/api/product-filters') {
      try {
        sendJson(response, 200, {
          filters: await getProductFilters({
            category: requestUrl.searchParams.get('category') || '',
            brand: requestUrl.searchParams.get('brand') || ''
          })
        });
      } catch (error) {
        sendJson(response, 503, {
          error: 'Cannot load product filters',
          message: error.message
        });
      }

      return true;
    }

    return false;
  };
}

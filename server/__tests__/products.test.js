import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createProductRoutes } from '../routes/products.routes.js';
import { buildFilterWhere, buildWhereClause, escapeSqlString, normalizeAvailability, normalizeLimit, normalizeOffset, toThaiBahtExpression } from '../services/products.service.js';

test('normalizeLimit keeps product list requests bounded', () => {
  assert.equal(normalizeLimit('12'), 12);
  assert.equal(normalizeLimit('999'), 999);
  assert.equal(normalizeLimit('5000'), 1000);
  assert.equal(normalizeLimit('bad'), 24);
});

test('normalizeOffset keeps product pages non-negative and bounded', () => {
  assert.equal(normalizeOffset('48'), 48);
  assert.equal(normalizeOffset('-12'), 0);
  assert.equal(normalizeOffset('bad'), 0);
  assert.equal(normalizeOffset('200000'), 100000);
});

test('escapeSqlString escapes quotes and backslashes', () => {
  assert.equal(escapeSqlString("AMD\\Ryzen's"), "AMD\\\\Ryzen\\'s");
});

test('buildFilterWhere ignores brand by default, so the brand option list itself is not narrowed', () => {
  const where = buildFilterWhere({ category: 'cpu', brand: 'AMD' });
  assert.equal(where, "WHERE category = 'cpu'");
});

test('buildFilterWhere includes brand when includeBrand is set, so series/socket lists are scoped to the selected brand', () => {
  const where = buildFilterWhere({ category: 'cpu', brand: 'AMD' }, '', { includeBrand: true });
  assert.equal(where, "WHERE category = 'cpu' AND brand = 'AMD'");
});

test('buildFilterWhere skips the brand clause when includeBrand is set but no brand is selected', () => {
  const where = buildFilterWhere({ category: 'cpu' }, '', { includeBrand: true });
  assert.equal(where, "WHERE category = 'cpu'");
});

test('toThaiBahtExpression converts imported PCPartPicker and USD prices with the configured rate', () => {
  const expression = toThaiBahtExpression('price', 'price_currency', 'source', 36.72);

  assert.match(expression, /UPPER/);
  assert.match(expression, /'THB'/);
  assert.match(expression, /'USD'/);
  assert.match(expression, /pcpartpicker-docyx/);
  assert.match(expression, /36\.72/);
});

test('GET /api/categories returns product categories', async () => {
  const route = createProductRoutes({
    listCategories: async () => [{ category: 'cpu', count: 90 }]
  });
  const response = createMockResponse();
  const handled = await route({ method: 'GET', url: '/api/categories' }, response);

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    categories: [{ category: 'cpu', count: 90 }]
  });
});

test('GET /api/products forwards query filters', async () => {
  let filters;
  const route = createProductRoutes({
    listProducts: async (requestFilters) => {
      filters = requestFilters;
      return [{
        id: 25001,
        category: 'cpu',
        brand: 'AMD',
        name: 'AMD Ryzen 7 9800X3D',
        price: 17990,
        socket: 'AM5',
        currency: 'THB'
      }];
    }
  });
  const response = createMockResponse();
  const handled = await route({ method: 'GET', url: '/api/products?category=cpu&brand=AMD&series=Ryzen%207&socket=AM5&search=ryzen&limit=12&offset=24' }, response);

  assert.equal(handled, true);
  assert.deepEqual(filters, {
    category: 'cpu',
    brand: 'AMD',
    series: 'Ryzen 7',
    socket: 'AM5',
    search: 'ryzen',
    limit: '12',
    offset: '24'
  });
  assert.deepEqual(JSON.parse(response.body).products[0].brand, 'AMD');
});

test('GET /api/products with a "selected" param filters the category pool by compatibility and paginates the filtered list', async () => {
  let poolFilters;
  let compatibleArgs;
  const allBoards = [
    { id: 1, category: 'motherboard', name: 'AM5 Board', price: 5000, socket: 'AM5' },
    { id: 2, category: 'motherboard', name: 'AM4 Board', price: 3000, socket: 'AM4' }
  ];
  const route = createProductRoutes({
    listProducts: async (requestFilters) => {
      poolFilters = requestFilters;
      return { products: allBoards, total: allBoards.length, limit: 1000, offset: 0 };
    },
    filterCompatibleProducts: (category, products, selected) => {
      compatibleArgs = { category, products, selected };
      return products.filter((product) => product.socket === 'AM5');
    }
  });
  const selectedParam = encodeURIComponent(JSON.stringify({ cpu: { category: 'cpu', name: 'AMD Ryzen 7 7800X3D' } }));
  const response = createMockResponse();
  const handled = await route({
    method: 'GET',
    url: `/api/products?category=motherboard&limit=24&offset=0&selected=${selectedParam}`
  }, response);

  assert.equal(handled, true);
  assert.equal(poolFilters.limit, '1000', 'the pool fetch should pull the whole category, not just one page');
  assert.equal(compatibleArgs.category, 'motherboard');
  assert.deepEqual(compatibleArgs.selected, { cpu: { category: 'cpu', name: 'AMD Ryzen 7 7800X3D' } });

  const body = JSON.parse(response.body);
  assert.equal(body.total, 1, 'total should reflect the filtered count, not the unfiltered pool');
  assert.deepEqual(body.products.map((product) => product.id), [1]);
});

test('GET /api/products ignores a malformed "selected" param instead of erroring', async () => {
  const route = createProductRoutes({
    listProducts: async () => ({ products: [{ id: 1, category: 'cpu' }], total: 1, limit: 24, offset: 0 }),
    filterCompatibleProducts: () => {
      throw new Error('should not be called for a malformed selected param');
    }
  });
  const response = createMockResponse();
  const handled = await route({ method: 'GET', url: '/api/products?category=cpu&selected=not-json' }, response);

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body).products, [{ id: 1, category: 'cpu' }]);
});

test('GET /api/products ignores a "selected" param when no category is given', async () => {
  let compatibleCalled = false;
  const route = createProductRoutes({
    listProducts: async () => ({ products: [], total: 0, limit: 24, offset: 0 }),
    filterCompatibleProducts: () => {
      compatibleCalled = true;
      return [];
    }
  });
  const response = createMockResponse();
  const selectedParam = encodeURIComponent(JSON.stringify({ cpu: { category: 'cpu' } }));
  const handled = await route({ method: 'GET', url: `/api/products?selected=${selectedParam}` }, response);

  assert.equal(handled, true);
  assert.equal(compatibleCalled, false, 'compatibility filtering only applies when browsing a single category');
});

test('GET /api/product-filters returns filter values for category', async () => {
  let filters;
  const route = createProductRoutes({
    listProductFilters: async (requestFilters) => {
      filters = requestFilters;
      return {
        brands: ['AMD', 'Intel'],
        series: ['Ryzen 7', 'Core i5'],
        sockets: ['AM5', 'LGA1700']
      };
    }
  });
  const response = createMockResponse();
  const handled = await route({ method: 'GET', url: '/api/product-filters?category=cpu' }, response);

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(filters, { category: 'cpu', brand: '' });
  assert.deepEqual(JSON.parse(response.body).filters.sockets, ['AM5', 'LGA1700']);
});

test('GET /api/product-filters passes the brand filter through so series/sockets can be scoped to it', async () => {
  let filters;
  const route = createProductRoutes({
    listProductFilters: async (requestFilters) => {
      filters = requestFilters;
      return { brands: ['AMD', 'Intel'], series: ['Ryzen 7'], sockets: ['AM5'] };
    }
  });
  const response = createMockResponse();
  const handled = await route({ method: 'GET', url: '/api/product-filters?category=cpu&brand=AMD' }, response);

  assert.equal(handled, true);
  assert.deepEqual(filters, { category: 'cpu', brand: 'AMD' });
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

test('normalizeAvailability is a whitelist: only th / not-th / unknown pass, anything else means "no filter"', () => {
  assert.equal(normalizeAvailability('th'), 'th');
  assert.equal(normalizeAvailability(' not-th '), 'not-th');
  assert.equal(normalizeAvailability('unknown'), 'unknown');
  assert.equal(normalizeAvailability(''), '');
  assert.equal(normalizeAvailability(undefined), '');
  assert.equal(normalizeAvailability("th' OR 1=1 --"), '');
  assert.equal(normalizeAvailability('TH'), '');
});

test('buildWhereClause turns the availability filter into a thailand_check status condition', () => {
  const th = buildWhereClause({ category: 'monitor', availability: 'th' });
  assert.match(th, /category = 'monitor'/);
  assert.match(th, /\$\.thailand_check\.status.*IN \('found', 'found_active'\)/s);

  const notTh = buildWhereClause({ category: 'monitor', availability: 'not-th' });
  assert.match(notTh, /IN \('not_found', 'found_inactive'\)/);

  // "unknown" รวมสินค้าที่ยังไม่เคยตรวจ (status เป็น NULL) และสถานะที่ไม่ตัดสิน (ambiguous)
  const unknown = buildWhereClause({ category: 'monitor', availability: 'unknown' });
  assert.match(unknown, /NOT \(.*IN \('found', 'found_active'\).*\) AND NOT \(.*IN \('not_found', 'found_inactive'\)/s);
  // สถานะ NULL (ยังไม่เคยตรวจ) ต้องถูกแปลงเป็นค่าว่างก่อนเทียบ ไม่งั้น NOT (NULL IN ...) จะทำให้แถวเหล่านั้นหายไป
  assert.match(unknown, /COALESCE\(JSON_UNQUOTE\(JSON_EXTRACT\(specs, '\$\.thailand_check\.status'\)\), ''\)/);

  // ไม่ระบุ หรือค่าแปลก = ไม่มีเงื่อนไขนี้ (และไม่มี SQL ที่ผู้ใช้พิมพ์เองหลุดเข้าไป)
  assert.doesNotMatch(buildWhereClause({ category: 'monitor' }), /thailand_check/);
  assert.doesNotMatch(buildWhereClause({ category: 'monitor', availability: "x' OR 1=1 --" }), /thailand_check|OR 1=1/);
});

test('GET /api/products forwards a valid availability filter and drops an invalid one', async () => {
  const seen = [];
  const route = createProductRoutes({
    listProducts: async (requestFilters) => {
      seen.push(requestFilters);
      return { products: [], total: 0, limit: 24, offset: 0 };
    }
  });

  await route({ method: 'GET', url: '/api/products?category=monitor&availability=not-th' }, createMockResponse());
  await route({ method: 'GET', url: "/api/products?category=monitor&availability=th'%20OR%201%3D1" }, createMockResponse());
  await route({ method: 'GET', url: '/api/products?category=monitor' }, createMockResponse());

  assert.equal(seen[0].availability, 'not-th');
  assert.equal('availability' in seen[1], false);
  assert.equal('availability' in seen[2], false);
});

test('availability filter counts a shop listed in thailand_check.also_sold_at (e.g. JIB) as sold in Thailand', () => {
  const th = buildWhereClause({ category: 'monitor', availability: 'th' });
  // พบที่ Banana หรือมีร้านอื่นใน also_sold_at ก็นับ
  assert.match(th, /IN \('found', 'found_active'\) OR COALESCE\(JSON_LENGTH\(JSON_EXTRACT\(specs, '\$\.thailand_check\.also_sold_at'\)\), 0\) > 0/);

  // "ไม่พบใน Banana" ต้องไม่รวมสินค้าที่พบที่ร้านอื่น
  const notTh = buildWhereClause({ category: 'monitor', availability: 'not-th' });
  assert.match(notTh, /IN \('not_found', 'found_inactive'\) AND NOT COALESCE\(JSON_LENGTH/);

  // unknown = ไม่ใช่ทั้ง "มีขาย" และ "ไม่พบ"
  const unknown = buildWhereClause({ category: 'monitor', availability: 'unknown' });
  assert.match(unknown, /NOT \(.*also_sold_at.*\) AND NOT \(/s);
});

test('GET /api/products forwards valid monitor spec filters and drops invalid ones', async () => {
  const seen = [];
  const route = createProductRoutes({
    listProducts: async (requestFilters) => {
      seen.push(requestFilters);
      return { products: [], total: 0, limit: 24, offset: 0 };
    }
  });

  await route({ method: 'GET', url: '/api/products?category=monitor&minRefreshRate=144&screenSize=m&resolution=qhd&panelType=IPS' }, createMockResponse());
  await route({ method: 'GET', url: "/api/products?category=monitor&minRefreshRate=999&screenSize=zz&panelType=x'%20OR%201%3D1" }, createMockResponse());

  assert.equal(seen[0].minRefreshRate, 144);
  assert.equal(seen[0].screenSize, 'm');
  assert.equal(seen[0].resolution, 'qhd');
  assert.equal(seen[0].panelType, 'IPS');
  for (const key of ['minRefreshRate', 'screenSize', 'resolution', 'panelType']) assert.equal(key in seen[1], false, key);
});

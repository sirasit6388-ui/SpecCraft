import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createProductRoutes } from '../routes/products.routes.js';
import { buildFilterWhere, escapeSqlString, normalizeLimit, normalizeOffset, toThaiBahtExpression } from '../services/products.service.js';

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

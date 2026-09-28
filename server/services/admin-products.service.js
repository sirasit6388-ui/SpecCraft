import { getDatabaseConfig } from '../config/database.js';
import { runMysqlCommand, runMysqlScalar } from './database.service.js';
import { escapeSqlString, normalizeLimit, normalizeOffset, toThaiBahtExpression } from './products.service.js';

export async function listAdminProducts(filters = {}, config = getDatabaseConfig()) {
  const limit = Math.min(normalizeLimit(filters.limit || 50), 100);
  const offset = normalizeOffset(filters.offset);
  const where = buildProductsWhere(filters.search, filters.category);
  const priceThb = toThaiBahtExpression('price', 'price_currency', 'source', config.usdToThbRate);
  const result = await runMysqlScalar(config, `
    SELECT JSON_OBJECT(
      'products', COALESCE((
        SELECT JSON_ARRAYAGG(JSON_OBJECT(
          'id', id,
          'category', category,
          'brand', brand,
          'name', name,
          'priceThb', price_thb,
          'imageUrl', image_url,
          'updatedAt', updated_at,
          'isHidden', COALESCE(is_hidden, 0) = 1
        ))
        FROM (
          SELECT id, category, brand, name, ${priceThb} AS price_thb, image_url, updated_at, is_hidden
          FROM products
          ${where}
          ORDER BY updated_at DESC, id DESC
          LIMIT ${limit} OFFSET ${offset}
        ) AS product_page
      ), JSON_ARRAY()),
      'total', (SELECT COUNT(*) FROM products ${where}),
      'limit', ${limit},
      'offset', ${offset}
    );
  `);

  return JSON.parse(result || '{"products":[],"total":0,"limit":50,"offset":0}');
}

export async function getAdminProduct(productId, config = getDatabaseConfig()) {
  const id = normalizeProductId(productId);

  if (!id) {
    return null;
  }

  const result = await runMysqlScalar(config, `
    SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT(
      'id', id,
      'category', category,
      'brand', brand,
      'name', name,
      'priceThb', ${toThaiBahtExpression('price', 'price_currency', 'source', config.usdToThbRate)},
      'imageUrl', image_url,
      'productUrl', product_url,
      'specs', specs,
      'updatedAt', updated_at,
      'isHidden', COALESCE(is_hidden, 0) = 1
    )), JSON_ARRAY())
    FROM products
    WHERE id = ${id}
    LIMIT 1;
  `);
  const products = JSON.parse(result || '[]');

  return products[0] || null;
}

export async function createAdminProduct(payload = {}, config = getDatabaseConfig()) {
  const product = normalizeProductPayload(payload);
  const result = await runMysqlScalar(config, `
    INSERT INTO products (
      category, brand, name, price, price_currency, price_source,
      image_url, product_url, specs, source, last_synced_at
    ) VALUES (
      '${escapeSqlString(product.category)}',
      ${toSqlString(product.brand)},
      '${escapeSqlString(product.name)}',
      ${product.priceThb},
      'THB',
      'manual',
      ${toSqlString(product.imageUrl)},
      ${toSqlString(product.productUrl)},
      CAST('${escapeSqlString(product.specsJson)}' AS JSON),
      'admin',
      NOW()
    );
    SELECT LAST_INSERT_ID();
  `);

  return getAdminProduct(Number(result), config);
}

export async function updateAdminProduct(productId, payload = {}, config = getDatabaseConfig()) {
  const id = normalizeProductId(productId);

  if (!id) {
    throw new Error('Invalid product id');
  }

  const previousProduct = await getAdminProduct(id, config);

  if (!previousProduct) {
    throw new Error('Product not found');
  }

  const product = normalizeProductPayload(payload);
  await runMysqlCommand(config, `
    UPDATE products
    SET
      category = '${escapeSqlString(product.category)}',
      brand = ${toSqlString(product.brand)},
      name = '${escapeSqlString(product.name)}',
      price = ${product.priceThb},
      price_currency = 'THB',
      price_source = 'manual',
      image_url = ${toSqlString(product.imageUrl)},
      product_url = ${toSqlString(product.productUrl)},
      specs = CAST('${escapeSqlString(product.specsJson)}' AS JSON),
      source = 'admin',
      last_synced_at = NOW()
    WHERE id = ${id};
  `);

  const productResult = await getAdminProduct(id, config);

  return { ...productResult, previousImageUrl: previousProduct.imageUrl || '' };
}

export async function deleteAdminProduct(productId, config = getDatabaseConfig()) {
  const id = normalizeProductId(productId);

  if (!id) {
    throw new Error('Invalid product id');
  }

  const product = await getAdminProduct(id, config);

  if (!product) {
    throw new Error('Product not found');
  }

  await runMysqlCommand(config, `DELETE FROM products WHERE id = ${id};`);
  return { id, imageUrl: product.imageUrl || '' };
}

function normalizeProductPayload(payload) {
  const category = String(payload.category || '').trim().toLowerCase();
  const name = String(payload.name || '').trim();
  const priceThb = Number(payload.priceThb);

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(category) || !name || name.length > 255 || !Number.isFinite(priceThb) || priceThb < 0) {
    throw new Error('Category, product name, and Thai baht price are required');
  }

  return {
    category,
    name,
    priceThb: Math.round(priceThb),
    brand: normalizeText(payload.brand, 120, 'Brand'),
    imageUrl: normalizeOptionalHttpUrl(payload.imageUrl, 'Image URL'),
    productUrl: normalizeOptionalHttpUrl(payload.productUrl, 'Product URL'),
    specsJson: normalizeSpecs(payload.specs)
  };
}

function normalizeSpecs(value) {
  if (!value) {
    return '{}';
  }

  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      throw new Error('Specifications must be a JSON object');
    }

    return JSON.stringify(value);
  }

  try {
    const parsed = JSON.parse(String(value));

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Specifications must be a JSON object');
    }

    return JSON.stringify(parsed);
  } catch (error) {
    if (error.message === 'Specifications must be a JSON object') {
      throw error;
    }

    throw new Error('Specifications must be valid JSON');
  }
}

function normalizeText(value, maxLength, label) {
  const text = String(value || '').trim();

  if (text.length > maxLength) {
    throw new Error(`${label} is too long`);
  }

  return text;
}

function normalizeOptionalHttpUrl(value, label) {
  const text = String(value || '').trim();

  if (!text) {
    return '';
  }

  if (label === 'Image URL' && /^\/uploads\/[a-f0-9-]+\.(?:jpe?g|png|webp)$/i.test(text)) {
    return text;
  }

  try {
    const url = new URL(text);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }

    return url.href;
  } catch {
    throw new Error(`${label} must be a valid http or https URL`);
  }
}

function normalizeProductId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

function buildProductsWhere(search, category) {
  const clauses = [];
  const searchValue = String(search || '').trim();
  const categoryValue = String(category || '').trim().toLowerCase();

  if (searchValue) {
    const pattern = `%${escapeSqlString(searchValue)}%`;
    clauses.push(`(name LIKE '${pattern}' OR brand LIKE '${pattern}' OR category LIKE '${pattern}')`);
  }

  if (categoryValue) {
    clauses.push(`category = '${escapeSqlString(categoryValue)}'`);
  }

  return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
}

function toSqlString(value) {
  return value ? `'${escapeSqlString(value)}'` : 'NULL';
}

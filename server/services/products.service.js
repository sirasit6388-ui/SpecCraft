import { getDatabaseConfig } from '../config/database.js';
import { runMysqlScalar } from './database.service.js';

// สินค้าที่แอดมิน "ซ่อน" ไว้ (is_hidden = 1) หลังจากรีวิว removal-review-report.xlsx แล้ว
// ต้องไม่โผล่ในหน้าร้าน/ตัวจัดสเปคอัตโนมัติ/ตัวกรองต่างๆ เลย — แต่ข้อมูลยังอยู่ในฐานข้อมูลครบ
// (ยังดู/สลับกลับได้ผ่านหน้าแอดมินหรือฐานข้อมูลโดยตรง ไม่มีการลบแถวจริง)
// คอลัมน์นี้อาจยังไม่มีในบางฐานข้อมูล (ยังไม่เคยรัน apply-removal-decisions.js) จึงต้องกันด้วย
// IS NULL ไว้ด้วยเสมอ ไม่ใช่แค่ = 0
export const NOT_HIDDEN_CLAUSE = '(is_hidden IS NULL OR is_hidden = 0)';

export async function listCategories(config = getDatabaseConfig()) {
  const result = await runMysqlScalar(config, `
    SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('category', category, 'count', item_count)), JSON_ARRAY())
    FROM (
      SELECT category, COUNT(*) AS item_count
      FROM products
      WHERE ${NOT_HIDDEN_CLAUSE}
      GROUP BY category
      ORDER BY category
    ) AS category_summary;
  `);

  return JSON.parse(result || '[]');
}

export async function listProductFilters(filters = {}, config = getDatabaseConfig()) {
  const brandWhere = buildFilterWhere(filters, `brand IS NOT NULL AND brand <> '' AND ${NOT_HIDDEN_CLAUSE}`);
  const socketWhere = buildFilterWhere(filters, NOT_HIDDEN_CLAUSE, { includeBrand: true });
  const seriesWhere = buildFilterWhere(filters, NOT_HIDDEN_CLAUSE, { includeBrand: true });
  const seriesExpression = getSeriesExpression('name');
  const socketExpression = getSocketExpression();
  const result = await runMysqlScalar(config, `
    SELECT JSON_OBJECT(
      'brands', COALESCE((
        SELECT JSON_ARRAYAGG(brand)
        FROM (
          SELECT DISTINCT brand
          FROM products
          ${brandWhere}
          ORDER BY brand
        ) AS brand_values
      ), JSON_ARRAY()),
      'sockets', COALESCE((
        SELECT JSON_ARRAYAGG(socket)
        FROM (
          SELECT DISTINCT ${socketExpression} AS socket
          FROM products
          ${socketWhere}
          HAVING socket IS NOT NULL AND socket <> ''
          ORDER BY socket
        ) AS socket_values
      ), JSON_ARRAY()),
      'series', COALESCE((
        SELECT JSON_ARRAYAGG(series)
        FROM (
          SELECT DISTINCT ${seriesExpression} AS series
          FROM products
          ${seriesWhere}
          HAVING series IS NOT NULL AND series <> ''
          ORDER BY series
        ) AS series_values
      ), JSON_ARRAY())
    );
  `);
 
  return JSON.parse(result || '{"brands":[],"sockets":[],"series":[]}');
}
 
export async function listProducts(filters = {}, config = getDatabaseConfig()) {
  const where = buildWhereClause(filters);
  const limit = normalizeLimit(filters.limit);
  const offset = normalizeOffset(filters.offset);
  const priceThb = toThaiBahtExpression('price', 'price_currency', 'source', config.usdToThbRate);
  const socketExpression = getSocketExpression();
  const result = await runMysqlScalar(config, `
    SELECT JSON_OBJECT(
      'products', COALESCE((
        SELECT JSON_ARRAYAGG(JSON_OBJECT(
          'id', id,
          'category', category,
          'brand', brand,
          'name', name,
          'price', price_thb,
          'socket', socket,
          'formFactor', form_factor,
          'caseType', case_type,
          'memoryType', memory_type,
          'memoryGb', memory_gb,
          'tdp', tdp,
          'wattage', wattage,
          'gpuLength', gpu_length,
          'externalVolume', external_volume,
          'maxGpuLength', max_gpu_length,
          'coolerHeight', cooler_height,
          'radiatorSize', radiator_size,
          'maxCpuCoolerHeight', max_cpu_cooler_height,
          'currency', 'THB',
          'imageUrl', image_url,
          'productUrl', product_url
        ))
        FROM (
          SELECT
            id,
            category,
            brand,
            name,
            ${priceThb} AS price_thb,
            ${socketExpression} AS socket,
            JSON_UNQUOTE(JSON_EXTRACT(specs, '$.form_factor')) AS form_factor,
            JSON_UNQUOTE(JSON_EXTRACT(specs, '$.type')) AS case_type,
            CASE
              WHEN category = 'memory' AND JSON_EXTRACT(specs, '$.speed[0]') = 5 THEN 'DDR5'
              WHEN category = 'memory' AND JSON_EXTRACT(specs, '$.speed[0]') = 4 THEN 'DDR4'
              ELSE NULL
            END AS memory_type,
            CASE
              WHEN category = 'memory' THEN JSON_EXTRACT(specs, '$.modules[0]') * JSON_EXTRACT(specs, '$.modules[1]')
              ELSE NULL
            END AS memory_gb,
            JSON_EXTRACT(specs, '$.tdp') AS tdp,
            JSON_EXTRACT(specs, '$.wattage') AS wattage,
            JSON_EXTRACT(specs, '$.length') AS gpu_length,
            JSON_EXTRACT(specs, '$.external_volume') AS external_volume,
            JSON_EXTRACT(specs, '$.max_video_card_length') AS max_gpu_length,
            JSON_EXTRACT(specs, '$.height') AS cooler_height,
            JSON_EXTRACT(specs, '$.size') AS radiator_size,
            JSON_EXTRACT(specs, '$.max_cpu_cooler_height') AS max_cpu_cooler_height,
            image_url,
            product_url,
            source
          FROM products
          ${where}
          ORDER BY price_thb IS NULL, price_thb, name
          LIMIT ${limit} OFFSET ${offset}
        ) AS product_page
      ), JSON_ARRAY()),
      'total', (
        SELECT COUNT(*)
        FROM products
        ${where}
      ),
      'limit', ${limit},
      'offset', ${offset}
    );
  `);
 
  return JSON.parse(result || '{"products":[],"total":0,"limit":24,"offset":0}');
}
 
export function normalizeLimit(value) {
  const limit = Number(value || 24);
 
  if (!Number.isInteger(limit) || limit < 1) {
    return 24;
  }
 
  return Math.min(limit, 1000);
}
 
export function normalizeOffset(value) {
  const offset = Number(value || 0);
 
  if (!Number.isInteger(offset) || offset < 0) {
    return 0;
  }
 
  return Math.min(offset, 100000);
}
 
export function escapeSqlString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
 
export function toThaiBahtExpression(columnName, currencyColumn = 'price_currency', sourceColumn = 'source', usdToThbRate = 36.5) {
  const rate = Number(usdToThbRate);
  const safeRate = Number.isFinite(rate) && rate > 0 ? rate : 36.5;
 
  return `CASE
    WHEN ${sourceColumn} = 'pcpartpicker-docyx' THEN ROUND(${columnName} * ${safeRate}, 0)
    WHEN UPPER(COALESCE(${currencyColumn}, 'THB')) = 'THB' THEN ROUND(${columnName}, 0)
    WHEN UPPER(${currencyColumn}) = 'USD' THEN ROUND(${columnName} * ${safeRate}, 0)
    ELSE NULL
  END`;
}
 
function buildWhereClause(filters) {
  // สินค้าที่ยังไม่มีราคา (price IS NULL) จะไม่โผล่ในหน้าร้าน/ระบบจัดสเปกอัตโนมัติ
  // เพราะไม่สามารถคำนวณงบหรือแสดงราคาให้ผู้ใช้ได้ แต่ข้อมูลยังเก็บไว้ในฐานข้อมูลตามเดิม
  // (ยังดูและแก้ไขได้ผ่านหน้าแอดมิน เผื่อเติมราคาย้อนหลังในอนาคต)
  // เช่นเดียวกับสินค้าที่ถูก "ซ่อน" ไว้ (is_hidden = 1) จากการรีวิว removal-review-report.xlsx
  const clauses = ['price IS NOT NULL', NOT_HIDDEN_CLAUSE];
 
  if (filters.category) {
    clauses.push(`category = '${escapeSqlString(filters.category)}'`);
  }
 
  if (filters.brand) {
    clauses.push(`brand = '${escapeSqlString(filters.brand)}'`);
  }
 
  if (filters.socket) {
    clauses.push(`${getSocketExpression()} = '${escapeSqlString(filters.socket)}'`);
  }
 
  if (filters.series) {
    clauses.push(`name LIKE '%${escapeSqlString(filters.series)}%'`);
  }
 
  if (filters.search) {
    const search = `%${escapeSqlString(filters.search)}%`;
    clauses.push(`(name LIKE '${search}' OR brand LIKE '${search}')`);
  }
 
  return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
}
 
export function buildFilterWhere(filters, extraCondition = '', options = {}) {
  const clauses = [];
 
  if (filters.category) {
    clauses.push(`category = '${escapeSqlString(filters.category)}'`);
  }
 
  if (options.includeBrand && filters.brand) {
    clauses.push(`brand = '${escapeSqlString(filters.brand)}'`);
  }
 
  if (extraCondition) {
    clauses.push(extraCondition);
  }
 
  return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
}
 
function getSeriesExpression(columnName) {
  return `CASE
    WHEN ${columnName} REGEXP 'Ryzen [3579]' THEN REGEXP_SUBSTR(${columnName}, 'Ryzen [3579]')
    WHEN ${columnName} REGEXP 'Core i[3579]' THEN REGEXP_SUBSTR(${columnName}, 'Core i[3579]')
    WHEN ${columnName} REGEXP 'Core Ultra [3579]' THEN REGEXP_SUBSTR(${columnName}, 'Core Ultra [3579]')
    WHEN ${columnName} REGEXP 'RTX [0-9]{4}' THEN REGEXP_SUBSTR(${columnName}, 'RTX [0-9]{4}')
    WHEN ${columnName} REGEXP 'GTX [0-9]{3,4}' THEN REGEXP_SUBSTR(${columnName}, 'GTX [0-9]{3,4}')
    WHEN ${columnName} REGEXP 'RX [0-9]{4}' THEN REGEXP_SUBSTR(${columnName}, 'RX [0-9]{4}')
    ELSE NULL
  END`;
}
 
function getSocketExpression() {
  return `COALESCE(
    NULLIF(JSON_UNQUOTE(JSON_EXTRACT(specs, '$.socket')), ''),
    CASE
      WHEN name REGEXP 'Ryzen [3579] [789][0-9]{3}' THEN 'AM5'
      WHEN name REGEXP 'Ryzen [3579] [1-5][0-9]{3}' THEN 'AM4'
      WHEN name REGEXP 'i[3579]-1[234][0-9]{3}' THEN 'LGA1700'
      WHEN name REGEXP 'i[3579]-10[0-9]{3}' OR name REGEXP 'i[3579]-11[0-9]{3}' THEN 'LGA1200'
      ELSE NULL
    END
  )`;
}
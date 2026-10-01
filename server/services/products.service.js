import { getDatabaseConfig } from '../config/database.js';
import { buildMonitorFilterOptions, HEIGHT_EXPRESSION, HZ_EXPRESSION, monitorFilterClauses, PANEL_EXPRESSION, SIZE_EXPRESSION } from './monitor-filters.js';
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
 
  const parsed = JSON.parse(result || '{"brands":[],"sockets":[],"series":[]}');

  // หมวดจอ: ตัวเลือกของตัวกรองสเปค (นับจากจอที่แสดงอยู่ในร้านทั้งหมวด ไม่ขึ้นกับแบรนด์ที่เลือก)
  if (filters.category === 'monitor') {
    const rows = JSON.parse(await runMysqlScalar(config, `
      SELECT COALESCE(JSON_ARRAYAGG(JSON_ARRAY(${HZ_EXPRESSION}, ${SIZE_EXPRESSION}, ${HEIGHT_EXPRESSION}, ${PANEL_EXPRESSION})), JSON_ARRAY())
      FROM products
      WHERE category = 'monitor' AND price IS NOT NULL AND ${NOT_HIDDEN_CLAUSE};`) || '[]');
    parsed.monitor = buildMonitorFilterOptions(rows);
  }

  return parsed;
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
          'coreCount', core_count,
          'coreClockGhz', core_clock_ghz,
          'boostClockGhz', boost_clock_ghz,
          'microarchitecture', microarchitecture,
          'graphics', graphics,
          'threads', threads,
          'l1Cache', l1_cache,
          'l2Cache', l2_cache,
          'l3Cache', l3_cache,
          'cacheText', cache_text,
          'thermalSolution', thermal_solution,
          'color', color,
          'chipset', gpu_chipset,
          'vramGb', gpu_vram_gb,
          'gpuCoreClockMhz', gpu_core_clock_mhz,
          'gpuBoostClockMhz', gpu_boost_clock_mhz,
          'maxMemoryGb', max_memory_gb,
          'memorySlots', memory_slots,
          'memorySpeedMhz', memory_speed_mhz,
          'memoryModuleCount', memory_module_count,
          'memoryModuleGb', memory_module_gb,
          'casLatency', cas_latency,
          'firstWordLatencyNs', first_word_latency_ns,
          'efficiency', psu_efficiency,
          'modular', psu_modular,
          'sidePanel', side_panel,
          'internal35Bays', internal_35_bays,
          'includedPsuWatt', included_psu_watt,
          'rpm', cooler_rpm,
          'noiseLevelDb', cooler_noise_db,
          'storageCapacityGb', storage_capacity_gb,
          'storageInterface', storage_interface,
          'storageCacheMb', storage_cache_mb,
          'cpuSeries', cpu_series,
          'cpuProcess', cpu_process,
          'cpu64bit', cpu_64bit_support,
          'cpuVirtualization', cpu_virtualization_support,
          'screenSizeInch', monitor_screen_size,
          'resolution', monitor_resolution,
          'refreshRate', monitor_refresh_rate,
          'responseTimeMs', monitor_response_time,
          'panelType', monitor_panel_type,
          'aspectRatio', monitor_aspect_ratio,
          'thailandStatus', thailand_status,
          'thailandBanana', thailand_banana,
          'thailandAlsoAt', thailand_also_at,
          'listPrice', CASE
            WHEN check_srp_price IS NOT NULL AND check_selling_price IS NOT NULL
              AND check_srp_price > check_selling_price
              AND ABS(price_thb - check_selling_price) < 0.5
            THEN check_srp_price
            ELSE NULL
          END,
          'bananaSpecs', banana_specs,
          'bananaSpecsUrl', banana_specs_url,
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
            JSON_EXTRACT(specs, '$.core_count') AS core_count,
            JSON_EXTRACT(specs, '$.core_clock_ghz') AS core_clock_ghz,
            JSON_EXTRACT(specs, '$.boost_clock_ghz') AS boost_clock_ghz,
            JSON_UNQUOTE(JSON_EXTRACT(specs, '$.microarchitecture')) AS microarchitecture,
            JSON_UNQUOTE(JSON_EXTRACT(specs, '$.graphics')) AS graphics,
            JSON_EXTRACT(specs, '$.threads') AS threads,
            JSON_UNQUOTE(JSON_EXTRACT(specs, '$.l1_cache')) AS l1_cache,
            JSON_UNQUOTE(JSON_EXTRACT(specs, '$.l2_cache')) AS l2_cache,
            JSON_UNQUOTE(JSON_EXTRACT(specs, '$.l3_cache')) AS l3_cache,
            JSON_UNQUOTE(JSON_EXTRACT(specs, '$.cache_text')) AS cache_text,
            JSON_UNQUOTE(JSON_EXTRACT(specs, '$.thermal_solution')) AS thermal_solution,
            ${specText('color')} AS color,
            CASE WHEN category = 'video-card' THEN ${specText('chipset')} ELSE NULL END AS gpu_chipset,
            CASE WHEN category = 'video-card' THEN JSON_EXTRACT(specs, '$.memory') ELSE NULL END AS gpu_vram_gb,
            CASE WHEN category = 'video-card' THEN JSON_EXTRACT(specs, '$.core_clock') ELSE NULL END AS gpu_core_clock_mhz,
            CASE WHEN category = 'video-card' THEN JSON_EXTRACT(specs, '$.boost_clock') ELSE NULL END AS gpu_boost_clock_mhz,
            CASE WHEN category = 'motherboard' THEN JSON_EXTRACT(specs, '$.max_memory') ELSE NULL END AS max_memory_gb,
            CASE WHEN category = 'motherboard' THEN JSON_EXTRACT(specs, '$.memory_slots') ELSE NULL END AS memory_slots,
            CASE WHEN category = 'memory' THEN JSON_EXTRACT(specs, '$.speed[1]') ELSE NULL END AS memory_speed_mhz,
            CASE WHEN category = 'memory' THEN JSON_EXTRACT(specs, '$.modules[0]') ELSE NULL END AS memory_module_count,
            CASE WHEN category = 'memory' THEN JSON_EXTRACT(specs, '$.modules[1]') ELSE NULL END AS memory_module_gb,
            CASE WHEN category = 'memory' THEN JSON_EXTRACT(specs, '$.cas_latency') ELSE NULL END AS cas_latency,
            CASE WHEN category = 'memory' THEN JSON_EXTRACT(specs, '$.first_word_latency') ELSE NULL END AS first_word_latency_ns,
            CASE WHEN category = 'power-supply' THEN ${specText('efficiency')} ELSE NULL END AS psu_efficiency,
            CASE WHEN category = 'power-supply' THEN JSON_EXTRACT(specs, '$.modular') ELSE NULL END AS psu_modular,
            CASE WHEN category = 'case' THEN ${specText('side_panel')} ELSE NULL END AS side_panel,
            CASE WHEN category = 'case' THEN JSON_EXTRACT(specs, '$.internal_35_bays') ELSE NULL END AS internal_35_bays,
            CASE WHEN category = 'case' THEN JSON_EXTRACT(specs, '$.psu') ELSE NULL END AS included_psu_watt,
            CASE WHEN category = 'cpu-cooler' THEN JSON_EXTRACT(specs, '$.rpm') ELSE NULL END AS cooler_rpm,
            CASE WHEN category = 'cpu-cooler' THEN JSON_EXTRACT(specs, '$.noise_level') ELSE NULL END AS cooler_noise_db,
            CASE WHEN category = 'internal-hard-drive' THEN JSON_EXTRACT(specs, '$.capacity') ELSE NULL END AS storage_capacity_gb,
            CASE WHEN category = 'internal-hard-drive' THEN ${specText('interface')} ELSE NULL END AS storage_interface,
            CASE WHEN category = 'internal-hard-drive' THEN JSON_EXTRACT(specs, '$.cache') ELSE NULL END AS storage_cache_mb,
            CASE WHEN category = 'cpu' THEN ${specText('cpu_series')} ELSE NULL END AS cpu_series,
            CASE WHEN category = 'cpu' THEN ${specText('cpu_process')} ELSE NULL END AS cpu_process,
            CASE WHEN category = 'cpu' THEN ${specText('cpu_64bit_support')} ELSE NULL END AS cpu_64bit_support,
            CASE WHEN category = 'cpu' THEN ${specText('cpu_virtualization_support')} ELSE NULL END AS cpu_virtualization_support,
            CASE WHEN category = 'monitor' THEN JSON_EXTRACT(specs, '$.screen_size') ELSE NULL END AS monitor_screen_size,
            CASE WHEN category = 'monitor' THEN JSON_EXTRACT(specs, '$.resolution') ELSE NULL END AS monitor_resolution,
            CASE WHEN category = 'monitor' THEN JSON_EXTRACT(specs, '$.refresh_rate') ELSE NULL END AS monitor_refresh_rate,
            CASE WHEN category = 'monitor' THEN JSON_EXTRACT(specs, '$.response_time') ELSE NULL END AS monitor_response_time,
            CASE WHEN category = 'monitor' THEN ${specText('panel_type')} ELSE NULL END AS monitor_panel_type,
            CASE WHEN category = 'monitor' THEN ${specText('aspect_ratio')} ELSE NULL END AS monitor_aspect_ratio,
            CASE
              WHEN ${THAILAND_SOLD_SQL} THEN 'th'
              WHEN ${THAILAND_NOT_SOLD_SQL} THEN 'not-th'
              ELSE NULL
            END AS thailand_status,
            (${THAILAND_STATUS_SAFE} IN ${THAILAND_SOLD_STATUSES}) AS thailand_banana,
            JSON_EXTRACT(specs, '$.thailand_check.also_sold_at') AS thailand_also_at,
            CAST(JSON_EXTRACT(specs, '$.thailand_check.selling_price') AS DECIMAL(12,2)) AS check_selling_price,
            CAST(JSON_EXTRACT(specs, '$.thailand_check.srp_price') AS DECIMAL(12,2)) AS check_srp_price,
            JSON_EXTRACT(specs, '$.banana_specs') AS banana_specs,
            JSON_UNQUOTE(JSON_EXTRACT(specs, '$.banana_specs_url')) AS banana_specs_url,
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
 
// สถานะการมีขายในไทยจาก specs.thailand_check.status (เขียนโดย flag-thailand-availability.js / flag-monitor-thailand.js /
// update-from-banana-equip.js ซึ่งใช้คำต่างกันเล็กน้อย: found / found_active = มีขาย, not_found / found_inactive = ไม่มีขาย)
// ข้อความจาก specs: ถ้าค่าใน JSON เป็น null (เช่น ข้อมูลต้นทางมีคีย์แต่ไม่มีค่า) JSON_UNQUOTE(JSON_EXTRACT(..)) จะคืน
// "ข้อความ null" 4 ตัวอักษร ไม่ใช่ SQL NULL ทำให้หน้าเว็บโชว์คำว่า null (ทดสอบกับ MySQL 8 จริงแล้ว) จึงแปลงกลับเป็น NULL
function specText(key) {
  return `NULLIF(JSON_UNQUOTE(JSON_EXTRACT(specs, '$.${key}')), 'null')`;
}

const THAILAND_STATUS_EXPRESSION = "JSON_UNQUOTE(JSON_EXTRACT(specs, '$.thailand_check.status'))";
// สินค้าที่ยังไม่เคยตรวจไม่มี status (NULL) และใน SQL "NULL IN (...)" ให้ NULL ไม่ใช่ FALSE - พอเอาไป NOT ต่อ
// (ตัวกรอง "ยังไม่แน่ชัด") แถวเหล่านั้นจะหลุดหายไปเงียบๆ (ทดสอบกับ MySQL 8 จริงแล้วเจอบั๊กนี้) จึงแปลง NULL เป็นข้อความว่างก่อนเทียบ
const THAILAND_STATUS_SAFE = `COALESCE(${THAILAND_STATUS_EXPRESSION}, '')`;
const THAILAND_SOLD_STATUSES = "('found', 'found_active')";
const THAILAND_NOT_SOLD_STATUSES = "('not_found', 'found_inactive')";
const AVAILABILITY_VALUES = new Set(['th', 'not-th', 'unknown']);

// whitelist: ค่าอื่นทั้งหมดถือว่าไม่กรอง (ค่านี้ถูกใส่ใน SQL จึงห้ามรับค่าอิสระ)
export function normalizeAvailability(value) {
  const text = String(value ?? '').trim();
  return AVAILABILITY_VALUES.has(text) ? text : '';
}

// ร้านอื่นที่พบสินค้านี้ (เช่น JIB) - เขียนโดย check-monitor-jib.js เป็น [{ shop, url, checked_at }]
// พบที่ร้านใดร้านหนึ่งถือว่ามีขายในไทย แม้ Banana จะไม่พบ
const THAILAND_ALSO_SOLD_EXPRESSION = "COALESCE(JSON_LENGTH(JSON_EXTRACT(specs, '$.thailand_check.also_sold_at')), 0) > 0";
const THAILAND_SOLD_SQL = `(${THAILAND_STATUS_SAFE} IN ${THAILAND_SOLD_STATUSES} OR ${THAILAND_ALSO_SOLD_EXPRESSION})`;
const THAILAND_NOT_SOLD_SQL = `(${THAILAND_STATUS_SAFE} IN ${THAILAND_NOT_SOLD_STATUSES} AND NOT ${THAILAND_ALSO_SOLD_EXPRESSION})`;

function buildAvailabilityClause(availability) {
  switch (normalizeAvailability(availability)) {
    case 'th':
      return THAILAND_SOLD_SQL;
    case 'not-th':
      return THAILAND_NOT_SOLD_SQL;
    case 'unknown':
      // ที่เหลือทั้งหมด: ยังไม่ตรวจ (status เป็น NULL) หรือไม่ตัดสิน (ambiguous) และไม่ได้พบที่ร้านไหน
      return `(NOT ${THAILAND_SOLD_SQL} AND NOT ${THAILAND_NOT_SOLD_SQL})`;
    default:
      return '';
  }
}

export function buildWhereClause(filters) {
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
 
  const availabilityClause = buildAvailabilityClause(filters.availability);

  if (availabilityClause) {
    clauses.push(availabilityClause);
  }

  // ตัวกรองสเปคจอ (Hz / ขนาด / ความละเอียด / ชนิดแผง) ใช้เฉพาะหมวด monitor
  if (filters.category === 'monitor') {
    clauses.push(...monitorFilterClauses(filters));
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
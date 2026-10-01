// ตัวกรองสเปคของจอ (รีเฟรชเรต / ขนาด / ความละเอียด / ชนิดแผง) ใช้ทั้งฝั่ง API (สร้างเงื่อนไข SQL) และสร้างตัวเลือกให้หน้าเว็บ
// ค่าที่รับมาจากผู้ใช้ผ่านรายการที่อนุญาตเท่านั้น (ตัวเลขใน REFRESH_RATE_STEPS, รหัสในรายการกลุ่ม, ชนิดแผงที่เป็นตัวอักษร/ตัวเลข/ขีด)
// จึงไม่มีข้อความอิสระหลุดเข้า SQL
//
// ความหมาย:
//   minRefreshRate = N  -> จอที่รีเฟรชเรต "N Hz ขึ้นไป" (เช่น 144 = 144 Hz ขึ้นไป)
//   screenSize = รหัสกลุ่มขนาด (นิ้ว): ค่าในกลุ่มคือ min < ขนาด <= max
//   resolution = รหัสกลุ่มความละเอียด จัดตาม "ความสูง" ของภาพ (จึงรวมจอจอไวด์/อัลตราไวด์ที่ความสูงเท่ากันไว้ด้วยกัน เช่น 3440x1440 อยู่กลุ่ม 2K)
//   panelType = IPS / VA / TN / OLED / QD-OLED / Mini-LED ฯลฯ ตามที่มีในข้อมูล

export const REFRESH_RATE_STEPS = [60, 75, 100, 120, 144, 165, 180, 240, 360];

export const SIZE_BUCKETS = [
  { code: 'xs', label: 'ไม่เกิน 24"', min: 0, max: 24 },
  { code: 's', label: '24.1 – 27"', min: 24, max: 27 },
  { code: 'm', label: '27.1 – 32"', min: 27, max: 32 },
  { code: 'l', label: 'มากกว่า 32"', min: 32, max: Infinity }
];

export const RESOLUTION_BUCKETS = [
  { code: 'fhd', label: 'Full HD 1080p (หรือต่ำกว่า)', min: 0, max: 1200 },
  { code: 'qhd', label: '2K / QHD 1440p', min: 1200, max: 1600 },
  { code: 'uhd', label: '4K 2160p', min: 1600, max: 2400 },
  { code: '5k', label: '5K ขึ้นไป', min: 2400, max: Infinity }
];

const PANEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 -]{0,19}$/;

// คืนเฉพาะตัวกรองที่ถูกต้อง (ค่าแปลก/ว่างถูกทิ้ง) รับ URLSearchParams หรือ object ธรรมดา
export function normalizeMonitorFilters(input) {
  const get = (key) => (typeof input?.get === 'function' ? input.get(key) : input?.[key]) ?? '';
  const result = {};

  const hz = Number(get('minRefreshRate'));
  if (REFRESH_RATE_STEPS.includes(hz)) result.minRefreshRate = hz;

  const size = String(get('screenSize')).trim();
  if (SIZE_BUCKETS.some((bucket) => bucket.code === size)) result.screenSize = size;

  const resolution = String(get('resolution')).trim();
  if (RESOLUTION_BUCKETS.some((bucket) => bucket.code === resolution)) result.resolution = resolution;

  const panel = String(get('panelType')).trim();
  if (PANEL_PATTERN.test(panel)) result.panelType = panel;

  return result;
}

const SIZE_EXPRESSION = "CAST(JSON_EXTRACT(specs, '$.screen_size') AS DECIMAL(6,2))";
const HZ_EXPRESSION = "CAST(JSON_EXTRACT(specs, '$.refresh_rate') AS DECIMAL(8,2))";
const HEIGHT_EXPRESSION = "CAST(JSON_EXTRACT(specs, '$.resolution[1]') AS UNSIGNED)";
const PANEL_EXPRESSION = "NULLIF(JSON_UNQUOTE(JSON_EXTRACT(specs, '$.panel_type')), 'null')";

export { SIZE_EXPRESSION, HZ_EXPRESSION, HEIGHT_EXPRESSION, PANEL_EXPRESSION };

function rangeClause(expression, bucket) {
  return [`${expression} > ${bucket.min}`, ...(Number.isFinite(bucket.max) ? [`${expression} <= ${bucket.max}`] : [])].join(' AND ');
}

// รายการเงื่อนไข SQL (ค่า NULL = สเปคไม่ระบุ จะไม่ผ่านเงื่อนไขใดๆ ที่เลือก)
export function monitorFilterClauses(filters = {}) {
  const valid = normalizeMonitorFilters(filters);
  const clauses = [];

  if (valid.minRefreshRate) clauses.push(`${HZ_EXPRESSION} >= ${valid.minRefreshRate}`);
  if (valid.screenSize) clauses.push(`(${rangeClause(SIZE_EXPRESSION, SIZE_BUCKETS.find((bucket) => bucket.code === valid.screenSize))})`);
  if (valid.resolution) clauses.push(`(${rangeClause(HEIGHT_EXPRESSION, RESOLUTION_BUCKETS.find((bucket) => bucket.code === valid.resolution))})`);
  if (valid.panelType) clauses.push(`${PANEL_EXPRESSION} = '${valid.panelType}'`);

  return clauses;
}

// rows = [[refreshRate, screenSize, height, panelType], ...] ของจอที่แสดงอยู่ในร้าน -> ตัวเลือกพร้อมจำนวน (ตัวเลือกที่ไม่มีสินค้าเลยจะไม่ถูกแสดง)
export function buildMonitorFilterOptions(rows) {
  const list = (Array.isArray(rows) ? rows : []).map((row) => ({
    hz: Number(row?.[0]) || 0,
    size: Number(row?.[1]) || 0,
    height: Number(row?.[2]) || 0,
    panel: typeof row?.[3] === 'string' ? row[3].trim() : ''
  }));
  const inBucket = (value, bucket) => value > bucket.min && value <= bucket.max;

  const panelCounts = new Map();
  for (const { panel } of list) {
    if (PANEL_PATTERN.test(panel)) panelCounts.set(panel, (panelCounts.get(panel) || 0) + 1);
  }

  return {
    refreshRates: REFRESH_RATE_STEPS.map((step) => ({ value: String(step), label: `${step} Hz ขึ้นไป`, count: list.filter((item) => item.hz >= step).length })).filter((option) => option.count > 0),
    screenSizes: SIZE_BUCKETS.map((bucket) => ({ value: bucket.code, label: bucket.label, count: list.filter((item) => item.size > 0 && inBucket(item.size, bucket)).length })).filter((option) => option.count > 0),
    resolutions: RESOLUTION_BUCKETS.map((bucket) => ({ value: bucket.code, label: bucket.label, count: list.filter((item) => item.height > 0 && inBucket(item.height, bucket)).length })).filter((option) => option.count > 0),
    panelTypes: [...panelCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([panel, count]) => ({ value: panel, label: panel, count }))
  };
}

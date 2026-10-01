import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  canonicalNameFromTitle,
  normalizeYesNo,
  extractSpecRows,
  normalizeCacheSize,
  parseCoresThreads,
  parseCpuProductPage,
  toDetailedSpecEntry
} from '../scripts/lib/banana-spec-parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ฟิกซ์เจอร์นี้สร้างขึ้นใหม่จากตาราง Specification ของหน้า Ryzen 5 5500 บน Banana ที่ตรวจดูจริง
// (ค่าตรงกับตารางต้นฉบับ แต่ HTML เป็นโครงที่เราเขียนเอง ไม่ใช่ HTML ดิบของเว็บ)
// ถ้าเว็บจริงใช้โครงต่างจากนี้ ให้รัน scrape ด้วย --save-html แล้วเพิ่มฟิกซ์เจอร์จากไฟล์จริง
const RYZEN_5500_HTML = `
<div class="spec"><h3>Specification</h3>
<table>
  <tr><td>CPU Brand</td><td>AMD</td></tr>
  <tr><td>CPU Series</td><td>AMD Ryzen 5000 Series</td></tr>
  <tr><td>CPU Model</td><td>Ryzen 5 5500</td></tr>
  <tr><td>CPU Socket Type</td><td>AMD AM4</td></tr>
  <tr><td>Core Name</td><td>Cezanne</td></tr>
  <tr><td># of Cores</td><td>6 Core / 12 Threads</td></tr>
  <tr><td>Operating Frequency</td><td>3.6 GHz up to 4.2 GHz</td></tr>
  <tr><td>L2 Cache</td><td>3 MB</td></tr>
  <tr><td>L3 Cache</td><td>16 MB</td></tr>
  <tr><td>Manufacturing Tech</td><td>7 nm</td></tr>
  <tr><td>64Bit Support</td><td>Yes</td></tr>
  <tr><td>Virtualization Technology Support</td><td>Yes</td></tr>
  <tr><td>Thermal Design Power</td><td>65 W</td></tr>
  <tr><td>Warranty</td><td>3 Year</td></tr>
</table></div>`;

const RYZEN_5500_TITLE = 'ซีพียู AMD Ryzen 5 5500 3.6GHz 6C/12T AM4';

test('extractSpecRows อ่านทุกแถวของตาราง และถอด entity/แท็กซ้อนได้', () => {
  const rows = extractSpecRows('<table><tr><th>TDP&nbsp;</th><td><span>65&nbsp;W</span></td></tr></table>');
  assert.deepEqual(rows, [{ label: 'TDP', value: '65 W' }]);
  assert.equal(extractSpecRows(RYZEN_5500_HTML).length, 14);
});

test('parseCpuProductPage อ่าน Ryzen 5 5500 ได้ตรงกับตารางจริง', () => {
  const parsed = parseCpuProductPage(RYZEN_5500_HTML, { title: RYZEN_5500_TITLE, url: 'https://example.test/p' });

  assert.equal(parsed.ok, true);
  assert.equal(parsed.name, 'AMD Ryzen 5 5500');
  assert.equal(parsed.spec.cores, 6);
  assert.equal(parsed.spec.threads, 12);
  assert.equal(parsed.spec.l2_cache, '3MB');
  assert.equal(parsed.spec.l3_cache, '16MB');
  assert.equal(parsed.spec.tdp_w, 65);
  assert.equal(parsed.spec.core_name, 'Cezanne');
  assert.equal(parsed.spec.socket, 'AMD AM4');
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.blocking, false);
  assert.equal(parsed.spec.series, 'AMD Ryzen 5000 Series');
  assert.equal(parsed.spec.process, '7 nm');
  assert.equal(parsed.spec.bit64_support, 'Yes');
  assert.equal(parsed.spec.virtualization_support, 'Yes');
  // ช่องที่ไม่ได้ใช้ (Warranty ฯลฯ) ต้องถูกรายงานว่ารู้จักไม่ครบ ไม่หายเงียบ
  assert.ok(parsed.unknownLabels.includes('Warranty'));
});

test('toDetailedSpecEntry ใช้ชื่อฟิลด์ที่ apply-cpu-detailed-specs.js อ่าน', () => {
  const parsed = parseCpuProductPage(RYZEN_5500_HTML, { title: RYZEN_5500_TITLE, url: 'https://example.test/p' });
  const entry = toDetailedSpecEntry(parsed, { scrapedAt: '2026-09-29T00:00:00.000Z' });

  for (const key of ['threads', 'l1_cache', 'l2_cache', 'l3_cache', 'thermal_solution', 'source']) {
    assert.ok(key in entry, `ขาดฟิลด์ ${key}`);
  }
  assert.equal(entry.threads, 12);
  assert.equal(entry.thermal_solution, null);
});

test('เตือนเมื่อคอร์/เธรดในตารางไม่ตรงกับชื่อสินค้า และเมื่อค่าผิดปกติ', () => {
  const html = '<table><tr><td>CPU Model</td><td>X</td></tr><tr><td># of Cores</td><td>8 Core / 12 Threads</td></tr><tr><td>Thermal Design Power</td><td>65 W</td></tr></table>';
  const parsed = parseCpuProductPage(html, { title: 'ซีพียู AMD Ryzen 5 5500 3.6GHz 6C/12T AM4' });

  assert.ok(parsed.warnings.some((w) => w.includes('คอร์ในตาราง')));
  assert.equal(parsed.blocking, true);
});

test('ใช้ threads จากชื่อสินค้าเป็นตัวสำรอง พร้อมเตือน', () => {
  const html = '<table><tr><td>CPU Model</td><td>X</td></tr><tr><td>L3 Cache</td><td>16 MB</td></tr><tr><td>Thermal Design Power</td><td>65 W</td></tr></table>';
  const parsed = parseCpuProductPage(html, { title: RYZEN_5500_TITLE });

  assert.equal(parsed.spec.threads, 12);
  assert.ok(parsed.warnings.some((w) => w.includes('มาจากชื่อสินค้า')));
});

test('หน้าที่ไม่มีตารางสเปคต้องไม่ถูกนับว่าอ่านสำเร็จ', () => {
  const parsed = parseCpuProductPage('<html><body>Loading...</body></html>', { title: RYZEN_5500_TITLE });
  assert.equal(parsed.ok, false);
});

test('normalizeCacheSize / parseCoresThreads', () => {
  assert.equal(normalizeCacheSize('3 MB'), '3MB');
  assert.equal(normalizeCacheSize('512 kb'), '512KB');
  assert.equal(normalizeCacheSize('36 MB Intel Smart Cache'), '36MB');
  assert.equal(normalizeCacheSize('24 MB SmartCache'), '24MB');
  assert.equal(normalizeCacheSize('ไม่ระบุ'), 'ไม่ระบุ');
  assert.deepEqual(parseCoresThreads('14 Core (6P+8E) / 20 Threads'), { cores: 14, threads: 20 });
  assert.deepEqual(parseCoresThreads('24 Core / 24 Threads'), { cores: 24, threads: 24 });
});

test('canonicalNameFromTitle: ตัวอย่างเฉพาะที่รูปแบบชื่อต่างกัน', () => {
  const cases = {
    'ซีพียู AMD Ryzen 5 5500GT CPU 4.4GHz 6C/12T AM4': 'AMD Ryzen 5 5500GT',
    'ซีพียู AMD Ryzen 9 9900X3D 4.4GHz 12C/24T': 'AMD Ryzen 9 9900X3D',
    'ซีพียู AMD Ryzen 5 7500F 3.7-5.0MHz 6C/12T AM5': 'AMD Ryzen 5 7500F',
    'ซีพียู Intel Core Ultra 5 245KF 4.20GHz 14C/14T 24MB LGA1851': 'Intel Core Ultra 5 245KF',
    'ซีพียู Intel Core i5-14400 4.70GHz 10C/16T LGA-1700': 'Intel Core i5-14400',
    'ซีพียู Intel Core i5-13600K 3.5GHz 14C/20T LGA-1700': 'Intel Core i5-13600K'
  };
  for (const [title, expected] of Object.entries(cases)) {
    assert.equal(canonicalNameFromTitle(title), expected, title);
  }
});

// ทดสอบกับชื่อจริงทุกรายการที่ crawl-banana-catalog.js เก็บไว้ (ข้ามถ้าไม่มีไฟล์)
test('ชื่อมาตรฐานจากแคตตาล็อก CPU ของ Banana ทุกรายการต้องสะอาดและไม่ซ้ำกัน', (t) => {
  const path = join(__dirname, '../scripts/banana-catalog-cpu.json');
  if (!existsSync(path)) {
    t.skip('ไม่มี banana-catalog-cpu.json');
    return;
  }

  const catalog = JSON.parse(readFileSync(path, 'utf8'));
  const names = catalog.map((item) => canonicalNameFromTitle(item.name));

  names.forEach((name, i) => {
    assert.ok(name, `ได้ชื่อว่างจาก: ${catalog[i].name}`);
    assert.match(name, /^(AMD|Intel) /, `ต้องขึ้นต้นด้วยแบรนด์: ${name}`);
    assert.doesNotMatch(name, /GHz|MHz|\d+C\/\d+T|LGA|\bAM[45]\b|\bCPU\b/i, `ยังมีส่วนเกินติดมา: ${name}`);
  });
  assert.equal(new Set(names).size, names.length, 'มีชื่อมาตรฐานซ้ำกัน');
});

test('normalizeYesNo: Yes/No ไม่สนตัวพิมพ์ ค่าอื่นเก็บตามเดิม', () => {
  assert.equal(normalizeYesNo('yes'), 'Yes');
  assert.equal(normalizeYesNo(' NO '), 'No');
  assert.equal(normalizeYesNo('Yes (Intel VT-x)'), 'Yes (Intel VT-x)');
  assert.equal(normalizeYesNo(''), null);
});

test('toDetailedSpecEntry เก็บ series/64bit/virtualization สำหรับสคริปต์เติมแถวเพิ่ม', () => {
  const parsed = parseCpuProductPage(RYZEN_5500_HTML, { title: RYZEN_5500_TITLE, url: 'https://example.test/p' });
  const entry = toDetailedSpecEntry(parsed);
  assert.equal(entry.series, 'AMD Ryzen 5000 Series');
  assert.equal(entry.bit64_support, 'Yes');
  assert.equal(entry.virtualization_support, 'Yes');
});

test('Manufacturing Tech เป็น "N/A" (เช่น Ryzen 3 3200G บน Banana) ต้องกลายเป็นไม่มีข้อมูล ไม่ใช่ค่าจริง', () => {
  const html = RYZEN_5500_HTML.replace('<td>7 nm</td>', '<td>N/A</td>');
  const parsed = parseCpuProductPage(html, { title: RYZEN_5500_TITLE, url: 'https://example.test/p' });
  assert.equal(parsed.spec.process, null);
  assert.equal(toDetailedSpecEntry(parsed).process, null);
});

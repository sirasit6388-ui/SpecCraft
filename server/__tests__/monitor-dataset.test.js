import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cleanMonitorName, monitorBrand, monitorKey, transformMonitors } from '../scripts/lib/monitor-dataset.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const row = (over = {}) => ({
  name: 'Asus TUF Gaming VG27AQ',
  price: 249,
  screen_size: 27,
  resolution: [2560, 1440],
  refresh_rate: 165,
  response_time: 1,
  panel_type: 'IPS',
  aspect_ratio: '16:9',
  ...over
});

test('cleanMonitorName collapses a doubled brand and whitespace', () => {
  assert.equal(cleanMonitorName('Acer Acer Nitro XV272U W2bmiiprx'), 'Acer Nitro XV272U W2bmiiprx');
  assert.equal(cleanMonitorName('  LG   27GP850-B '), 'LG 27GP850-B');
  assert.equal(cleanMonitorName('Dell Dell'), 'Dell Dell'); // ไม่มีอะไรตามหลังชื่อซ้ำ จึงไม่แตะ
  assert.equal(cleanMonitorName(null), '');
  assert.equal(monitorBrand('Asus TUF'), 'Asus');
});

test('transformMonitors keeps priced monitors and converts each row to the products shape', () => {
  const { products, stats } = transformMonitors([row()]);

  assert.equal(stats.kept, 1);
  assert.deepEqual(products[0], {
    category: 'monitor',
    brand: 'Asus',
    name: 'Asus TUF Gaming VG27AQ',
    priceUsd: 249,
    specs: {
      screen_size: 27,
      resolution: [2560, 1440],
      refresh_rate: 165,
      response_time: 1,
      panel_type: 'IPS',
      aspect_ratio: '16:9'
    }
  });
});

test('transformMonitors leaves out missing optional specs instead of writing nulls', () => {
  const { products } = transformMonitors([row({ refresh_rate: null, response_time: undefined, panel_type: '' })]);
  assert.deepEqual(Object.keys(products[0].specs).sort(), ['aspect_ratio', 'resolution', 'screen_size']);
});

test('transformMonitors filters: unpriced, TVs, extreme prices, invalid rows', () => {
  const rows = [
    row({ name: 'Priced A' }),
    row({ name: 'No price', price: null }),
    row({ name: 'Huge TV 65', screen_size: 65 }),
    row({ name: 'Signage', price: 9333 }),
    row({ name: 'Bad resolution', resolution: [0, 0] }),
    row({ name: '', price: 100 })
  ];
  const { products, stats } = transformMonitors(rows);

  assert.deepEqual(products.map((p) => p.name), ['Priced A']);
  assert.equal(stats.unpriced, 1);
  assert.equal(stats.outOfRange, 2);
  assert.equal(stats.invalid, 2);

  const all = transformMonitors(rows, { pricedOnly: false });
  assert.deepEqual(all.products.map((p) => p.name), ['Priced A', 'No price']);
  assert.equal(all.products[1].priceUsd, null);
});

test('transformMonitors de-duplicates by normalized name and keeps the most complete row', () => {
  const rows = [
    row({ name: 'BenQ GW2480', refresh_rate: null, response_time: null, panel_type: null }),
    row({ name: 'BENQ  gw2480' }), // ต่างแค่ตัวพิมพ์/ช่องว่าง แต่ข้อมูลครบกว่า
    row({ name: 'Acer Acer Nitro' }),
    row({ name: 'Acer Nitro' })
  ];
  const { products, stats } = transformMonitors(rows);

  assert.equal(products.length, 2);
  assert.equal(stats.duplicate, 2);
  assert.equal(products.find((p) => monitorKey(p.name) === 'benqgw2480').specs.refresh_rate, 165);
});

test('real docyx monitor.json (if present): sane counts and every row has the fields the page needs', (t) => {
  const file = join(__dirname, '../scripts/data/monitor.json');
  if (!existsSync(file)) {
    t.skip('ไม่มี server/scripts/data/monitor.json');
    return;
  }

  const rows = JSON.parse(readFileSync(file, 'utf8'));
  const { products, stats } = transformMonitors(rows);

  assert.ok(products.length > 500 && products.length < stats.input, `จำนวนที่เหลือแปลก: ${products.length}`);
  assert.equal(new Set(products.map((p) => monitorKey(p.name))).size, products.length, 'ยังมีชื่อซ้ำ');

  for (const product of products) {
    assert.equal(product.category, 'monitor');
    assert.ok(product.brand, `ไม่มีแบรนด์: ${product.name}`);
    assert.ok(product.priceUsd > 0, `ไม่มีราคา: ${product.name}`);
    assert.ok(product.specs.screen_size >= 10 && product.specs.screen_size <= 49, `ขนาดผิดปกติ: ${product.name}`);
    assert.equal(product.specs.resolution.length, 2);
    assert.doesNotMatch(product.name, /^(\w+)\s+\1\s/i, `ยังมีแบรนด์ซ้ำ: ${product.name}`);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBananaIndex, matchMonitor, modelTokens, normalizeToken } from '../scripts/lib/monitor-availability.js';

// ชื่อจริงจากหน้ารายการจอของ Banana (bnn.in.th/en/p/computer-hardware-diy/monitor-computer-hardware-diy)
const BANANA = [
  { name: 'จอมอนิเตอร์ LENOVO L22-4e (IPS 100Hz)', url: 'https://www.bnn.in.th/en/p/lenovo-monitor-l22-4e-ips-100hz-hdmivga-198158424233_zo73v7' },
  { name: 'จอมอนิเตอร์ BENQ ZOWIE XL2566X+ Gaming Monitor (Fast TN 400Hz DyAc 2)', url: 'https://www.bnn.in.th/en/p/benq-xl2566x_1' },
  { name: 'จอมอนิเตอร์ DAHUA DHI-LM22-B201S (IPS 100Hz SPK)', url: 'https://www.bnn.in.th/en/p/dahua-monitor-dhi-lm22-b201s_1' },
  { name: 'จอมอนิเตอร์ DAHUA DHI-LM25-B221B (IPS 144Hz)', url: 'https://www.bnn.in.th/en/p/dahua-monitor-dhi-lm25-b221b_1' },
  { name: 'จอมอนิเตอร์ DELL Pro P2226H (IPS 100Hz Pivot)', url: 'https://www.bnn.in.th/en/p/dell-monitor-p2226h_1' },
  { name: 'จอมอนิเตอร์ SAMSUNG Odyssey G9 LS49DG930SEXXT Gaming Monitor (OLED DQHD 2K 240Hz)', url: 'https://www.bnn.in.th/en/p/samsung-ls49dg930sexxt_1' },
  { name: 'จอมอนิเตอร์ LG 27U411B-B (IPS 144Hz)', url: 'https://www.bnn.in.th/en/p/lg-monitor-27u411b-b_1' },
  { name: 'จอมอนิเตอร์ VIEWSONIC VX27G33-2K Gaming Monitor (IPS 2K 340Hz)', url: 'https://www.bnn.in.th/en/p/viewsonic-vx27g33-2k_1' },
  { name: 'จอมอนิเตอร์ AOC 25B40HM/67 (VA 100Hz)', url: 'https://www.bnn.in.th/en/p/aoc-25b40hm67_1' },
  { name: 'จอมอนิเตอร์ ASUS ROG Strix XG27ACMES-W Gaming Monitor (Fast IPS 2K 255Hz)', url: 'https://www.bnn.in.th/en/p/asus-xg27acmes-w_1' },
  { name: 'จอมอนิเตอร์ ASUS TUF Gaming VG27AQL5A Gaming Monitor (Fast IPS 2K 210Hz OC)', url: 'https://www.bnn.in.th/en/p/asus-vg27aql5a_1' }
];
const index = buildBananaIndex(BANANA);
const match = (name, brand) => matchMonitor({ name, brand: brand ?? name.split(' ')[0] }, index);

test('normalizeToken keeps only A-Z0-9 uppercased', () => {
  assert.equal(normalizeToken('24MR400-B'), '24MR400B');
  assert.equal(normalizeToken('25B40HM/67'), '25B40HM67');
  assert.equal(normalizeToken(null), '');
});

test('modelTokens picks model codes and ignores sizes, refresh rates, panel and marketing words', () => {
  assert.deepEqual(modelTokens('Asus TUF Gaming VG27AQ').map((t) => t.full), ['VG27AQ']);
  assert.deepEqual(modelTokens('LG 27" IPS 144Hz 1080p HDR400 27GP850-B').map((t) => t.full), ['27GP850B']);
  assert.deepEqual(modelTokens('KOORUI 24E3').map((t) => t.full), []); // สั้นเกินไป (4 ตัว) เทียบไม่ได้
  assert.deepEqual(modelTokens('Acer Acer Nitro XV272U W2bmiiprx').map((t) => t.full), ['XV272U', 'W2BMIIPRX']);
});

test('exact match on the model code, ignoring the Thai prefix and the spec text', () => {
  const result = match('LG 27U411B-B');
  assert.equal(result.status, 'found');
  assert.equal(result.level, 'exact');
  assert.equal(result.matches[0].url, 'https://www.bnn.in.th/en/p/lg-monitor-27u411b-b_1');
  assert.equal(match('Dell P2226H').status, 'found');
  assert.equal(match('Samsung Odyssey G9 LS49DG930SEXXT').status, 'found');
});

test('a short colour/region suffix may differ (family match) but only with the same brand', () => {
  // ฐานข้อมูลไม่มี -B / Banana มี -B
  assert.deepEqual([match('LG 27U411B').status, match('LG 27U411B').level], ['found', 'exact']);
  // ฐานข้อมูลมี -B ส่วน Banana ไม่มีส่วนต่อท้าย (family)
  const asus = match('Asus ROG Strix XG27ACMES');
  assert.equal(asus.status, 'found');
  const aoc = match('AOC 25B40HM');
  assert.equal(aoc.status, 'found');
  // รหัสเดียวกันแต่คนละแบรนด์ ต้องไม่จับคู่ระดับ family
  assert.equal(match('Acme XG27ACMES', 'Acme').status, 'not_found');
});

test('models that share a series prefix are different products (DHI-LM25-B221B vs B201S)', () => {
  assert.equal(match('Dahua DHI-LM25-B221B').status, 'found');
  assert.equal(match('Dahua DHI-LM25-B201S').status, 'not_found'); // Banana มีแต่ LM22-B201S และ LM25-B221B
  assert.equal(match('Dahua DHI-LM22-B201S').status, 'found');
});

test('a model that Banana does not list is not_found; a name with no usable code is unknown, never not_found', () => {
  assert.equal(match('NEC MultiSync EA243WU').status, 'not_found');
  assert.equal(match('KOORUI 24E3').status, 'unknown');
  assert.equal(match('Generic 27 inch 144Hz IPS').status, 'unknown');
});

test('multiple Banana entries can match one product and all are reported', () => {
  const twin = buildBananaIndex([
    { name: 'จอมอนิเตอร์ LG 27U411B-B (Black)', url: 'https://x/1' },
    { name: 'จอมอนิเตอร์ LG 27U411B-W (White)', url: 'https://x/2' }
  ]);
  const result = matchMonitor({ name: 'LG 27U411B', brand: 'LG' }, twin);
  assert.equal(result.status, 'found');
  assert.equal(result.matches.length, 2);
});

test('empty or malformed input never throws', () => {
  assert.equal(matchMonitor({ name: '' }, index).status, 'unknown');
  assert.equal(matchMonitor(null, index).status, 'unknown');
  assert.deepEqual(buildBananaIndex(null), []);
  assert.equal(matchMonitor({ name: 'LG 27U411B-B' }, []).status, 'not_found');
});

// ---- ผลจริงจาก dry-run ของผู้ใช้ (รายการ family 2 รายการ) ----
test('ViewSonic VP2756-2K and VP2756-4K are different products: a resolution tail is never stripped', () => {
  const idx = buildBananaIndex([{ name: 'จอมอนิเตอร์ VIEWSONIC VP2756-4K (IPS 4K 60Hz USB-C 60W Pivot)', url: 'https://x/vp2756-4k' }]);

  assert.equal(matchMonitor({ name: 'ViewSonic VP2756-2K', brand: 'ViewSonic' }, idx).status, 'not_found');
  assert.equal(matchMonitor({ name: 'ViewSonic VP2756-4K', brand: 'ViewSonic' }, idx).level, 'exact');
  assert.deepEqual(modelTokens('VX27G33-2K').map((t) => t.variants), [['VX27G332K']]);
});

test('LG 32GS95UV-W vs Banana 32GS95UV-B.ATM is the same model in another colour: reported as family, not exact', () => {
  const idx = buildBananaIndex([{ name: 'จอมอนิเตอร์ LG UltraGear 32GS95UV-B.ATM Gaming Monitor (OLED 4K 240Hz)', url: 'https://x/32gs95uv' }]);

  const white = matchMonitor({ name: 'LG UltraGear 32GS95UV-W', brand: 'LG' }, idx);
  assert.deepEqual([white.status, white.level], ['found', 'family']);

  // สีเดียวกัน หรือไม่ระบุสี/ตลาด -> exact
  assert.equal(matchMonitor({ name: 'LG UltraGear 32GS95UV-B', brand: 'LG' }, idx).level, 'exact');
  assert.equal(matchMonitor({ name: 'LG UltraGear 32GS95UV', brand: 'LG' }, idx).level, 'exact');
});

test('only colour (-B), region (/67) and market (.ATM) tails are stripped', () => {
  assert.deepEqual(modelTokens('32GS95UV-B.ATM')[0].variants, ['32GS95UVBATM', '32GS95UVB', '32GS95UV']);
  assert.deepEqual(modelTokens('25B40HM/67')[0].variants, ['25B40HM67', '25B40HM']);
  assert.deepEqual(modelTokens('24MR400-B')[0].variants, ['24MR400B', '24MR400']);
  assert.deepEqual(modelTokens('DHI-LM25-B221B')[0].variants, ['DHILM25B221B']);
  assert.deepEqual(modelTokens('VP2756-4K')[0].variants, ['VP27564K']);
});

// ชื่อ 2 ฝั่งของคู่ที่จับคู่ได้จริงใน dry-run ของผู้ใช้ (12 คู่ที่ตรวจด้วยตาแล้วว่าเป็นรุ่นเดียวกัน) ต้องยังเป็น exact เสมอ
test('the 12 pairs verified by eye from the real dry-run all stay exact matches', () => {
  const pairs = [
    ['MSI MAG 275QF', 'จอมอนิเตอร์ MSI MAG 275QF Gaming Monitor (Rapid IPS 2K 180Hz 0.5ms AI-VISON)'],
    ['Asus ROG Swift OLED PG27AQDP', 'จอมอนิเตอร์ ASUS ROG Swift OLED PG27AQDP Gaming Monitor (OLED 2K 480Hz)'],
    ['Dell Alienware AW3225QF', 'จอมอนิเตอร์ DELL ALIENWARE AW3225QF Gaming Monitor (OLED 4K 240Hz Curved)'],
    ['Asus ROG Swift OLED PG27UCDM', 'จอมอนิเตอร์ ASUS ROG Swift OLED PG27UCDM Gaming Monitor (QD-OLED 4K 240Hz)'],
    ['BenQ XL2586X+', 'จอมอนิเตอร์ BENQ ZOWIE XL2586X+ Gaming Monitor (Fast TN DyAc 2 600Hz)'],
    ['Dell Alienware AW3425DW', 'จอมอนิเตอร์ DELL ALIENWARE AW3425DW Gaming Monitor (QD-OLED 2K 240Hz)'],
    ['MSI MAG 274QRFW', 'จอมอนิเตอร์ MSI MAG 274QRFW E20 Gaming Monitor (Rapid IPS 2K 200Hz)'],
    ['Dell Alienware AW2725DF', 'จอมอนิเตอร์ DELL ALIENWARE AW2725DF Gaming Monitor (OLED 2K 360Hz)'],
    ['Asus ROG Strix XG27AQDMG', 'จอมอนิเตอร์ ASUS ROG Strix XG27AQDMG Gaming Monitor (OLED 2K 240Hz)'],
    ['MSI MPG 322URX QD-OLED', 'จอมอนิเตอร์ MSI MPG 322URX Gaming Monitor (QD-OLED 4K 240Hz USB-C 98W)'],
    ['LG UltraGear OLED 27GX790A-B', 'จอมอนิเตอร์ LG UltraGear 27GX790A-B Gaming Monitor (OLED 2K 480Hz)'],
    ['LG 27GS75Q-B', 'จอมอนิเตอร์ LG UltraGear 27GS75Q-B Gaming Monitor (IPS 2K 180Hz OC 200Hz)']
  ];

  for (const [ours, theirs] of pairs) {
    const result = matchMonitor({ name: ours, brand: ours.split(' ')[0] }, buildBananaIndex([{ name: theirs, url: 'https://x/y' }]));
    assert.deepEqual([result.status, result.level], ['found', 'exact'], ours);
  }
});

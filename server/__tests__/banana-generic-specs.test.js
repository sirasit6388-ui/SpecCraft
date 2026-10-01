import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractAllSpecRows, isSafeBananaUrl, sizeConflict, skuFromUrl, socketConflict } from '../scripts/lib/banana-generic-specs.js';
import { evaluateRobots } from '../scripts/lib/banana-http.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ฟิกซ์เจอร์: แถวสเปคเมนบอร์ด (ค่าตรงกับตารางบนหน้าสินค้า Banana ที่ตรวจดูจริง) ห่อด้วย HTML ที่เราเขียนเอง
// ไม่ใช่ HTML ดิบของเว็บ - ถ้าโครงจริงต่างออกไป ให้รัน scrape ด้วย --save-html แล้วเพิ่มฟิกซ์เจอร์จากไฟล์จริง
const MOTHERBOARD_ROWS = [
  ['CPU Socket Type', 'AMD AM4'],
  ['CPU Type', 'AMD Ryzen 3000, 5000 Series Desktop Processors (not Support 3000G Series)'],
  ['Supported CPU Technologies', 'AMD Zen3'],
  ['Chipset', 'AMD A520'],
  ['Number of Memory Slots', '2x DIMM'],
  ['Memory Standard', 'DDR4 Support up to 4600(OC) MHz'],
  ['Maximum Memory Supported', '64 GB'],
  ['Expansion Slot', '1x PCIe 3.0 x16 slot, 2x PCIe 3.0 x1 slot'],
  ['Storage Devices', '1x M.2 PCIe 3.0 x4 slot, 4x SATA III Port (Support SATA RAID at 0/1/10)'],
  ['Onboard Video Chipset', 'Integrated Graphic on Processor'],
  ['Dimensions W x D x H', '22.6 x 22.1 cm'],
  ['Case spec', 'Micro-ATX Form Factor'],
  ['Power Pin', '1x 24-pin Main Power Connector, 1x 8-pin Power Connector']
];

const toHtml = (rows) =>
  `<table>${rows.map(([l, v]) => `<tr><td>${l}</td><td>${v.replace(/&/g, '&amp;')}</td></tr>`).join('')}</table>`;

test('extractAllSpecRows เก็บทุกแถวตามลำดับเดิมของหน้าเว็บ', () => {
  const rows = extractAllSpecRows(toHtml(MOTHERBOARD_ROWS));
  assert.deepEqual(rows, MOTHERBOARD_ROWS);
});

test('extractAllSpecRows ตัดแถวซ้ำ แถวของร้าน และแถวที่ยาวผิดปกติ', () => {
  const html = toHtml([
    ['Chipset', 'AMD A520'],
    ['Chipset', 'AMD A520'],
    ['Price', '3,290'],
    ['SKU', '4711387140697'],
    ['Note', 'x'.repeat(500)],
    ['Weight', '1.2 kg']
  ]);
  assert.deepEqual(extractAllSpecRows(html), [['Chipset', 'AMD A520'], ['Weight', '1.2 kg']]);
});

test('extractAllSpecRows ไม่เก็บแถวการรับประกัน (Warranty)', () => {
  const html = toHtml([
    ['Chipset', 'AMD A520'],
    ['Warranty', '3 Year + 1 Year (Register)'],
    ['Warranty Period', '3 Year'],
    ['การรับประกัน', '3 ปี'],
    ['Weight', '1.2 kg']
  ]);
  assert.deepEqual(extractAllSpecRows(html), [['Chipset', 'AMD A520'], ['Weight', '1.2 kg']]);
});

test('extractAllSpecRows ถอด entity เช่น &amp; และคืนค่าว่างเมื่อไม่มีตาราง', () => {
  assert.deepEqual(extractAllSpecRows('<table><tr><td>Rear Ports</td><td>USB &amp; HDMI</td></tr></table>'), [['Rear Ports', 'USB & HDMI']]);
  assert.deepEqual(extractAllSpecRows('<html>Loading...</html>'), []);
});

test('skuFromUrl ดึง SKU จากลิงก์สินค้า Banana', () => {
  assert.equal(skuFromUrl('https://www.bnn.in.th/th/p/msi-mainboard-pro-b760m-p-ddr5-lga-1700-4711377086578_r61gyv'), '4711377086578');
  assert.equal(skuFromUrl('https://www.bnn.in.th/en/p/amd-cpu-ryzen-5-5500-36ghz-6c12t-am4-gen5-730143314121_dke7j2?x=1'), '730143314121');
  assert.equal(skuFromUrl('https://www.bnn.in.th/th/p/no-sku-here'), null);
});

test('SKU ของทุกลิงก์ในแคตตาล็อกที่มี ต้องไม่ซ้ำกันภายในหมวดเดียวกัน', (t) => {
  const dir = join(__dirname, '../scripts');
  let checked = 0;
  for (const category of ['motherboard', 'video-card', 'memory', 'internal-hard-drive', 'power-supply', 'case', 'cpu-cooler']) {
    const file = join(dir, `banana-catalog-${category}.json`);
    if (!existsSync(file)) continue;
    const skus = JSON.parse(readFileSync(file, 'utf8')).map((item) => skuFromUrl(item.url)).filter(Boolean);
    assert.equal(new Set(skus).size, skus.length, `${category}: มี SKU ซ้ำ`);
    checked += 1;
  }
  if (!checked) t.skip('ไม่มีไฟล์แคตตาล็อก');
});

test('isSafeBananaUrl รับเฉพาะ https ของ bnn.in.th', () => {
  assert.equal(isSafeBananaUrl('https://www.bnn.in.th/en/p/x_1'), true);
  assert.equal(isSafeBananaUrl('http://www.bnn.in.th/en/p/x_1'), false);
  assert.equal(isSafeBananaUrl('https://evil.example/bnn.in.th'), false);
  assert.equal(isSafeBananaUrl('https://www.bnn.in.th.evil.example/x'), false);
  assert.equal(isSafeBananaUrl('javascript:alert(1)'), false);
  assert.equal(isSafeBananaUrl(null), false);
});

test('socketConflict เตือนเมื่อ socket ในฐานข้อมูลไม่ตรงกับตาราง Banana', () => {
  assert.equal(socketConflict('AM4', MOTHERBOARD_ROWS), null);
  assert.match(socketConflict('LGA1700', MOTHERBOARD_ROWS), /ไม่ตรง/);
  assert.equal(socketConflict(null, MOTHERBOARD_ROWS), null);
  assert.equal(socketConflict('AM4', [['Chipset', 'AMD A520']]), null);
});

test('evaluateRobots: ห้ามเฉพาะ path ที่ประกาศ และ Allow ที่ยาวกว่าชนะ', () => {
  const robots = 'User-agent: *\nDisallow: /th/p/\nAllow: /th/p/public\nUser-agent: other\nDisallow: /';
  assert.equal(evaluateRobots(robots, '/th/p/x_1').allowed, false);
  assert.equal(evaluateRobots(robots, '/th/p/public-x').allowed, true);
  assert.equal(evaluateRobots(robots, '/en/p/x_1').allowed, true);
  assert.equal(evaluateRobots('', '/en/p/x_1').allowed, true);
});

// คู่ (ชื่อในฐานข้อมูลเรา, ลิงก์ Banana ที่จับคู่ได้) จริงจากผล dry-run ของหมวด cpu-cooler ที่ผู้ใช้ส่งมา
const REAL_COOLER_PAIRS = [
  ['Zalman ALPHA2 A36 Black 360mm 600-2000 RPM 29.7 dB', 'https://www.bnn.in.th/en/p/zalman-cpu-liquid-cooler-alpha2-a360-black-8809213764981_z774g6', false],
  ['Thermaltake TOUGHLIQUID Ultra RGB Black 280mm 500-2000 RPM 30.7 dB', 'https://www.bnn.in.th/en/p/thermaltake-cpu-liquid-cooler-aio-240-toughliquid-ultra-4713227527996_rq8vno', true],
  ['Thermaltake TOUGHLIQUID Ultra Black 420mm 500-2000 RPM 30.7 dB', 'https://www.bnn.in.th/en/p/thermaltake-cpu-liquid-cooler-aio-240-toughliquid-ultra-4713227527996_rq8vno', true],
  ['NZXT Kraken Plus Black 280mm 500-1700 RPM 30 dB', 'https://www.bnn.in.th/en/p/nzxt-cpu-liquid-cooling-kraken-plus-240-rgb-black-rl-kr240-b2-5056547205236_d20v5y', true],
  ['Asus ROG STRIX LC II ARGB Black 120mm 800-2500 RPM 37.6 dB', 'https://www.bnn.in.th/en/p/asus-cpu-cooler-rog-strix-lc-ii-240-argb-black-4711081145905_z3qq3l', true],
  ['Silverstone NovaPeak 360 ARGB Black 360mm 500-2200 RPM 12.1-33.1 dB', 'https://www.bnn.in.th/en/p/silverstone-cpu-liquid-cooler-novapeak-360-argb-black-sst-np360-argb-844761027704_dxy676', false],
  ['Zalman ALPHA2 A24 White 240mm 600-2000 RPM 29.7 dB', 'https://www.bnn.in.th/en/p/zalman-cpu-liquid-cooler-alpha2-a240-white-8809213764592_zw31gg', false],
  ['Ocypus Iota A40 White 500-2000 RPM 29 dB', 'https://www.bnn.in.th/en/p/ocypus-cpu-cooler-iota-a40-white-6977414880075_zpxy3k', false],
  ['Silverstone IceGem 240P Black 240mm 600-2200 RPM 7.3-36.6 dB', 'https://www.bnn.in.th/en/p/silverstone-cpu-liquid-cooler-icegem-240p-argb-844761021191_rq881v', false],
  ['Zalman Alpha2 DS A36 Black 360mm 600-2000 RPM 29.7 dB', 'https://www.bnn.in.th/en/p/zalman-cpu-cooler-alpha2-ds-a36-360-black-8800263650248_zjkqpv', false],
  // Deepcool: ชื่อรุ่น (LS520/LS720/LT520) ไม่มีขนาดในลิงก์ แต่จับคู่ถูกต้อง -> ต้องปล่อยผ่าน (เคยถูกข้ามผิดในเวอร์ชันแรก)
  ['Deepcool LS520 WH White 240mm 500-2250 RPM 32.9 dB', 'https://www.bnn.in.th/en/p/deepcool-cpu-liquid-cooler-ls520-white-6933412727651_dmx5j1', false],
  ['Deepcool LS720 WH White 360mm 500-2250 RPM 32.9 dB', 'https://www.bnn.in.th/en/p/deepcool-cpu-liquid-cooler-ls720-white-6933412727644_abc', false],
  ['Deepcool LT520 WH White 240mm 500-2250 RPM 32.9 dB', 'https://www.bnn.in.th/en/p/deepcool-cpu-liquid-cooler-lt520-white-6933412728115_abc', false]
];

test('sizeConflict: คู่จับคู่จริงจาก dry-run - จับผิดขนาดได้ถูก และปล่อยคู่ที่ถูกต้อง', () => {
  for (const [dbName, url, shouldConflict] of REAL_COOLER_PAIRS) {
    const result = sizeConflict(dbName, '', url);
    assert.equal(Boolean(result), shouldConflict, `${dbName} -> ${result}`);
  }
  assert.match(sizeConflict(REAL_COOLER_PAIRS[1][0], '', REAL_COOLER_PAIRS[1][1]), /280mm.*240/);
});

test('sizeConflict: "Gb/s" ของอินเทอร์เฟซไม่ใช่ความจุ (Samsung 870 Evo เคยถูกข้ามผิด)', () => {
  const dbName = 'Samsung 870 Evo 1 TB SSD SATA 6.0 Gb/s 2.5"';
  assert.equal(sizeConflict(dbName, 'เอสเอสดี Samsung 870 EVO 1TB SATA', 'https://www.bnn.in.th/en/p/samsung-ssd-870-evo-1tb-8806090527456_abc'), null);
  assert.equal(sizeConflict(dbName, '', 'https://www.bnn.in.th/en/p/samsung-ssd-870-evo-sata-8806090527456_abc'), null);
  assert.match(sizeConflict(dbName, 'เอสเอสดี Samsung 870 EVO 2TB', 'https://www.bnn.in.th/en/p/samsung-ssd-870-evo-2tb-8806090527999_abc'), /1000GB.*2000GB/);
});

test('sizeConflict: วัตต์ ความจุ (TB/GB) และ RAM แบบหลายแท่ง', () => {
  assert.equal(sizeConflict('MSI MAG A750GL PCIE5 750 W 80+ Gold', 'พาวเวอร์ซัพพลาย MSI MAG A750GL PCIE5 750W', 'https://www.bnn.in.th/en/p/msi-psu-a750gl-750w-4711377000000_abc'), null);
  assert.match(sizeConflict('MSI MAG A650BN 650 W', 'พาวเวอร์ซัพพลาย MSI MAG A750BN 750W', 'https://www.bnn.in.th/en/p/msi-psu-a750bn-750w-4711377000001_abc'), /650W/);
  assert.equal(sizeConflict('Samsung 990 Pro 2 TB', 'เอสเอสดี Samsung 990 Pro 2TB', 'https://www.bnn.in.th/en/p/samsung-990-pro-2tb-8806094000000_abc'), null);
  assert.equal(sizeConflict('Samsung 990 Pro 1 TB', 'เอสเอสดี Samsung 990 Pro 1000GB', 'https://www.bnn.in.th/en/p/samsung-990-pro-8806094000002_abc'), null);
  assert.match(sizeConflict('Samsung 990 Pro 2 TB', 'เอสเอสดี Samsung 990 Pro 1TB', 'https://www.bnn.in.th/en/p/samsung-990-pro-1tb-8806094000001_abc'), /2000GB/);
  assert.equal(sizeConflict('MSI PRO B760M-P', 'เมนบอร์ด MSI PRO B760M-P DDR5', 'https://www.bnn.in.th/en/p/msi-b760m-p-4711377086578_r61gyv'), null);
  assert.equal(sizeConflict('Corsair Vengeance 32 GB (2 x 16 GB) DDR5-6000', 'แรม Corsair Vengeance 32GB DDR5 6000MHz', 'https://www.bnn.in.th/en/p/corsair-ram-32gb-6000-1234567890123_abc'), null);
  assert.match(sizeConflict('Corsair Vengeance 32 GB (2 x 16 GB) DDR5-6000', 'แรม Corsair Vengeance 16GB DDR5 6000MHz', 'https://www.bnn.in.th/en/p/corsair-ram-16gb-6000-1234567890124_abc'), /32GB/);
});

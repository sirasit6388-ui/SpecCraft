import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanMonitorTitle, looksLikeMonitor, parseBananaProduct, parseMonitorSpecs, pickBrand } from '../scripts/lib/banana-monitor-page.js';

const page = (json, attrs = 'data-hid="jsonld-product" type="application/ld+json"') => `<html><head><script ${attrs}>${typeof json === 'string' ? json : JSON.stringify(json)}</script></head></html>`;

test('parseBananaProduct reads price, stock, brand and images from the jsonld-product block', () => {
  const result = parseBananaProduct(page({
    '@type': 'Product', name: 'จอมอนิเตอร์ LG 27U411B-B (IPS 144Hz)', brand: { '@type': 'Brand', name: 'LG' },
    image: ['https://media-cdn.bnn.in.th/1/a.jpg', 'https://media-cdn.bnn.in.th/1/b.jpg'],
    offers: { '@type': 'Offer', price: 7290, availability: 'https://schema.org/InStock' }
  }));

  assert.deepEqual(result, {
    ok: true, name: 'จอมอนิเตอร์ LG 27U411B-B (IPS 144Hz)', brand: 'LG', hasPrice: true, price: 7290, availability: 'InStock', inStock: true,
    images: ['https://media-cdn.bnn.in.th/1/a.jpg', 'https://media-cdn.bnn.in.th/1/b.jpg']
  });
});

test('parseBananaProduct handles string prices, offer arrays, @graph, multi-line JSON and out-of-stock', () => {
  assert.equal(parseBananaProduct(page({ '@graph': [{ '@type': 'WebSite' }, { '@type': 'Product', name: 'x', offers: [{ price: '1,990.00', availability: 'http://schema.org/OutOfStock' }] }] })).price, 1990);
  assert.equal(parseBananaProduct(page({ '@graph': [{ '@type': 'Product', name: 'x', offers: [{ price: 5, availability: 'https://schema.org/OutOfStock' }] }] })).inStock, false);
  assert.equal(parseBananaProduct(page('{\n "@type": "Product",\n "offers": { "price": 100 }\n}')).inStock, null);
  assert.equal(parseBananaProduct(page({ '@type': 'Product', brand: 'AOC', offers: { price: 100 } }, 'type="application/ld+json" data-hid="jsonld-product"')).brand, 'AOC');
});

test('parseBananaProduct reports why a page cannot be used', () => {
  assert.equal(parseBananaProduct('<html>no json</html>').ok, false);
  assert.match(parseBananaProduct(page('{ not json')).reason, /แปลง JSON-LD ไม่สำเร็จ/);
  // Product ที่ไม่มีราคา (0 / ว่าง) ยังอ่านได้ แต่ hasPrice = false และ price = null (ผู้เรียกตัดสินใจเองว่าจะนำเข้าไหม)
  const noPrice = parseBananaProduct(page({ '@type': 'Product', name: 'x', image: ['https://media-cdn.bnn.in.th/1/a.jpg'], offers: { price: 0, availability: 'https://schema.org/OutOfStock' } }));
  assert.deepEqual([noPrice.ok, noPrice.hasPrice, noPrice.price, noPrice.inStock, noPrice.images.length], [true, false, null, false, 1]);
  assert.equal(parseBananaProduct(page({ '@type': 'Product', offers: {} })).hasPrice, false);
  assert.match(parseBananaProduct(page({ '@type': 'Organization' })).reason, /ไม่พบ Product/);
  assert.equal(parseBananaProduct(null).ok, false);
});

test('cleanMonitorTitle removes the Thai category prefix; looksLikeMonitor filters other product types', () => {
  assert.equal(cleanMonitorTitle('จอมอนิเตอร์ SAMSUNG Odyssey G9  LS49DG930SEXXT'), 'SAMSUNG Odyssey G9 LS49DG930SEXXT');
  assert.equal(cleanMonitorTitle('  '), '');
  assert.equal(cleanMonitorTitle('x'.repeat(500)).length, 300);
  assert.equal(looksLikeMonitor('จอมอนิเตอร์ LG 24MR400-B'), true);
  assert.equal(looksLikeMonitor('Monitor Arm Stand'), true);
  assert.equal(looksLikeMonitor('เมาส์ไร้สาย Logitech'), false);
});

test('pickBrand: JSON-LD brand first, then a known brand found in the title, matched to the database spelling', () => {
  const known = ['Asus', 'MSI', 'LG', 'Samsung', 'ViewSonic'];
  assert.equal(pickBrand('SAMSUNG Odyssey G9', '', known), 'Samsung');
  assert.equal(pickBrand('VIEWSONIC VP2756-4K', '', known), 'ViewSonic');
  assert.equal(pickBrand('PORTABLE MONITOR 15.6" MSI PRO MP165 E6', '', known), 'MSI');
  assert.equal(pickBrand('NEWBRAND X27', '', known), 'Newbrand');
  assert.equal(pickBrand('XYZ X27', '', known), 'XYZ');
  assert.equal(pickBrand('anything', 'ASUS', known), 'Asus');
  assert.equal(pickBrand('', '', known), '');
});

test('parseMonitorSpecs: table values first, title fallback, nothing invented', () => {
  const rows = [['Screen Size', '27 inch'], ['Resolution', '2560 x 1440 (QHD)'], ['Refresh Rate', '165 Hz'], ['Response Time', '1 ms (GtG)'], ['Panel Type', 'Fast IPS'], ['Aspect Ratio', '16 : 9'], ['Warranty', '3 Year']];
  assert.deepEqual(parseMonitorSpecs(rows, 'ASUS TUF VG27AQ'), { screen_size: 27, resolution: [2560, 1440], refresh_rate: 165, response_time: 1, panel_type: 'IPS', aspect_ratio: '16:9' });

  // ไม่มีตาราง: ใช้ชื่อสินค้า (ขนาด/พาเนล/Hz) ความละเอียดไม่เดาจาก 2K/4K
  assert.deepEqual(parseMonitorSpecs([], 'MSI MAG 27" QD-OLED 4K 240Hz'), { screen_size: 27, refresh_rate: 240, panel_type: 'QD-OLED' });
  assert.deepEqual(parseMonitorSpecs([], 'จอทั่วไป ไม่มีสเปก'), {});
  assert.deepEqual(parseMonitorSpecs(null, ''), {});
  // ค่าเพี้ยน (ขนาดเกินช่วง, Hz แปลก) ไม่ถูกใส่
  assert.deepEqual(parseMonitorSpecs([['Screen Size', '5 inch'], ['Refresh Rate', '9999 Hz']], ''), {});
});

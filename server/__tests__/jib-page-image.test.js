import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJibImageCandidates, isAllowedJibImageUrl, jibImageVariants } from '../scripts/lib/jib-page-image.js';
import { buildReviewHtml, escapeHtml } from '../scripts/lib/review-sheet.js';

const BASE = 'https://www.jib.co.th/web/product/readProduct/65867/1409/MONITOR--MSI-MAG-27CQ6F';
// โครงหน้าที่สร้างขึ้นเอง (ไม่ใช่ HTML ดิบของ JIB) ใช้พาธรูปแบบเดียวกับที่พบในไฟล์ watermarked-cpu-images.json
const HTML = `<html><head>
<meta property="og:image" content="https://www.jib.co.th/img_master/product/medium/20260101120000_1.png">
<meta property="og:site_name" content="JIB">
</head><body>
<img src="/images/logo.png"><img src="https://www.jib.co.th/img_master/banner/promo.jpg">
<img data-src="//www.jib.co.th/img_master/product/original/20260101120000_2.png">
<img src="https://cdn.other.example/a.jpg"><img src="data:image/gif;base64,AAAA">
</body></html>`;

test('extractJibImageCandidates: only jib.co.th product images, logos/banners/other hosts removed, product folder first', () => {
  assert.deepEqual(extractJibImageCandidates(HTML, BASE), [
    'https://www.jib.co.th/img_master/product/medium/20260101120000_1.png',
    'https://www.jib.co.th/img_master/product/original/20260101120000_2.png'
  ]);
  assert.deepEqual(extractJibImageCandidates('', BASE), []);
  assert.deepEqual(extractJibImageCandidates(null, BASE), []);
});

test('isAllowedJibImageUrl: https jib.co.th images only', () => {
  assert.equal(isAllowedJibImageUrl('https://www.jib.co.th/img_master/product/original/20170803131443_1.png'), true);
  for (const bad of [
    'http://www.jib.co.th/img_master/product/original/a.png',
    'https://www.jib.co.th.evil.example/a.png',
    'https://evil.example/www.jib.co.th/a.png',
    'https://user:pw@www.jib.co.th/a.png',
    'https://www.jib.co.th:8443/a.png',
    'https://www.jib.co.th/img/logo.png',
    'https://www.jib.co.th/img_master/product/original/no_image.png',
    'https://www.jib.co.th/web/product/readProduct/1/x',   // ไม่ใช่ไฟล์รูป
    'javascript:alert(1)', '', null
  ]) {
    assert.equal(isAllowedJibImageUrl(bad), false, String(bad));
  }
});

test('jibImageVariants tries the original size first when the page gives a smaller one', () => {
  assert.deepEqual(jibImageVariants('https://www.jib.co.th/img_master/product/medium/a_1.png'), [
    'https://www.jib.co.th/img_master/product/original/a_1.png',
    'https://www.jib.co.th/img_master/product/medium/a_1.png'
  ]);
  assert.deepEqual(jibImageVariants('https://www.jib.co.th/img_master/product/original/a_1.png'), ['https://www.jib.co.th/img_master/product/original/a_1.png']);
});

test('buildReviewHtml escapes every text field, keeps only safe file names and http(s) links, and shows an enhanced-contrast copy', () => {
  const html = buildReviewHtml([
    { id: 7, name: '<script>alert(1)</script> "x" & y', page: 'https://www.jib.co.th/p/1', imageFile: '7.png', note: '<b>note</b>' },
    { id: 8, name: 'bad file', page: 'javascript:alert(1)', imageFile: '../../etc/passwd' },
    { id: 9, name: 'bad link', page: 'javascript:alert(1)', imageFile: '9.jpg' }
  ], { title: 'T <x>' });

  assert.ok(!html.includes('<script>alert(1)</script>'), 'ชื่อสินค้าต้องถูก escape');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &quot;x&quot; &amp; y'));
  assert.ok(html.includes('&lt;b&gt;note&lt;/b&gt;'));
  assert.ok(html.includes('T &lt;x&gt;'));
  assert.ok(html.includes('src="7.png"') && html.includes('src="9.jpg"'));
  assert.ok(!html.includes('passwd'), 'ชื่อไฟล์ที่มี path อันตรายต้องไม่ถูกใช้');
  assert.ok(!html.includes('javascript:alert(1)'), 'ลิงก์ที่ไม่ใช่ http(s) ต้องไม่ถูกใช้');
  assert.equal((html.match(/class="enhanced"/g) ?? []).length, 2);
  assert.match(html, /import-monitor-images-jib\.js --apply --ids=/);
  assert.equal(escapeHtml(null), '');
});

test('buildReviewHtml in remove mode labels the box as watermark and builds the --remove command', () => {
  const html = buildReviewHtml([{ id: 3, name: 'x', page: 'https://www.jib.co.th/p/3', imageFile: '3.jpg' }], { mode: 'remove' });
  assert.match(html, /มีลายน้ำ \/ ไม่ต้องการ \(ถอนรูปออก\)/);
  assert.match(html, /import-monitor-images-jib\.js --remove --apply --ids=/);
  assert.ok(!/รูปสะอาด \(ไม่มีลายน้ำ\)<\/label>/.test(html));
  // ค่าเริ่มต้นยังเป็นโหมดนำเข้าเหมือนเดิม
  assert.match(buildReviewHtml([{ id: 3, name: 'x', imageFile: '3.jpg' }]), /--apply --ids=/);
});

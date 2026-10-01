import test from 'node:test';
import assert from 'node:assert/strict';
import { extractImageCandidates, imageVariants, isAllowedImageUrl, isUsableImageResponse } from '../scripts/lib/page-image.js';

const BASE = 'https://www.bnn.in.th/en/p/monitor-x_1';
// โครงหน้าที่สร้างขึ้นเอง (ไม่ใช่ HTML ดิบของ Banana) ครอบคลุมรูปแบบที่พบบ่อยของเว็บ Nuxt: data-hid, ลำดับ attribute ต่างกัน, entity, JSON-LD ซ้อน
const HTML = `
<html><head>
<meta data-hid="og:title" property="og:title" content="จอมอนิเตอร์ X">
<meta content="https://media-cdn.bnn.in.th/1001/lg-24mr400-b-1.jpg?v=2&amp;w=1200" data-hid="og:image" property="og:image">
<meta name="twitter:image" content="https://media-cdn.bnn.in.th/1001/lg-twitter.jpg">
<link rel="image_src" href="//media-cdn.bnn.in.th/1001/lg-linksrc.jpg">
<script type="application/ld+json" data-hid="jsonld-product">{"@context":"https://schema.org","@type":"Product","name":"X","image":["https://media-cdn.bnn.in.th/1001/lg-ld-1.jpg","https://media-cdn.bnn.in.th/1001/lg-ld-2.jpg"]}</script>
<script type="application/ld+json">{ this is not json </script>
</head><body>
<img src="/static/logo.png"><img data-src="https://media-cdn.bnn.in.th/1001/lg-body.jpg"><img src="data:image/gif;base64,AAAA">
</body></html>`;

test('extractImageCandidates: og:image first (any attribute order, entities decoded), then twitter, JSON-LD, link, img', () => {
  const urls = extractImageCandidates(HTML, BASE);

  assert.equal(urls[0], 'https://media-cdn.bnn.in.th/1001/lg-24mr400-b-1.jpg?v=2&w=1200');
  assert.deepEqual(urls.slice(1), [
    'https://media-cdn.bnn.in.th/1001/lg-twitter.jpg',
    'https://media-cdn.bnn.in.th/1001/lg-ld-1.jpg',
    'https://media-cdn.bnn.in.th/1001/lg-ld-2.jpg',
    'https://media-cdn.bnn.in.th/1001/lg-linksrc.jpg',
    'https://media-cdn.bnn.in.th/1001/lg-body.jpg'
  ]);
  // โลโก้ในหน้า (/static/logo.png) และ data: URI ไม่เข้ารายการ; JSON-LD ที่พังไม่ทำให้ error
  assert.ok(!urls.some((u) => u.includes('logo.png') || u.startsWith('data:')));
});

test('extractImageCandidates: nested JSON-LD (@graph / ProductGroup variants), relative URLs and empty input', () => {
  const graph = `<script type="application/ld+json">{"@graph":[{"@type":"WebSite"},{"@type":"Product","image":{"url":"/img/a.jpg"}}]}</script>`;
  assert.deepEqual(extractImageCandidates(graph, BASE), ['https://www.bnn.in.th/img/a.jpg']);
  assert.deepEqual(extractImageCandidates('', BASE), []);
  assert.deepEqual(extractImageCandidates(null, BASE), []);
  assert.deepEqual(extractImageCandidates('<html>Loading...</html>', BASE), []);
});

test('isAllowedImageUrl: https bnn.in.th only, no credentials/ports, no placeholders or logos', () => {
  assert.equal(isAllowedImageUrl('https://media-cdn.bnn.in.th/1/a.jpg'), true);
  assert.equal(isAllowedImageUrl('https://www.bnn.in.th/img/a.png'), true);
  for (const bad of [
    'http://media-cdn.bnn.in.th/1/a.jpg',
    'https://evil.example/bnn.in.th/a.jpg',
    'https://bnn.in.th.evil.example/a.jpg',
    'https://notbnn.in.th/a.jpg',
    'https://user:pw@media-cdn.bnn.in.th/a.jpg',
    'https://media-cdn.bnn.in.th:8443/a.jpg',
    'https://media-cdn.bnn.in.th/1/no-image.jpg',
    'https://media-cdn.bnn.in.th/assets/logo.png',
    'javascript:alert(1)',
    `https://media-cdn.bnn.in.th/${'x'.repeat(600)}.jpg`,
    '',
    null
  ]) {
    assert.equal(isAllowedImageUrl(bad), false, String(bad).slice(0, 60));
  }
});

test('imageVariants prefers the square_medium size the project already uses, with the original as the fallback', () => {
  assert.deepEqual(imageVariants('https://media-cdn.bnn.in.th/1001/lg-24mr400-b-1.jpg'), [
    'https://media-cdn.bnn.in.th/1001/lg-24mr400-b-1-square_medium.jpg',
    'https://media-cdn.bnn.in.th/1001/lg-24mr400-b-1.jpg'
  ]);
  assert.deepEqual(imageVariants('https://media-cdn.bnn.in.th/1001/x-1-square_large.png'), [
    'https://media-cdn.bnn.in.th/1001/x-1-square_medium.png',
    'https://media-cdn.bnn.in.th/1001/x-1-square_large.png'
  ]);
  // มีขนาดกลางอยู่แล้ว / URL ที่ไม่ใช่ CDN ของ Banana ไม่ถูกแก้
  assert.deepEqual(imageVariants('https://media-cdn.bnn.in.th/1/x-square_medium.jpg'), ['https://media-cdn.bnn.in.th/1/x-square_medium.jpg']);
  assert.deepEqual(imageVariants('https://www.bnn.in.th/img/a.jpg'), ['https://www.bnn.in.th/img/a.jpg']);
});

test('isUsableImageResponse: must be ok, image/* and not tiny', () => {
  assert.equal(isUsableImageResponse({ ok: true, contentType: 'image/jpeg', contentLength: '48213' }), true);
  assert.equal(isUsableImageResponse({ ok: true, contentType: 'image/webp', contentLength: undefined }), true);
  assert.equal(isUsableImageResponse({ ok: true, contentType: 'image/png', contentLength: '312' }), false);
  assert.equal(isUsableImageResponse({ ok: true, contentType: 'text/html; charset=utf-8', contentLength: '90000' }), false);
  assert.equal(isUsableImageResponse({ ok: false, contentType: 'image/jpeg', contentLength: '90000' }), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommonsSearchUrl, isAllowedCommonsImageUrl, parseCommonsCandidates } from '../scripts/lib/commons-images.js';

const page = (title, over = {}) => ({
  title: `File:${title}`,
  imageinfo: [{
    mime: 'image/jpeg', width: 1600, height: 1200,
    url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${title}`,
    thumburl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${title}/600px-${title}`,
    descriptionurl: `https://commons.wikimedia.org/wiki/File:${title}`,
    extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: '<a href="//x">Jane <b>Doe</b></a>' } },
    ...over
  }]
});

test('buildCommonsSearchUrl asks for file-namespace results with image info and a 600px thumbnail', () => {
  const url = new URL(buildCommonsSearchUrl('computer monitor LCD'));
  assert.equal(url.origin + url.pathname, 'https://commons.wikimedia.org/w/api.php');
  assert.equal(url.searchParams.get('gsrnamespace'), '6');
  assert.equal(url.searchParams.get('generator'), 'search');
  assert.equal(url.searchParams.get('iiurlwidth'), '600');
  assert.match(url.searchParams.get('iiprop'), /extmetadata/);
});

test('parseCommonsCandidates keeps open-licensed monitor photos and reports credit as plain text', () => {
  const list = parseCommonsCandidates({ query: { pages: [page('Dell_LCD_monitor.jpg')] } });

  assert.equal(list.length, 1);
  assert.equal(list[0].title, 'Dell_LCD_monitor.jpg');
  assert.equal(list[0].license, 'CC BY-SA 4.0');
  assert.equal(list[0].credit, 'Jane Doe');
  assert.match(list[0].url, /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\//); // ภาพย่อ ไม่ใช่ไฟล์ต้นฉบับ
});

test('parseCommonsCandidates rejects: non-open licences, wrong mime, tiny images, logos/TVs/laptops, unrelated titles, other hosts', () => {
  const lic = (value) => ({ extmetadata: { LicenseShortName: { value } } });
  const bad = [
    page('Monitor_nc.jpg', lic('CC BY-NC 4.0')),
    page('Monitor_gfdl.jpg', lic('GFDL')),
    page('Monitor_fair.jpg', lic('Fair use')),
    page('Monitor_svg.svg', { mime: 'image/svg+xml' }),
    page('Monitor_small.jpg', { width: 320, height: 240 }),
    page('Monitor_logo.jpg'),
    page('Samsung_TV_screen.jpg'),
    page('Laptop_display.jpg'),
    page('Cat_on_sofa.jpg'),
    page('Monitor_elsewhere.jpg', { thumburl: 'https://evil.example/a.jpg', url: 'https://evil.example/a.jpg' })
  ];
  assert.deepEqual(parseCommonsCandidates({ query: { pages: bad } }), []);

  const good = [page('Public_domain_monitor.jpg', { extmetadata: { LicenseShortName: { value: 'Public domain' } } }), page('CC0_LCD.jpg', { extmetadata: { LicenseShortName: { value: 'CC0' } } })];
  assert.equal(parseCommonsCandidates({ query: { pages: good } }).length, 2);
});

test('parseCommonsCandidates ignores malformed replies and prefers landscape photos', () => {
  assert.deepEqual(parseCommonsCandidates(null), []);
  assert.deepEqual(parseCommonsCandidates({}), []);
  assert.deepEqual(parseCommonsCandidates({ query: { pages: [{ title: 'File:Monitor.jpg' }] } }), []);

  const list = parseCommonsCandidates({ query: { pages: [page('Portrait_monitor.jpg', { width: 1200, height: 3000 }), page('Landscape_monitor.jpg', { width: 1600, height: 1000 })] } });
  assert.deepEqual(list.map((c) => c.title), ['Landscape_monitor.jpg', 'Portrait_monitor.jpg']);
});

test('isAllowedCommonsImageUrl accepts only https upload.wikimedia.org', () => {
  assert.equal(isAllowedCommonsImageUrl('https://upload.wikimedia.org/wikipedia/commons/a/ab/x.jpg'), true);
  for (const bad of ['http://upload.wikimedia.org/a.jpg', 'https://commons.wikimedia.org/a.jpg', 'https://upload.wikimedia.org.evil.example/a.jpg', 'https://user:pw@upload.wikimedia.org/a.jpg', 'https://upload.wikimedia.org:8443/a.jpg', 'javascript:alert(1)', '', null]) {
    assert.equal(isAllowedCommonsImageUrl(bad), false, String(bad));
  }
});

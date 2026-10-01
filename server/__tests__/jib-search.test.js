import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBananaIndex, matchMonitor } from '../scripts/lib/monitor-availability.js';
import { jibResultsToCatalog, jibSearchTerm, matchJibPage, parseJibSearchLinks, slugToName } from '../scripts/lib/jib-search.js';

// ลิงก์จริงที่พบในผลค้นหาเว็บ (jib.co.th) - รูปแบบ readProduct/<id>[/<cateId>]/<slug>
const HTML = `
<a href="/web/product/readProduct/65609/1409/MONITOR--%E0%B8%88%E0%B8%AD%E0%B8%A1%E0%B8%AD%E0%B8%99%E0%B8%B4%E0%B9%80%E0%B8%95%E0%B8%AD%E0%B8%A3%E0%B9%8C--MSI-G255PF-E2---24-5-INCH-RAPID-IPS-FHD-180Hz-AMD-FREESYNC">MSI G255PF E2</a>
<a href="/web/product/readProduct/65609/233/MONITOR--%E0%B8%88%E0%B8%AD%E0%B8%A1%E0%B8%AD%E0%B8%99%E0%B8%B4%E0%B9%80%E0%B8%95%E0%B8%AD%E0%B8%A3%E0%B9%8C--MSI-G255PF-E2---24-5-INCH-RAPID-IPS-FHD-180Hz-AMD-FREESYNC">dup id, other category</a>
<a href="/web/product/readProduct/70001/MONITOR--LG-24MR400-B--23-8-INCH-IPS-FHD-100Hz">LG no cate id</a>
<a href="/web/product/readProduct/70002/2863/MONITOR--LG-27U411B-B--27-INCH-IPS-144Hz">LG 27U411B</a>
<a href="/web/product/readProduct/70003/2863/MONITOR--DAHUA-DHI-LM25-B221B--24-5-INCH-IPS-144Hz">Dahua</a>
<a href="/web/product/readProduct/70004/2863/MONITOR--VIEWSONIC-VP2756-4K--27-INCH-IPS-4K">ViewSonic 4K</a>
`;

test('parseJibSearchLinks reads id, optional category, slug and absolute URL, without duplicate product ids', () => {
  const links = parseJibSearchLinks(HTML);

  assert.deepEqual(links.map((l) => l.productId), ['65609', '70001', '70002', '70003', '70004']);
  assert.equal(links[0].cateId, '1409');
  assert.equal(links[1].cateId, null);
  assert.match(links[0].slug, /^MONITOR--จอมอนิเตอร์--MSI-G255PF-E2/); // ถอดรหัส %E0.. เป็นภาษาไทยแล้ว
  assert.equal(links[1].url, 'https://www.jib.co.th/web/product/readProduct/70001/MONITOR--LG-24MR400-B--23-8-INCH-IPS-FHD-100Hz');
  assert.deepEqual(parseJibSearchLinks(''), []);
  assert.deepEqual(parseJibSearchLinks(null), []);
});

test('slugToName turns hyphenated slugs into space-separated words', () => {
  assert.equal(slugToName('MONITOR--LG-24MR400-B--23-8-INCH'), 'MONITOR LG 24MR400 B 23 8 INCH');
});

test('jibSearchTerm uses the first model code as written, and null when there is no usable code', () => {
  assert.equal(jibSearchTerm('LG 24MR400-B'), '24MR400-B');
  assert.equal(jibSearchTerm('Dahua DHI-LM25-B221B'), 'DHI-LM25-B221B');
  assert.equal(jibSearchTerm('Acer Nitro XV272U W2bmiiprx'), 'XV272U');
  assert.equal(jibSearchTerm('KOORUI 24E3'), null);
});

test('JIB slugs split model codes on hyphens; joining adjacent words still matches them exactly', () => {
  const index = buildBananaIndex(jibResultsToCatalog(parseJibSearchLinks(HTML)), { joinAdjacent: true });
  const match = (name) => matchMonitor({ name, brand: name.split(' ')[0] }, index);

  assert.deepEqual([match('LG 24MR400-B').status, match('LG 24MR400-B').level], ['found', 'exact']);
  assert.equal(match('LG 24MR400-B').matches[0].url.endsWith('MONITOR--LG-24MR400-B--23-8-INCH-IPS-FHD-100Hz'), true);
  assert.deepEqual([match('LG 27U411B-B').status, match('LG 27U411B-B').level], ['found', 'exact']);
  assert.equal(match('MSI G255PF E2').status, 'found');
  assert.deepEqual([match('Dahua DHI-LM25-B221B').status, match('Dahua DHI-LM25-B221B').level], ['found', 'exact']);
});

test('joined words do not create false matches: other models, other brands, and the 2K/4K case', () => {
  const index = buildBananaIndex(jibResultsToCatalog(parseJibSearchLinks(HTML)), { joinAdjacent: true });
  const match = (name) => matchMonitor({ name, brand: name.split(' ')[0] }, index);

  assert.equal(match('Dahua DHI-LM25-B201S').status, 'not_found'); // คนละรุ่นกับ B221B
  assert.equal(match('ViewSonic VP2756-2K').status, 'not_found');   // 2K ไม่ใช่ 4K
  assert.equal(match('Acme 24MR400-B', 'Acme').status, 'not_found'); // แบรนด์ไม่ตรง
  assert.equal(match('MSI G255F').status, 'not_found');              // G255F != G255PF
});

test('matchJibPage: whole-word code match with the same brand; handles short codes and hyphenated slugs', () => {
  const links = parseJibSearchLinks(`
    <a href="/web/product/readProduct/1/9/MONITOR--LG-24MR400-B--23-8-INCH">a</a>
    <a href="/web/product/readProduct/2/9/MONITOR--KOORUI-24E3--23-8-INCH-IPS">b</a>
    <a href="/web/product/readProduct/3/9/MONITOR--KOORUI-24E30--23-8-INCH">c</a>
    <a href="/web/product/readProduct/4/9/MONITOR--VIEWSONIC-VP2756-4K--27-INCH">d</a>
    <a href="/web/product/readProduct/5/9/MONITOR--ACER-V227Q-ABI--21-5-INCH">e</a>`);

  assert.equal(matchJibPage({ name: 'LG 24MR400-B', brand: 'LG' }, links).productId, '1');
  assert.equal(matchJibPage({ name: 'KOORUI 24E3', brand: 'KOORUI' }, links).productId, '2');   // รหัสสั้น: ต้องได้ 24E3 ไม่ใช่ 24E30
  assert.equal(matchJibPage({ name: 'Acer V227Q A', brand: 'Acer' }, links).productId, '5');
  assert.equal(matchJibPage({ name: 'ViewSonic VP2756-2K', brand: 'ViewSonic' }, links), null); // 2K != 4K
  assert.equal(matchJibPage({ name: 'Acme 24E3', brand: 'Acme' }, links), null);                 // แบรนด์ไม่ตรง
  assert.equal(matchJibPage({ name: 'Generic 27 inch monitor', brand: 'Generic' }, links), null);
  assert.equal(matchJibPage(null, links), null);
  assert.equal(matchJibPage({ name: 'LG 24MR400-B', brand: 'LG' }, []), null);
});

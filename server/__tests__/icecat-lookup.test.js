import test from 'node:test';
import assert from 'node:assert/strict';
import { hasContentToken, hasStrongModelCode, icecatBrandCandidates, icecatCodeCandidates, isAllowedIcecatImageUrl, parseIcecatResponse, stripContentToken } from '../scripts/lib/icecat-lookup.js';

test('icecatBrandCandidates: own name first, known Icecat alias after it, nothing for an empty brand', () => {
  assert.deepEqual(icecatBrandCandidates('LG'), ['LG', 'LG Electronics']);
  assert.deepEqual(icecatBrandCandidates('lg'), ['lg', 'LG Electronics']);
  assert.deepEqual(icecatBrandCandidates('MSI'), ['MSI']);
  assert.deepEqual(icecatBrandCandidates(''), []);
  assert.deepEqual(icecatBrandCandidates(null), []);
});

test('icecatCodeCandidates: primary model code as written, then without a colour tail; none when there is no usable code', () => {
  assert.deepEqual(icecatCodeCandidates('LG 27U411B-B'), ['27U411B-B', '27U411B']);
  assert.deepEqual(icecatCodeCandidates('MSI MAG 274QRFW'), ['274QRFW']);
  assert.deepEqual(icecatCodeCandidates('Acer Nitro XV272U W2bmiiprx'), ['XV272U']);
  assert.deepEqual(icecatCodeCandidates('Dahua DHI-LM25-B221B'), ['DHI-LM25-B221B']);
  assert.deepEqual(icecatCodeCandidates('KOORUI 24E3'), []);
  assert.deepEqual(icecatCodeCandidates(''), []);
});

test('parseIcecatResponse: prefers the 500px image and verifies the identity against our model code', () => {
  const hit = parseIcecatResponse({ data: {
    Image: { Pic500x500: 'https://images.icecat.biz/img/norm/medium/1-a.jpg', HighPic: 'https://images.icecat.biz/img/gallery/1-a.jpg' },
    GeneralInfo: { Title: 'LG 27U411B-B 27" IPS 144Hz', BrandPartCode: '27U411B-B.AEU' }
  } }, '27U411B-B');
  assert.deepEqual(hit, { ok: true, imageUrl: 'https://images.icecat.biz/img/norm/medium/1-a.jpg', verified: true });

  // รหัสของเราตัดสีท้าย (27U411B) ยังยืนยันได้จากรหัสชิ้นส่วนที่มีสีต่อท้าย
  assert.equal(parseIcecatResponse({ data: { Image: { HighPic: 'https://images.icecat.biz/x.jpg' }, GeneralInfo: { BrandPartCode: '27U411B-B.AEU' } } }, '27U411B').verified, true);
});

test('parseIcecatResponse: a different product is rejected; missing identity info is accepted but flagged; no image is a miss', () => {
  const other = parseIcecatResponse({ data: { Image: { Pic500x500: 'https://images.icecat.biz/x.jpg' }, GeneralInfo: { Title: 'LG 27GP850-B UltraGear', BrandPartCode: '27GP850-B.AEU' } } }, '27U411B-B');
  assert.equal(other.ok, false);
  assert.equal(other.verified, false);
  assert.match(other.reason, /ไม่ตรง/);

  const noInfo = parseIcecatResponse({ data: { Image: { Pic500x500: 'https://images.icecat.biz/x.jpg' } } }, '27U411B-B');
  assert.deepEqual([noInfo.ok, noInfo.verified], [true, null]);

  assert.deepEqual(parseIcecatResponse({ msg: 'Product not found', data: {} }, '27U411B-B'), { ok: false, reason: 'Product not found' });
  assert.equal(parseIcecatResponse(null, 'X12345').ok, false);
});

test('isAllowedIcecatImageUrl: https icecat.biz only, no placeholders, credentials or ports', () => {
  assert.equal(isAllowedIcecatImageUrl('https://images.icecat.biz/img/norm/medium/1-a.jpg'), true);
  for (const bad of [
    'http://images.icecat.biz/a.jpg',
    'https://icecat.biz.evil.example/a.jpg',
    'https://evil.example/images.icecat.biz/a.jpg',
    'https://user:pw@images.icecat.biz/a.jpg',
    'https://images.icecat.biz:8443/a.jpg',
    'https://images.icecat.biz/img/nophoto.jpg',
    'javascript:alert(1)', '', null
  ]) {
    assert.equal(isAllowedIcecatImageUrl(bad), false, String(bad));
  }
});

test('identity check uses whole model codes: VG27AQ must not accept the image of VG27AQL1A / VG27AQ1A (all three exist in the real DB)', () => {
  const reply = (title, part) => ({ data: { Image: { Pic500x500: 'https://images.icecat.biz/x.jpg' }, GeneralInfo: { Title: title, BrandPartCode: part } } });

  for (const [title, part] of [['ASUS VG27AQL1A TUF Gaming', 'VG27AQL1A'], ['ASUS VG27AQ1A TUF Gaming', '90LM0500-B01370'], ['ASUS TUF Gaming VG27AQ3A', 'VG27AQ3A']]) {
    const result = parseIcecatResponse(reply(title, part), 'VG27AQ');
    assert.equal(result.ok, false, `${title} must be rejected for VG27AQ`);
    assert.equal(result.verified, false);
  }

  // รุ่นเดียวกัน: รหัสตรง / มีรหัสภูมิภาคหรือสีต่อท้ายใน BrandPartCode
  assert.equal(parseIcecatResponse(reply('ASUS TUF Gaming VG27AQ 27 inch', 'VG27AQ'), 'VG27AQ').verified, true);
  assert.equal(parseIcecatResponse(reply('LG 27U411B-B', '27U411B-B.AEU'), '27U411B-B').verified, true);
  assert.equal(parseIcecatResponse(reply('LG monitor', '27U411B-W.AEU'), '27U411B-B').verified, true); // สีต่างกันของรุ่นเดียวกัน
  assert.equal(parseIcecatResponse(reply('LG 27U411 monitor', '27U411'), '27U411B-B').verified, false);
});

test('invisible characters (U+200E) are removed from the code that is sent to Icecat', () => {
  assert.deepEqual(icecatCodeCandidates('Acer Nitro \u200eKG271 M3biip'), ['KG271']);
  assert.deepEqual(icecatCodeCandidates('Acer Nitro KG271 M3biip'), ['KG271']);
});

test('content_token: detected and removed from Icecat image URLs without touching other parts of the URL', () => {
  const withToken = 'https://images.icecat.biz/img/gallery_mediums/289d.jpg?content_token=abc-123';
  assert.equal(hasContentToken(withToken), true);
  assert.equal(stripContentToken(withToken), 'https://images.icecat.biz/img/gallery_mediums/289d.jpg');
  assert.equal(stripContentToken('https://images.icecat.biz/a.jpg?v=2&content_token=abc&w=500'), 'https://images.icecat.biz/a.jpg?v=2&w=500');
  assert.equal(hasContentToken('https://images.icecat.biz/a.jpg'), false);
  assert.equal(stripContentToken('https://images.icecat.biz/a.jpg'), 'https://images.icecat.biz/a.jpg');
  assert.equal(hasContentToken('not a url'), false);
  assert.equal(stripContentToken('not a url'), 'not a url');
});

test('short model codes: only tried when allowed, noise words are skipped, at most 2 candidates', () => {
  assert.deepEqual(icecatCodeCandidates('KOORUI 24E3'), []);
  assert.deepEqual(icecatCodeCandidates('KOORUI 24E3', { allowShort: true }), ['24E3']);
  assert.deepEqual(icecatCodeCandidates('Acer V227Q A', { allowShort: true }), ['V227Q']);
  assert.deepEqual(icecatCodeCandidates('HP M22f 22 inch 144Hz IPS 1080p', { allowShort: true }), ['M22f']);
  assert.deepEqual(icecatCodeCandidates('Generic 27 inch monitor', { allowShort: true }), []);
  assert.equal(icecatCodeCandidates('A1B2C3 D4E5F6 G7H8I9 J1K2L3', { allowShort: true }).length <= 2, true);
  // ชื่อที่มีรหัสหนักแน่นไม่เปลี่ยนพฤติกรรม
  assert.deepEqual(icecatCodeCandidates('LG 27U411B-B', { allowShort: true }), ['27U411B-B', '27U411B']);
  assert.equal(hasStrongModelCode('LG 27U411B-B'), true);
  assert.equal(hasStrongModelCode('KOORUI 24E3'), false);
});

test('short codes are verified by whole-token equality, so 24E3 does not accept 24E30 or 124E3', () => {
  const reply = (title, part) => ({ data: { Image: { Pic500x500: 'https://images.icecat.biz/x.jpg' }, GeneralInfo: { Title: title, BrandPartCode: part } } });

  assert.equal(parseIcecatResponse(reply('KOORUI 24E3 23.8 inch IPS', '24E3'), '24E3').verified, true);
  assert.equal(parseIcecatResponse(reply('KOORUI 24E3-B', '24E3-B.AEU'), '24E3').verified, true);
  assert.equal(parseIcecatResponse(reply('KOORUI 24E30 monitor', '24E30'), '24E3').verified, false);
  assert.equal(parseIcecatResponse(reply('KOORUI 124E3 monitor', '124E3'), '24E3').verified, false);
  // ไม่มีข้อมูลระบุตัวสินค้า -> verified เป็น null (สคริปต์จะไม่ใช้รูปของรหัสสั้น)
  assert.equal(parseIcecatResponse({ data: { Image: { Pic500x500: 'https://images.icecat.biz/x.jpg' } } }, '24E3').verified, null);
});

import { randomBytes } from 'node:crypto';

import { getDatabaseConfig } from '../config/database.js';
import { runMysqlCommand } from './database.service.js';
import { escapeSqlString } from './products.service.js';

export function createBuildSnapshot(payload = {}) {
  const items = normalizeBuildItems(payload.items || []);

  if (!items.length) {
    throw new Error('Build must include at least one item');
  }

  const userId = normalizeUserId(payload.userId);

  return {
    name: String(payload.name || 'Saved SpecCraft Build').trim() || 'Saved SpecCraft Build',
    mode: normalizeMode(payload.mode),
    userId,
    // คนที่จัดสเปคแบบไม่ล็อกอิน (userId = 0) ยังบันทึก/แชร์ลิงก์ได้เหมือนกัน แต่ไม่มี
    // บัญชีมายืนยันความเป็นเจ้าของ เลยแจกโทเค็นลับตัวนี้ให้แทน (คนละอันกับ share_token
    // ที่แจกให้คนอื่นดู) เก็บไว้ในเบราว์เซอร์ฝั่งเจ้าของเท่านั้น ใช้พิสูจน์ตัวตนตอน
    // เปิด/ปิดแชร์หรือแก้ไอเทมทีหลัง - ผู้ใช้ที่ล็อกอินแล้วไม่ต้องใช้อันนี้เลย
    ownerToken: userId ? '' : generateShareToken(),
    total: items.reduce((sum, item) => sum + item.price, 0),
    items,
    // true เฉพาะตอนที่กดปุ่ม "แชร์สเปคนี้แบบลิงก์สาธารณะ" ตรงๆ โดยยังไม่เคยกด
    // "บันทึกสเปค" มาก่อน (ดู shareCurrentCart ใน main.js) - ต้องสร้างแถวใน builds จริง
    // เพื่อให้มี id/share_token ให้แชร์ได้ แต่ผู้ใช้ไม่ได้ตั้งใจจะ "บันทึก" มันเข้าหน้า
    // ประวัติ เลยซ่อนจาก buildListQuery ด้านล่างไว้ (ยังกดแชร์/ยกเลิกแชร์/คัดลอกลิงก์
    // ได้ตามปกติ แค่ไม่โผล่ในหน้า "สเปคที่บันทึกไว้" ของตัวเอง)
    hiddenFromHistory: Boolean(payload.hiddenFromHistory)
  };
}

export async function saveBuild(payload = {}, options = {}) {
  const config = options.config || getDatabaseConfig();
  const runQuery = options.runQuery || ((query) => runMysqlCommand(config, query));
  const snapshot = createBuildSnapshot(payload);
  const query = buildInsertQuery(snapshot);
  const result = await runQuery(query);
  const id = Number(String(result || '').trim().split(/\s+/).pop() || 0);
  const saved = { id, ...snapshot };

  if (!saved.ownerToken) {
    delete saved.ownerToken;
  }

  return saved;
}

export async function listSavedBuilds(options = {}) {
  const config = options.config || getDatabaseConfig();
  const runQuery = options.runQuery || ((query) => runMysqlCommand(config, query));
  const result = await runQuery(buildListQuery(options));

  return JSON.parse(result || '{"builds":[],"total":0,"limit":10,"offset":0}');
}

export async function deleteSavedBuild(buildId, userId, options = {}) {
  const config = options.config || getDatabaseConfig();
  const runQuery = options.runQuery || ((query) => runMysqlCommand(config, query));
  const id = normalizeBuildId(buildId);
  const ownerId = normalizeUserId(userId);

  if (!id || !ownerId) {
    throw new Error('Invalid saved build');
  }

  const result = await runQuery(`
    START TRANSACTION;
    DELETE FROM build_items WHERE build_id = ${id};
    DELETE FROM builds WHERE id = ${id} AND user_id = ${ownerId};
    SELECT ROW_COUNT();
    COMMIT;
  `);
  const deleted = Number(String(result || '').trim().split(/\s+/).pop() || 0);

  if (!deleted) {
    throw new Error('Saved build not found');
  }

  return { id, deleted: true };
}

// แก้รายการสินค้าของ build ที่บันทึกไปแล้วโดยไม่สร้าง build ใหม่ (id/share_token เดิม) -
// ใช้ตอนผู้ใช้แก้ตะกร้าต่อหลังจากที่แชร์ลิงก์ไปแล้ว จะได้ให้ลิงก์เดิมที่ส่งไปแล้วเห็น
// สเปคล่าสุดเสมอ แทนที่จะค้างเป็นภาพนิ่งของตอนที่กดบันทึก/แชร์ครั้งแรก
export async function updateBuildItems(buildId, userId, items, options = {}) {
  const config = options.config || getDatabaseConfig();
  const runQuery = options.runQuery || ((query) => runMysqlCommand(config, query));
  const id = normalizeBuildId(buildId);
  const whereClause = buildOwnerWhereClause(id, { userId, ownerToken: options.ownerToken });

  if (!id || !whereClause) {
    throw new Error('Invalid saved build');
  }

  const normalizedItems = normalizeBuildItems(items || []);

  if (!normalizedItems.length) {
    throw new Error('Build must include at least one item');
  }

  const total = normalizedItems.reduce((sum, item) => sum + item.price, 0);
  const itemRows = normalizedItems.map((item) => `(
    ${id},
    ${item.productId || 'NULL'},
    '${escapeSqlString(item.category)}',
    '${escapeSqlString(item.name)}',
    ${item.price},
    ${item.imageUrl ? `'${escapeSqlString(item.imageUrl)}'` : 'NULL'},
    ${item.productUrl ? `'${escapeSqlString(item.productUrl)}'` : 'NULL'}
  )`).join(',');

  const result = await runQuery(`
    START TRANSACTION;
    UPDATE builds SET total_thb = ${total} WHERE ${whereClause};
    SET @build_update_matched = ROW_COUNT();
    DELETE FROM build_items WHERE build_id = ${id};
    INSERT INTO build_items (build_id, product_id, category, name, price_thb, image_url, product_url)
    VALUES ${itemRows};
    SELECT @build_update_matched;
    COMMIT;
  `);

  const updated = Number(String(result || '').trim().split(/\s+/).pop() || 0);

  if (!updated) {
    throw new Error('Saved build not found');
  }

  return { id, total, items: normalizedItems };
}

// ---- ระบบแชร์สเปคแบบลิงก์สาธารณะ ----
// สเปคหนึ่งอันแชร์ได้ครั้งละ 1 ลิงก์ (ไม่ใช่หลายลิงก์พร้อมกัน) - เก็บโทเค็นไว้ที่
// คอลัมน์ share_token ของตาราง builds เอง (NULL = ยังไม่แชร์) ยกเลิกแชร์แล้วแชร์ใหม่
// จะได้โทเค็นใหม่เสมอ ทำให้ลิงก์เก่าใช้ไม่ได้ทันที - ตั้งใจไม่ใช้ builds.id ตรงๆ เป็น
// ส่วนหนึ่งของลิงก์สาธารณะ เพราะ id เรียงลำดับและเดาได้ (ไล่ url คนอื่นได้) โทเค็นนี้
// สุ่มจาก 18 ไบต์ (144 บิต) เข้ารหัส base64url ซึ่งเดาไม่ได้ในทางปฏิบัติ
export async function enableBuildSharing(buildId, userId, options = {}) {
  const config = options.config || getDatabaseConfig();
  const runQuery = options.runQuery || ((query) => runMysqlCommand(config, query));
  const id = normalizeBuildId(buildId);
  const whereClause = buildOwnerWhereClause(id, { userId, ownerToken: options.ownerToken });

  if (!id || !whereClause) {
    throw new Error('Invalid saved build');
  }

  const token = generateShareToken();
  const result = await runQuery(`
    UPDATE builds SET share_token = '${escapeSqlString(token)}' WHERE ${whereClause};
    SELECT ROW_COUNT();
  `);
  const updated = Number(String(result || '').trim().split(/\s+/).pop() || 0);

  if (!updated) {
    throw new Error('Saved build not found');
  }

  return { id, shareToken: token };
}

export async function disableBuildSharing(buildId, userId, options = {}) {
  const config = options.config || getDatabaseConfig();
  const runQuery = options.runQuery || ((query) => runMysqlCommand(config, query));
  const id = normalizeBuildId(buildId);
  const whereClause = buildOwnerWhereClause(id, { userId, ownerToken: options.ownerToken });

  if (!id || !whereClause) {
    throw new Error('Invalid saved build');
  }

  // ยกเลิกแชร์แล้วลิงก์เดิมใช้ไม่ได้ทันที เลยต้องถอดออกจากคลังสาธารณะไปด้วยในทีเดียว
  // (listed_at = NULL) ไม่งั้นการ์ดในคลังจะค้างชี้ไปที่ลิงก์ที่ตายไปแล้ว
  const result = await runQuery(`
    UPDATE builds SET share_token = NULL, listed_at = NULL WHERE ${whereClause};
    SELECT ROW_COUNT();
  `);
  const updated = Number(String(result || '').trim().split(/\s+/).pop() || 0);

  if (!updated) {
    throw new Error('Saved build not found');
  }

  return { id, shared: false };
}

// ---- ระบบคลังสาธารณะ (public gallery) ----
// แยกอิสระจาก share_token: มีลิงก์แชร์ไม่ได้แปลว่าต้องขึ้นคลังเสมอไป ผู้ใช้เลือกเอง
// ว่าจะ "ลงคลัง" ให้คนอื่นเรียกดูในหน้าคลังสาธารณะได้ด้วยหรือไม่ - แต่ถ้าลงคลังต้องมี
// share_token อยู่เสมอ (การ์ดในคลังต้องมีลิงก์ให้กดเข้าไปดู) เลยสร้างให้อัตโนมัติถ้ายัง
// ไม่เคยแชร์มาก่อน ผู้ใช้ไม่ต้องกดแชร์ลิงก์ก่อนแยกต่างหาก
export async function setBuildListed(buildId, userId, isListed, options = {}) {
  const config = options.config || getDatabaseConfig();
  const runQuery = options.runQuery || ((query) => runMysqlCommand(config, query));
  const id = normalizeBuildId(buildId);
  const whereClause = buildOwnerWhereClause(id, { userId, ownerToken: options.ownerToken });

  if (!id || !whereClause) {
    throw new Error('Invalid saved build');
  }

  // ลงคลังสาธารณะต้องมีบัญชีเสมอ (ต่างจากแชร์ลิงก์เฉยๆ ที่คนไม่ล็อกอินก็ทำได้ผ่าน
  // ownerToken) เพราะการ์ดในคลังตอนนี้โชว์ username ของเจ้าของด้วย (ดู
  // buildGalleryListQuery ด้านล่าง) เลยต้องมีบัญชีจริงมาผูกไว้เสมอ - ถอนออกจากคลัง
  // (isListed = false) ยังทำได้ตามปกติไม่ต้องเช็ค เพราะแค่เอาออก ไม่ได้เปิดเผยอะไรใหม่
  if (isListed && !normalizeUserId(userId)) {
    throw new Error('ต้องเข้าสู่ระบบก่อนจึงจะลงคลังสาธารณะได้');
  }

  if (!isListed) {
    const result = await runQuery(`
      UPDATE builds SET listed_at = NULL WHERE ${whereClause};
      SELECT ROW_COUNT();
    `);
    const updated = Number(String(result || '').trim().split(/\s+/).pop() || 0);

    if (!updated) {
      throw new Error('Saved build not found');
    }

    return { id, listed: false };
  }

  const fallbackToken = generateShareToken();
  const updateResult = await runQuery(`
    UPDATE builds
    SET
      share_token = COALESCE(share_token, '${escapeSqlString(fallbackToken)}'),
      listed_at = NOW()
    WHERE ${whereClause};
    SELECT ROW_COUNT();
  `);
  const updated = Number(String(updateResult || '').trim().split(/\s+/).pop() || 0);

  if (!updated) {
    throw new Error('Saved build not found');
  }

  // แถวมีจริงแน่ๆ (เพิ่งอัปเดตสำเร็จข้างบน) เลยดึง share_token ล่าสุดมาคืนให้ฝั่งหน้าเว็บ
  // ต่อ (เผื่อเป็นกรณีที่เพิ่งสร้าง fallbackToken ให้ใหม่เพราะไม่เคยแชร์มาก่อน)
  const tokenResult = await runQuery(`SELECT share_token FROM builds WHERE ${whereClause};`);
  const shareToken = String(tokenResult || '').trim().split(/\s+/).pop() || '';

  return { id, listed: true, shareToken };
}

// แอดมิน "ถอดสเปคออกจากคลังสาธารณะ" - ทำแบบเดียวกับ setBuildListed(false) ด้านบน
// (แค่ล้าง listed_at ให้เป็น NULL) แต่ตั้งใจไม่เช็คความเป็นเจ้าของเลย (ไม่มี
// buildOwnerWhereClause) เพราะแอดมินต้องถอดสเปคของ "ใครก็ได้" ออกจากหน้า
// "สเปคทั้งหมด" ได้ ไม่ใช่แค่ของตัวเอง - ไม่ได้ลบ build ทิ้งจริง เจ้าของเดิมยังเห็น
// สเปคนี้ในหน้าประวัติของตัวเองได้ตามปกติ แค่ไม่โชว์สาธารณะอีกต่อไป
export async function adminUnlistBuild(buildId, options = {}) {
  const config = options.config || getDatabaseConfig();
  const runQuery = options.runQuery || ((query) => runMysqlCommand(config, query));
  const id = normalizeBuildId(buildId);

  if (!id) {
    throw new Error('Invalid saved build');
  }

  const result = await runQuery(`
    UPDATE builds SET listed_at = NULL WHERE id = ${id};
    SELECT ROW_COUNT();
  `);
  const updated = Number(String(result || '').trim().split(/\s+/).pop() || 0);

  if (!updated) {
    throw new Error('Saved build not found');
  }

  return { id, listed: false };
}

export async function listPublicGalleryBuilds(options = {}) {
  const config = options.config || getDatabaseConfig();
  const runQuery = options.runQuery || ((query) => runMysqlCommand(config, query));
  const result = await runQuery(buildGalleryListQuery(options));

  return JSON.parse(result || '{"builds":[],"total":0,"limit":12,"offset":0}');
}

// เช็คความเป็นเจ้าของ build แถวหนึ่งก่อนแก้ไข รองรับ 2 แบบ: (1) ผู้ใช้ที่ล็อกอินแล้ว
// เช็คด้วย user_id ตรงตัวเหมือนเดิม (2) คนจัดสเปคแบบไม่ล็อกอิน (user_id เป็น NULL)
// เช็คด้วย ownerToken แทน - คืน null ถ้าพิสูจน์ความเป็นเจ้าของไม่ได้เลยสักทาง
function buildOwnerWhereClause(id, auth = {}) {
  const ownerId = normalizeUserId(auth.userId);

  if (ownerId) {
    return `id = ${id} AND user_id = ${ownerId}`;
  }

  const ownerToken = String(auth.ownerToken || '').trim();

  if (!ownerToken) {
    return null;
  }

  return `id = ${id} AND user_id IS NULL AND owner_token = '${escapeSqlString(ownerToken)}'`;
}

// อ่านสเปคจากโทเค็นแชร์แบบสาธารณะ - ไม่เช็ค user_id เลยเพราะจุดประสงค์คือให้คนที่
// ไม่ได้ล็อกอินก็เปิดดูได้ คืนเฉพาะฟิลด์ที่ควรเห็นแบบสาธารณะ (ไม่มี user_id/username
// ของเจ้าของปนมาด้วย) คืน null เมื่อโทเค็นผิดหรือถูกยกเลิกการแชร์ไปแล้ว
export async function getPublicBuildByShareToken(token, options = {}) {
  const config = options.config || getDatabaseConfig();
  const runQuery = options.runQuery || ((query) => runMysqlCommand(config, query));
  const safeToken = String(token || '').trim();

  if (!safeToken) {
    return null;
  }

  const result = await runQuery(buildPublicQuery(safeToken));

  return JSON.parse(result || 'null');
}

function generateShareToken() {
  return randomBytes(18).toString('base64url');
}

function buildPublicQuery(token) {
  return `
    SELECT JSON_OBJECT(
      'id', builds.id,
      'name', builds.name,
      'mode', builds.mode,
      'total', builds.total_thb,
      'createdAt', builds.created_at,
      'items', COALESCE((
        SELECT JSON_ARRAYAGG(JSON_OBJECT(
          'category', build_items.category,
          'name', build_items.name,
          'price', build_items.price_thb,
          'imageUrl', build_items.image_url,
          'productUrl', build_items.product_url
        ))
        FROM build_items
        WHERE build_items.build_id = builds.id
        ORDER BY build_items.id
      ), JSON_ARRAY())
    )
    FROM builds
    WHERE builds.share_token = '${escapeSqlString(token)}';
  `;
}

// รายการสเปคในคลังสาธารณะ - เอาเฉพาะ build ที่ทั้งแชร์ลิงก์อยู่ (share_token ไม่ว่าง)
// และถูกกด "ลงคลัง" ไว้ (listed_at ไม่ว่าง) เท่านั้น เรียงตามเวลาที่ลงคลังล่าสุดก่อน
// ต่างจาก buildPublicQuery ด้านบน (ดูสเปคเดี่ยวจากลิงก์แชร์) ตรงที่การ์ดในคลังนี้
// "ตั้งใจ" โชว์ username ของเจ้าของด้วย (ผู้ใช้ยืนยันแล้วว่าต้องการแบบนี้ ถึงจะ
// เปิดเผยว่าใครแชร์ build ไหนก็ตาม) - เพราะงั้น setBuildListed ด้านบนถึงบังคับว่า
// ต้องมีบัญชี (ล็อกอิน) เท่านั้นถึงจะลงคลังได้ ไม่รองรับ owner_token แบบไม่ล็อกอิน
function buildGalleryListQuery(options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 12, 1), 50);
  const offset = Math.max(Number(options.offset) || 0, 0);
  const whereClause = 'WHERE builds.share_token IS NOT NULL AND builds.listed_at IS NOT NULL';

  return `
    SELECT JSON_OBJECT(
      'builds', COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
        'id', id, 'name', name, 'mode', mode, 'total', total_thb, 'username', username,
        'shareToken', share_token, 'listedAt', listed_at, 'itemCount', item_count, 'categories', categories
      )) FROM (
      SELECT
        builds.id,
        builds.name,
        builds.mode,
        builds.total_thb,
        builds.share_token,
        builds.listed_at,
        users.username,
        COALESCE((SELECT COUNT(*) FROM build_items WHERE build_items.build_id = builds.id), 0) AS item_count,
        COALESCE((
          SELECT JSON_ARRAYAGG(JSON_OBJECT(
            'category', build_items.category,
            'imageUrl', build_items.image_url
          ))
          FROM build_items
          WHERE build_items.build_id = builds.id
          ORDER BY build_items.id
        ), JSON_ARRAY()) AS categories
      FROM builds
      LEFT JOIN users ON users.id = builds.user_id
      ${whereClause}
      ORDER BY builds.listed_at DESC, builds.id DESC
      LIMIT ${limit} OFFSET ${offset}
      ) AS gallery_builds), JSON_ARRAY()),
      'total', (SELECT COUNT(*) FROM builds ${whereClause}),
      'limit', ${limit},
      'offset', ${offset}
    );
  `;
}

function buildInsertQuery(snapshot) {
  const itemRows = snapshot.items.map((item) => `(
    @build_id,
    ${item.productId || 'NULL'},
    '${escapeSqlString(item.category)}',
    '${escapeSqlString(item.name)}',
    ${item.price},
    ${item.imageUrl ? `'${escapeSqlString(item.imageUrl)}'` : 'NULL'},
    ${item.productUrl ? `'${escapeSqlString(item.productUrl)}'` : 'NULL'}
  )`).join(',');

  return `
    START TRANSACTION;
    INSERT INTO builds (user_id, name, mode, total_thb, owner_token, hidden_from_history)
    VALUES (
      ${snapshot.userId || 'NULL'},
      '${escapeSqlString(snapshot.name)}',
      '${escapeSqlString(snapshot.mode)}',
      ${snapshot.total},
      ${snapshot.ownerToken ? `'${escapeSqlString(snapshot.ownerToken)}'` : 'NULL'},
      ${snapshot.hiddenFromHistory ? 1 : 0}
    );

    SET @build_id = LAST_INSERT_ID();

    INSERT INTO build_items (build_id, product_id, category, name, price_thb, image_url, product_url)
    VALUES ${itemRows};

    SELECT @build_id;
    COMMIT;
  `;
}

function buildListQuery(options = {}) {
  const userId = normalizeUserId(options.userId);
  const limit = Math.min(Math.max(Number(options.limit) || 10, 1), 50);
  const offset = Math.max(Number(options.offset) || 0, 0);
  // เอา build ที่สร้างจากปุ่ม "แชร์ลิงก์" ตรงๆ (ยังไม่เคยกด "บันทึกสเปค") ออกจากหน้า
  // ประวัติของตัวเองเสมอ (ดูคอมเมนต์ hiddenFromHistory ใน createBuildSnapshot ด้านบน)
  const whereClause = userId
    ? `WHERE builds.user_id = ${userId} AND builds.hidden_from_history = 0`
    : 'WHERE builds.hidden_from_history = 0';

  return `
    SELECT JSON_OBJECT(
      'builds', COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
        'id', id, 'name', name, 'mode', mode, 'userId', user_id,
        'total', total_thb, 'createdAt', created_at, 'shareToken', share_token,
        'listed', (listed_at IS NOT NULL), 'items', items
      )) FROM (
      SELECT
        builds.id,
        builds.user_id,
        builds.name,
        builds.mode,
        builds.total_thb,
        builds.created_at,
        builds.share_token,
        builds.listed_at,
        COALESCE((
          SELECT JSON_ARRAYAGG(JSON_OBJECT(
            'id', build_items.product_id,
            'productId', build_items.product_id,
            'category', build_items.category,
            'name', build_items.name,
            'price', build_items.price_thb,
            'imageUrl', build_items.image_url,
            'productUrl', build_items.product_url
          ))
          FROM build_items
          WHERE build_items.build_id = builds.id
          ORDER BY build_items.id
        ), JSON_ARRAY()) AS items
      FROM builds
      ${whereClause}
      ORDER BY builds.created_at DESC, builds.id DESC
      LIMIT ${limit} OFFSET ${offset}
      ) AS saved_builds), JSON_ARRAY()),
      'total', (SELECT COUNT(*) FROM builds ${whereClause}),
      'limit', ${limit},
      'offset', ${offset}
    );
  `;
}

export function buildTableSchemaQuery() {
  return `
    CREATE TABLE IF NOT EXISTS builds (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NULL,
      name VARCHAR(255) NOT NULL,
      mode VARCHAR(32) NOT NULL,
      total_thb DECIMAL(12,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    SET @add_user_id_column = (
      SELECT IF(
        COUNT(*) = 0,
        'ALTER TABLE builds ADD COLUMN user_id BIGINT UNSIGNED NULL',
        'SET @noop = 1'
      )
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'builds'
        AND COLUMN_NAME = 'user_id'
    );
    PREPARE add_user_id_statement FROM @add_user_id_column;
    EXECUTE add_user_id_statement;
    DEALLOCATE PREPARE add_user_id_statement;

    SET @add_share_token_column = (
      SELECT IF(
        COUNT(*) = 0,
        'ALTER TABLE builds ADD COLUMN share_token VARCHAR(32) NULL',
        'SET @noop = 1'
      )
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'builds'
        AND COLUMN_NAME = 'share_token'
    );
    PREPARE add_share_token_statement FROM @add_share_token_column;
    EXECUTE add_share_token_statement;
    DEALLOCATE PREPARE add_share_token_statement;

    SET @add_share_token_index = (
      SELECT IF(
        COUNT(*) = 0,
        'ALTER TABLE builds ADD UNIQUE INDEX builds_share_token_idx (share_token)',
        'SET @noop = 1'
      )
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'builds'
        AND INDEX_NAME = 'builds_share_token_idx'
    );
    PREPARE add_share_token_index_statement FROM @add_share_token_index;
    EXECUTE add_share_token_index_statement;
    DEALLOCATE PREPARE add_share_token_index_statement;

    SET @add_owner_token_column = (
      SELECT IF(
        COUNT(*) = 0,
        'ALTER TABLE builds ADD COLUMN owner_token VARCHAR(32) NULL',
        'SET @noop = 1'
      )
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'builds'
        AND COLUMN_NAME = 'owner_token'
    );
    PREPARE add_owner_token_statement FROM @add_owner_token_column;
    EXECUTE add_owner_token_statement;
    DEALLOCATE PREPARE add_owner_token_statement;

    SET @add_listed_at_column = (
      SELECT IF(
        COUNT(*) = 0,
        'ALTER TABLE builds ADD COLUMN listed_at DATETIME NULL',
        'SET @noop = 1'
      )
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'builds'
        AND COLUMN_NAME = 'listed_at'
    );
    PREPARE add_listed_at_statement FROM @add_listed_at_column;
    EXECUTE add_listed_at_statement;
    DEALLOCATE PREPARE add_listed_at_statement;

    -- build ที่สร้างจากปุ่ม "แชร์ลิงก์" ตรงๆ โดยยังไม่เคยกด "บันทึกสเปค" มาก่อน (ดู
    -- hiddenFromHistory ใน createBuildSnapshot ด้านบน) - 0 = โชว์ในหน้าประวัติปกติ
    -- (ค่าเริ่มต้น ครอบคลุมแถวเก่าทั้งหมดที่มีอยู่ก่อนคอลัมน์นี้ด้วย)
    SET @add_hidden_from_history_column = (
      SELECT IF(
        COUNT(*) = 0,
        'ALTER TABLE builds ADD COLUMN hidden_from_history TINYINT(1) NOT NULL DEFAULT 0',
        'SET @noop = 1'
      )
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'builds'
        AND COLUMN_NAME = 'hidden_from_history'
    );
    PREPARE add_hidden_from_history_statement FROM @add_hidden_from_history_column;
    EXECUTE add_hidden_from_history_statement;
    DEALLOCATE PREPARE add_hidden_from_history_statement;

    CREATE TABLE IF NOT EXISTS build_items (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      build_id BIGINT UNSIGNED NOT NULL,
      product_id BIGINT UNSIGNED NULL,
      category VARCHAR(80) NOT NULL,
      name VARCHAR(255) NOT NULL,
      price_thb DECIMAL(12,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX build_items_build_id_idx (build_id)
    );

    SET @add_build_items_image_url_column = (
      SELECT IF(
        COUNT(*) = 0,
        'ALTER TABLE build_items ADD COLUMN image_url VARCHAR(500) NULL',
        'SET @noop = 1'
      )
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'build_items'
        AND COLUMN_NAME = 'image_url'
    );
    PREPARE add_build_items_image_url_statement FROM @add_build_items_image_url_column;
    EXECUTE add_build_items_image_url_statement;
    DEALLOCATE PREPARE add_build_items_image_url_statement;

    SET @add_build_items_product_url_column = (
      SELECT IF(
        COUNT(*) = 0,
        'ALTER TABLE build_items ADD COLUMN product_url VARCHAR(500) NULL',
        'SET @noop = 1'
      )
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'build_items'
        AND COLUMN_NAME = 'product_url'
    );
    PREPARE add_build_items_product_url_statement FROM @add_build_items_product_url_column;
    EXECUTE add_build_items_product_url_statement;
    DEALLOCATE PREPARE add_build_items_product_url_statement;
  `;
}

function normalizeBuildItems(items) {
  return items
    .filter((item) => item && item.category && item.name && Number(item.price || 0) >= 0)
    .map((item) => ({
      productId: Number(item.id || item.productId || 0),
      category: String(item.category),
      name: String(item.name),
      price: Number(item.price || 0),
      imageUrl: String(item.imageUrl || '').trim(),
      productUrl: String(item.productUrl || '').trim()
    }));
}

function normalizeMode(value) {
  const mode = String(value || '').trim();

  if (mode === 'gaming' || mode === 'work' || mode === 'manual') {
    return mode;
  }

  return 'manual';
}

function normalizeUserId(value) {
  const userId = Number(value || 0);

  return Number.isFinite(userId) && userId > 0 ? Math.round(userId) : 0;
}

function normalizeBuildId(value) {
  const id = Number(value || 0);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

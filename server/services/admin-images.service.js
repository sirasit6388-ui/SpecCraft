import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { getDatabaseConfig } from '../config/database.js';
import { runMysqlScalar } from './database.service.js';
import { escapeSqlString } from './products.service.js';

const maxImageBytes = 2 * 1024 * 1024;
const supportedImages = {
  'image/jpeg': { extension: 'jpg', signature: [0xff, 0xd8, 0xff] },
  'image/png': { extension: 'png', signature: [0x89, 0x50, 0x4e, 0x47] },
  'image/webp': { extension: 'webp', signature: [0x52, 0x49, 0x46, 0x46], webp: true }
};
const uploadsDirectory = new URL('../../src/uploads/', import.meta.url);

export async function saveAdminProductImage(payload = {}) {
  const mimeType = String(payload.mimeType || '').toLowerCase();
  const image = supportedImages[mimeType];
  const base64 = String(payload.data || '').replace(/\s/g, '');

  if (!image || !base64 || !/^[a-z0-9+/]+={0,2}$/i.test(base64)) {
    throw new Error('Only PNG, JPEG, or WebP image files are supported');
  }

  const buffer = Buffer.from(base64, 'base64');

  if (!buffer.length || buffer.length > maxImageBytes || !hasSignature(buffer, image)) {
    throw new Error('Image file is invalid or exceeds 2 MB');
  }

  await mkdir(uploadsDirectory, { recursive: true });
  const filename = `${randomUUID()}.${image.extension}`;
  await writeFile(new URL(filename, uploadsDirectory), buffer, { flag: 'wx' });

  return { imageUrl: `/uploads/${filename}` };
}

export async function deleteUnusedProductImage(imageUrl, config = getDatabaseConfig()) {
  const filename = getLocalUploadFilename(imageUrl);

  if (!filename) {
    return { deleted: false };
  }

  const usedCount = Number(await runMysqlScalar(config, `SELECT COUNT(*) FROM products WHERE image_url = '${escapeSqlString(imageUrl)}';`));

  if (usedCount > 0) {
    return { deleted: false };
  }

  try {
    await unlink(new URL(filename, uploadsDirectory));
    return { deleted: true };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { deleted: false };
    }

    throw error;
  }
}

function hasSignature(buffer, image) {
  return image.signature.every((byte, index) => buffer[index] === byte)
    && (!image.webp || buffer.subarray(8, 12).toString('ascii') === 'WEBP');
}

function getLocalUploadFilename(imageUrl) {
  const match = String(imageUrl || '').match(/^\/uploads\/([a-f0-9-]+\.(?:jpe?g|png|webp))$/i);
  return match ? match[1] : '';
}

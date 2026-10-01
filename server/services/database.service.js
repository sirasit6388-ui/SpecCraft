import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getDatabaseConfig } from '../config/database.js';

export async function checkDatabaseConnection(config = getDatabaseConfig()) {
  const productCount = await runMysqlScalar(config, 'SELECT COUNT(*) FROM products;');

  return {
    ok: true,
    database: config.database,
    productCount: Number(productCount)
  };
}

export async function runMysqlScalar(config, query) {
  const credentialsDirectory = await mkdtemp(join(tmpdir(), 'pc-build-mysql-'));
  const credentialsPath = join(credentialsDirectory, 'client.cnf');

  try {
    await writeFile(credentialsPath, createMysqlCredentials(config), { encoding: 'utf8', mode: 0o600 });
    return await runMysqlWithCredentials(config, query, credentialsPath);
  } finally {
    await rm(credentialsDirectory, { force: true, recursive: true });
  }
}

// ส่ง SQL ผ่าน stdin ไม่ใช่ argument บรรทัดคำสั่ง (--execute): Windows จำกัดความยาวบรรทัดคำสั่งราว 32,000 ตัวอักษร
// คำสั่ง INSERT ที่มี JSON ยาวๆ (เช่นตารางสเปคหลายรุ่นในคำสั่งเดียว) จึงพังด้วย "spawn ENAMETOOLONG" ทั้งที่ใช้ได้บน Linux/Mac
// spawnImpl เปิดไว้ให้เทสต์ใส่ตัวปลอมได้
export function runMysqlWithCredentials(config, query, credentialsPath, { spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      `--defaults-extra-file=${credentialsPath}`,
      `--host=${config.host}`,
      `--port=${config.port}`,
      `--user=${config.user}`,
      // ระบุ charset ของไคลเอนต์ชัดเจน: ถ้าไม่ระบุ mysql เลือกจากภาษาของระบบปฏิบัติการ (บนเครื่องที่เป็น latin1
      // ข้อความไทย/อีโมจิ/สัญลักษณ์ เช่น ° ™ µ ที่ส่งไปกับ SQL จะถูกแปลงผิดและเก็บเป็นตัวอักษรเพี้ยนใน JSON)
      '--default-character-set=utf8mb4',
      '--batch',
      '--raw',
      '--skip-column-names',
      config.database
    ];
    const mysql = spawnImpl(config.mysqlBin, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    // ถ้า mysql ปิดตัวก่อนอ่านคำสั่งครบ (เช่นต่อฐานข้อมูลไม่ได้) การเขียน stdin จะเกิด EPIPE ซึ่งไม่ใช่สาเหตุจริง
    // สาเหตุจริงอยู่ใน stderr ที่ handler 'close' ด้านล่างจะรายงานเอง จึงกลืน error ของ stdin ไว้
    mysql.stdin.on('error', () => {});
    mysql.stdin.end(String(query), 'utf8');

    mysql.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    mysql.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    mysql.on('error', reject);
    mysql.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `mysql exited with code ${code}`));
        return;
      }

      resolve(stdout.trim());
    });
  });
}

export function createMysqlCredentials(config) {
  return [
    '[client]',
    `host=${config.host}`,
    `port=${config.port}`,
    `user=${config.user}`,
    `password=${config.password}`,
    `database=${config.database}`
  ].join('\n');
}

export function runMysqlCommand(config, query) {
  return runMysqlScalar(config, query);
}

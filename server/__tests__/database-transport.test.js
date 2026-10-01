import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { runMysqlWithCredentials } from '../services/database.service.js';

const config = { mysqlBin: 'mysql', host: '127.0.0.1', port: 3306, user: 'root', database: 'pc_builder' };

// mysql ปลอม: เก็บ argument และสิ่งที่ถูกเขียนเข้า stdin แล้วตอบผลตามที่กำหนด
function fakeSpawn({ output = '', errorText = '', code = 0, readStdin = true } = {}) {
  const record = { command: null, args: null, options: null, stdin: '' };
  const impl = (command, args, options) => {
    Object.assign(record, { command, args, options });
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();

    if (readStdin) child.stdin.on('data', (chunk) => { record.stdin += chunk; });
    child.stdin.on('end', () => {
      setImmediate(() => {
        if (output) child.stdout.write(output);
        if (errorText) child.stderr.write(errorText);
        child.stdout.end();
        child.stderr.end();
        child.emit('close', code);
      });
    });
    return child;
  };
  return { impl, record };
}

test('the SQL travels over stdin, never in the command line', async () => {
  const { impl, record } = fakeSpawn({ output: '42\n' });
  const result = await runMysqlWithCredentials(config, 'SELECT COUNT(*) FROM products;', '/tmp/x/client.cnf', { spawnImpl: impl });

  assert.equal(result, '42');
  assert.equal(record.stdin, 'SELECT COUNT(*) FROM products;');
  assert.ok(!record.args.includes('--execute'));
  assert.ok(!record.args.some((arg) => arg.includes('SELECT')), 'SQL ต้องไม่อยู่ใน argv');
  assert.ok(record.args.includes('--default-character-set=utf8mb4'));
  assert.equal(record.args.at(-1), 'pc_builder', 'ชื่อฐานข้อมูลเป็น argument สุดท้าย ต่อจากนั้นอ่าน SQL จาก stdin');
});

test('a huge statement (500 KB, far beyond the ~32 KB Windows command-line limit) is delivered intact, with non-ASCII text', async () => {
  const { impl, record } = fakeSpawn();
  const sql = `INSERT INTO t VALUES ('${'ไทย🙂°™µ-'.repeat(60000)}');`;
  assert.ok(Buffer.byteLength(sql) > 500_000);

  await runMysqlWithCredentials(config, sql, '/tmp/x/client.cnf', { spawnImpl: impl });

  assert.equal(record.stdin, sql);
  const argvLength = record.args.join(' ').length;
  assert.ok(argvLength < 500, `argv ต้องสั้น (ได้ ${argvLength} ตัวอักษร)`);
});

test('mysql errors are reported from stderr; a non-zero exit rejects', async () => {
  const { impl } = fakeSpawn({ errorText: "ERROR 1064 (42000): You have an error in your SQL syntax\n", code: 1 });
  await assert.rejects(() => runMysqlWithCredentials(config, 'SELEC 1;', '/tmp/x/client.cnf', { spawnImpl: impl }), /ERROR 1064/);

  const silent = fakeSpawn({ code: 7 });
  await assert.rejects(() => runMysqlWithCredentials(config, 'SELECT 1;', '/tmp/x/client.cnf', { spawnImpl: silent.impl }), /exited with code 7/);
});

test('an EPIPE on stdin (mysql quit early) does not crash; the real cause from stderr is what gets reported', async () => {
  const impl = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    setImmediate(() => {
      child.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
      child.stderr.write("ERROR 2003 (HY000): Can't connect to MySQL server\n");
      child.stdout.end();
      child.stderr.end();
      child.emit('close', 1);
    });
    return child;
  };

  await assert.rejects(() => runMysqlWithCredentials(config, 'SELECT 1;', '/tmp/x/client.cnf', { spawnImpl: impl }), /ERROR 2003/);
});

test('a spawn failure (mysql binary not found) rejects with that error', async () => {
  const impl = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    setImmediate(() => child.emit('error', Object.assign(new Error('spawn mysql ENOENT'), { code: 'ENOENT' })));
    return child;
  };

  await assert.rejects(() => runMysqlWithCredentials(config, 'SELECT 1;', '/tmp/x/client.cnf', { spawnImpl: impl }), /ENOENT/);
});

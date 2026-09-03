import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import {
  configureDatabasePath,
  getDatabase,
  verifyDatabase,
  closeDatabase,
} from '../src/db/database.js';

const KEEP = join(process.cwd(), 'data', 'pawn-time.db');
afterAll(() => {
  configureDatabasePath(KEEP);
  closeDatabase();
});
afterEach(() => {
  console.log('afterEach: not exported db state check');
  configureDatabasePath(KEEP);
  closeDatabase();
  console.log('afterEach done');
});

test('in-memory', () => {
  configureDatabasePath(':memory:');
  getDatabase();
  verifyDatabase();
  console.log('t1 done');
});
test('healthy wal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pawn-db-'));
  const path = join(dir, 'test.db');
  configureDatabasePath(path);
  const db = getDatabase();
  db.pragma('journal_mode = WAL');
  db.prepare('CREATE TABLE t (x INTEGER)').run();
  closeDatabase();
  verifyDatabase();
  console.log('t2 done');
  rmSync(dir, { recursive: true, force: true });
});
test('corrupt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pawn-db-'));
  const path = join(dir, 'corrupt.db');
  writeFileSync(path, 'this is not a sqlite database file\x00\x01\x02');
  configureDatabasePath(path);
  try {
    const db = getDatabase();
    console.log('corrupt getDatabase OK, name:', db.name);
  } catch (e) {
    console.log('corrupt getDatabase threw:', e.message);
  }
  rmSync(dir, { recursive: true, force: true });
});

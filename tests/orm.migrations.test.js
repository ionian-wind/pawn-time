import Database from 'better-sqlite3';
import {
  Migration,
  MigrationRunner,
  defineEntity,
  createSchema,
  diffSchema,
  schemaSnapshot,
  buildMigration,
  renderMigrationFile,
} from '../src/db/orm/index.js';

const Widget = defineEntity({
  name: 'Widget',
  table: 'widgets',
  columns: {
    id: { type: 'text', primaryKey: true },
    label: { type: 'text', index: true },
    count: { type: 'int', default: 0 },
  },
});

const WidgetWithSize = defineEntity({
  name: 'WidgetWithSize',
  table: 'widgets',
  columns: {
    id: { type: 'text', primaryKey: true },
    label: { type: 'text', index: true },
    count: { type: 'int', default: 0 },
    size: { type: 'int', nullable: true },
  },
});

const WidgetNoIndex = defineEntity({
  name: 'WidgetNoIndex',
  table: 'widgets',
  columns: {
    id: { type: 'text', primaryKey: true },
    label: { type: 'text' },
    count: { type: 'int', default: 0 },
  },
});

class CreateWidgets extends Migration {
  constructor() {
    super();
    this.name = 'CreateWidgets';
    this.timestamp = 100;
  }
  up(db) {
    db.exec(`CREATE TABLE widgets (id TEXT PRIMARY KEY, label TEXT)`);
  }
  down(db) {
    db.exec(`DROP TABLE IF EXISTS widgets`);
  }
}

class AddCount extends Migration {
  constructor() {
    super();
    this.name = 'AddCount';
    this.timestamp = 200;
  }
  up(db) {
    db.exec(`ALTER TABLE widgets ADD COLUMN count INTEGER NOT NULL DEFAULT 0`);
  }
  down(db) {
    db.exec(`ALTER TABLE widgets DROP COLUMN count`);
  }
}

describe('orm migration runner', () => {
  let db;
  let runner;
  beforeEach(() => {
    db = new Database(':memory:');
    runner = new MigrationRunner(db);
  });
  afterEach(() => db.close());

  it('creates the migrations meta table lazily', () => {
    expect(runner.applied()).toEqual([]);
    const table = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migrations'`)
      .get();
    expect(table.name).toBe('migrations');
  });

  it('runs pending migrations up and records them', () => {
    const ran = runner.up([new CreateWidgets()]);
    expect(ran).toHaveLength(1);
    expect(runner.applied()).toHaveLength(1);
    const created = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'widgets'`)
      .get();
    expect(created.name).toBe('widgets');
  });

  it('does not re-run already applied migrations', () => {
    runner.up([new CreateWidgets()]);
    expect(runner.up([new CreateWidgets()])).toHaveLength(0);
    expect(runner.applied()).toHaveLength(1);
  });

  it('orders pending migrations by timestamp ascending', () => {
    const ran = runner.up([new AddCount(), new CreateWidgets()]);
    expect(ran.map((m) => m.name)).toEqual(['CreateWidgets', 'AddCount']);
  });

  it('runs each migration in its own transaction and rolls back on failure', () => {
    class Bad extends Migration {
      constructor() {
        super();
        this.name = 'Bad';
        this.timestamp = 300;
      }
      up(db) {
        db.exec(`CREATE TABLE baddata (id TEXT PRIMARY KEY)`);
        throw new Error('boom');
      }
      down(db) {
        db.exec(`DROP TABLE IF EXISTS baddata`);
      }
    }
    expect(() => runner.up([new CreateWidgets(), new Bad()])).toThrow('boom');
    const applied = runner.applied();
    expect(applied).toHaveLength(1);
    expect(applied[0].name).toBe('CreateWidgets');
    // baddata was created inside the failed txn -> rolled back
    const baddata = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'baddata'`)
      .get();
    expect(baddata).toBeUndefined();
    // widgets from the earlier, committed migration survives
    const widgets = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'widgets'`)
      .get();
    expect(widgets.name).toBe('widgets');
  });

  it('reverts the most recent migration down and removes its record', () => {
    runner.up([new CreateWidgets(), new AddCount()]);
    const reverted = runner.down([new CreateWidgets(), new AddCount()]);
    expect(reverted.map((m) => m.name)).toEqual(['AddCount']);
    expect(runner.applied()).toHaveLength(1);
    const countCol = db.pragma('table_info("widgets")').some((c) => c.name === 'count');
    expect(countCol).toBe(false);
  });

  it('reverts multiple steps', () => {
    runner.up([new CreateWidgets(), new AddCount()]);
    const reverted = runner.down([new CreateWidgets(), new AddCount()], 2);
    expect(reverted).toHaveLength(2);
    expect(runner.applied()).toEqual([]);
    expect(
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'widgets'`).get()
    ).toBeUndefined();
  });

  it('down rollback aborts when the migration class is missing', () => {
    class NotRun extends Migration {
      constructor() {
        super();
        this.name = 'Ghost';
        this.timestamp = 400;
      }
    }
    runner.ensureTable();
    runner.up([new CreateWidgets()]);
    expect(() => runner.down([new NotRun()])).toThrow(/No migration class found/);
  });
});

describe('orm migration generator', () => {
  let db;
  beforeEach(() => {
    db = new Database(':memory:');
  });
  afterEach(() => db.close());

  it('produces an empty diff when schema is in sync', () => {
    createSchema(db, [Widget]);
    const diff = diffSchema(db, [Widget]);
    expect(diff.upQueries).toEqual([]);
    expect(diff.downQueries).toEqual([]);
  });

  it('generates CREATE TABLE for brand new entities', () => {
    const diff = diffSchema(db, [Widget]);
    expect(diff.upQueries).toContain(Widget.toCreateTableSql());
    expect(diff.upQueries).toContain(
      `CREATE INDEX IF NOT EXISTS "idx_widgets_label" ON "widgets" ("label")`
    );
    expect(diff.downQueries).toContain(`DROP TABLE IF EXISTS "widgets"`);
  });

  it('applies the generated migration and then reverts it', () => {
    const diff = diffSchema(db, [Widget]);
    const migration = buildMigration(diff, { name: 'MigrateWidgets', timestamp: 1 });
    migration.up(db);
    const after = schemaSnapshot(db);
    expect(after.has('widgets')).toBe(true);
    expect(diffSchema(db, [Widget]).upQueries).toEqual([]);
    migration.down(db);
    expect(
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'widgets'`).get()
    ).toBeUndefined();
  });

  it('detects added columns and builds additive up / drop down', () => {
    createSchema(db, [Widget]);
    const diff = diffSchema(db, [WidgetWithSize]);
    expect(diff.upQueries).toContain(`ALTER TABLE "widgets" ADD COLUMN "size" INTEGER`);
    expect(diff.downQueries).toContain(`ALTER TABLE "widgets" DROP COLUMN "size"`);
    const migration = buildMigration(diff, { name: 'AddSize', timestamp: 2 });
    migration.up(db);
    expect(db.pragma('table_info("widgets")').some((c) => c.name === 'size')).toBe(true);
    migration.down(db);
    expect(db.pragma('table_info("widgets")').some((c) => c.name === 'size')).toBe(false);
  });

  it('detects dropped columns and rebuilds them down', () => {
    createSchema(db, [WidgetWithSize]);
    const diff = diffSchema(db, [Widget]);
    expect(diff.upQueries).toContain(`ALTER TABLE "widgets" DROP COLUMN "size"`);
    const migration = buildMigration(diff, { name: 'DropSize', timestamp: 3 });
    migration.up(db);
    expect(db.pragma('table_info("widgets")').some((c) => c.name === 'size')).toBe(false);
    migration.down(db);
    expect(db.pragma('table_info("widgets")').some((c) => c.name === 'size')).toBe(true);
  });

  it('detects index changes', () => {
    createSchema(db, [Widget]);
    const diff = diffSchema(db, [WidgetNoIndex]);
    expect(diff.upQueries).toContain(`DROP INDEX IF EXISTS "idx_widgets_label"`);
    const migration = buildMigration(diff, { name: 'DropIndex', timestamp: 4 });
    migration.up(db);
    const rowsAfterUp = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'widgets'`)
      .all();
    expect(rowsAfterUp.some((r) => r.name === 'idx_widgets_label')).toBe(false);
    migration.down(db);
    const rowsAfterDown = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'widgets'`)
      .all();
    expect(rowsAfterDown.some((r) => r.name === 'idx_widgets_label')).toBe(true); // re-created
  });

  it('drops tables present in the DB but not in entities', () => {
    db.exec(`CREATE TABLE orphan (id TEXT PRIMARY KEY)`);
    const diff = diffSchema(db, [Widget]);
    expect(diff.upQueries).toContain(`DROP TABLE IF EXISTS "orphan"`);
    expect(diff.downQueries.some((s) => s.includes('CREATE TABLE IF NOT EXISTS "orphan"'))).toBe(
      true
    );
  });

  it('renders an ESM migration file with up/down', () => {
    const diff = diffSchema(db, [Widget]);
    const file = renderMigrationFile(diff, {
      name: 'InitWidgets',
      timestamp: 5,
      importPath: './orm/migrations.js',
    });
    expect(file).toContain(`import { Migration } from './orm/migrations.js';`);
    expect(file).toContain(`export class InitWidgets extends Migration`);
    expect(file).toContain(`this.timestamp = 5;`);
    expect(file).toContain(`up(db) {`);
    expect(file).toContain(`down(db) {`);
    expect(file).toContain('db.exec(`CREATE TABLE');
  });

  it('schemaSnapshot returns columns and indexes', () => {
    createSchema(db, [Widget]);
    const snap = schemaSnapshot(db);
    const table = snap.get('widgets');
    expect(table.columns.some((c) => c.name === 'label')).toBe(true);
    expect(table.indexes.some((i) => i.name === 'idx_widgets_label')).toBe(true);
  });
});

import Database from 'better-sqlite3';
import validator from 'validator';
import {
  defineEntity,
  createSchema,
  Repository,
  createOrm,
  EntityValidationError,
  tableInfo,
} from '../src/db/orm/index.js';

const { isEmail, isInt, isUUID } = validator;

const User = defineEntity({
  name: 'User',
  table: 'users',
  columns: {
    id: { type: 'text', primaryKey: true },
    name: {
      type: 'text',
      nullable: true,
      validate: [(v) => (v == null ? true : validator.isLength(v, { max: 50 }) || 'too long')],
    },
    email: {
      type: 'text',
      unique: true,
      validate: (v) => isEmail(v) || 'must be a valid email',
    },
    age: {
      type: 'int',
      nullable: true,
      validate: [(v) => (v == null ? true : isInt(String(v), { min: 0 }) || 'must be >= 0')],
    },
    isActive: { type: 'boolean', default: true },
    meta: { type: 'json', nullable: true },
  },
  indexes: [{ columns: ['email'] }, { columns: ['isActive', 'age'] }],
  relations: {
    posts: { type: 'hasMany', target: null, foreignKey: 'userId' },
  },
});

const Post = defineEntity({
  name: 'Post',
  table: 'posts',
  columns: {
    id: { type: 'text', primaryKey: true },
    title: { type: 'string' },
    userId: {
      type: 'text',
      references: { table: 'users', column: 'id', onDelete: 'CASCADE' },
      index: true,
    },
    views: { type: 'int', default: 0 },
  },
  relations: {
    author: { type: 'belongsTo', target: User, foreignKey: 'userId' },
  },
});

// set post target after User is defined (forward reference)
User.relations.get('posts').target = Post;

const TaggedItem = defineEntity({
  name: 'TaggedItem',
  table: 'tagged_items',
  softDelete: true,
  columns: {
    id: { type: 'text', primaryKey: true },
    name: { type: 'text' },
  },
});

describe('orm schema', () => {
  let db;
  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
  });
  afterEach(() => {
    db.close();
  });

  it('creates tables with the expected column metadata', () => {
    createSchema(db, [User]);
    const info = tableInfo(db, 'users');
    const byName = Object.fromEntries(info.map((c) => [c.name, c]));
    expect(byName.id.type).toBe('TEXT');
    expect(byName.id.pk).toBe(1);
    expect(byName.id.notnull).toBe(1);
    expect(byName.is_active.type).toBe('INTEGER');
    expect(byName.meta.type).toBe('TEXT');
    expect(byName.name.notnull).toBe(0);
  });

  it('creates indexes from column flags and composite definitions', () => {
    createSchema(db, [User]);
    const indexes = db
      .prepare(`SELECT * FROM sqlite_master WHERE type = 'index' AND tbl_name = 'users'`)
      .all();
    const names = indexes.map((i) => i.name);
    expect(names).toContain('idx_users_email');
    expect(names).toContain('idx_users_is_active_age');
  });

  it('applies UNIQUE constraint', () => {
    createSchema(db, [User]);
    const users = new Repository(User, db);
    users.create({ email: 'a@b.co' });
    expect(() => users.create({ email: 'a@b.co' })).toThrow();
  });

  it('is idempotent across repeated calls', () => {
    createSchema(db, [User]);
    createSchema(db, [User]);
    const users = new Repository(User, db);
    expect(() => users.create({ email: 'x@y.zo' })).not.toThrow();
  });
});

describe('orm create / read', () => {
  let db;
  let users;
  beforeEach(() => {
    db = new Database(':memory:');
    users = new Repository(User, db);
    createSchema(db, [User]);
  });
  afterEach(() => db.close());

  it('auto-generates a uuid pk and timestamps, applies defaults, maps fields', () => {
    const user = users.create({ email: 'alice@example.com' });
    expect(isUUID(user.id, 4)).toBe(true);
    expect(user.isActive).toBe(true);
    expect(user.createdAt).toEqual(expect.any(String));
    expect(user.updatedAt).toEqual(expect.any(String));
    expect(users.findByPk(user.id).email).toBe('alice@example.com');
  });

  it('serializes/deserializes json and boolean columns', () => {
    const user = users.create({ email: 'b@example.com', meta: { theme: 'dark' } });
    const raw = db.prepare('SELECT meta, is_active FROM users WHERE id = ?').get(user.id);
    expect(JSON.parse(raw.meta)).toEqual({ theme: 'dark' });
    expect(raw.is_active).toBe(1);
    const loaded = users.findByPk(user.id);
    expect(loaded.meta).toEqual({ theme: 'dark' });
    expect(loaded.isActive).toBe(true);
  });

  it('uses the repo primary key in findByPk/update/delete', () => {
    const user = users.create({ email: 'c@example.com' });
    expect(users.findByPk(user.id).email).toBe('c@example.com');
    expect(users.findByPk('missing')).toBeNull();
  });
});

describe('orm validation', () => {
  let db;
  let users;
  beforeEach(() => {
    db = new Database(':memory:');
    users = new Repository(User, db);
    createSchema(db, [User]);
  });
  afterEach(() => db.close());

  it('rejects invalid values with EntityValidationError', () => {
    expect(() => users.create({ email: 'not-an-email' })).toThrow(EntityValidationError);
    try {
      users.create({ email: 'bad', name: 'x'.repeat(51), age: -5 });
    } catch (err) {
      expect(err.errors.email).toBeDefined();
      expect(err.errors.name).toBeDefined();
      expect(err.errors.age).toBeDefined();
    }
  });

  it('allows null for nullable validated columns', () => {
    const user = users.create({ email: 'ok@example.com', age: null, name: null });
    expect(user.age).toBeNull();
  });

  it('rejects invalid values on update too', () => {
    const user = users.create({ email: 'ok2@example.com' });
    expect(() => users.update(user.id, { email: 'nope' })).toThrow(EntityValidationError);
    expect(users.findByPk(user.id).email).toBe('ok2@example.com');
  });
});

describe('orm queries', () => {
  let db;
  let users;
  beforeEach(() => {
    db = new Database(':memory:');
    users = new Repository(User, db);
    createSchema(db, [User]);
    const seed = [
      { email: 'alice@example.com', age: 30, name: 'Alice' },
      { email: 'bob@example.com', age: 25, name: 'Bob' },
      { email: 'carol@example.com', age: 40, name: 'Carol' },
      { email: 'dave@example.com', age: 18, name: 'Dave' },
    ];
    for (const s of seed) users.create(s);
  });
  afterEach(() => db.close());

  it('finds by simple equality', () => {
    const found = users.findMany({ where: { name: 'Alice' } });
    expect(found).toHaveLength(1);
    expect(found[0].email).toBe('alice@example.com');
  });

  it('supports comparison operators', () => {
    const found = users.findMany({ where: { age: { gte: 30, lt: 40 } } });
    expect(found.map((u) => u.name).sort()).toEqual(['Alice', 'Carol']);
  });

  it('supports in / between / like operators', () => {
    const inQ = users.findMany({ where: { name: { in: ['Alice', 'Bob'] } } });
    expect(inQ).toHaveLength(2);
    const between = users.findMany({ where: { age: { between: [25, 40] } } });
    expect(between).toHaveLength(3);
    const like = users.findMany({ where: { email: { like: '%carol%' } } });
    expect(like[0].name).toBe('Carol');
  });

  it('orders, limits, and offsets', () => {
    const page = users.findMany({
      orderBy: { age: 'desc' },
      limit: 2,
      offset: 1,
    });
    expect(page.map((u) => u.age)).toEqual([30, 25]);
  });

  it('orders by multiple fields', () => {
    const all = users.findMany({ orderBy: [{ age: 'desc' }, { name: 'asc' }] });
    expect(all[0].name).toBe('Carol');
  });

  it('counts matching rows', () => {
    expect(users.count()).toBe(4);
    expect(users.count({ age: { gte: 30 } })).toBe(2);
  });

  it('throws on unknown fields', () => {
    expect(() => users.findMany({ where: { nope: 1 } })).toThrow(/Unknown field/);
  });
});

describe('orm update / delete / transaction', () => {
  let db;
  let users;
  beforeEach(() => {
    db = new Database(':memory:');
    users = new Repository(User, db);
    createSchema(db, [User]);
  });
  afterEach(() => db.close());

  it('updates a subset of fields and bumps updatedAt', () => {
    const user = users.create({ email: 'a@example.com' });
    const before = user.updatedAt;
    const updated = users.update(user.id, { name: 'Updated' });
    expect(updated.name).toBe('Updated');
    expect(updated.email).toBe('a@example.com');
    expect(updated.updatedAt >= before).toBe(true);
  });

  it('returns null for update of missing row', () => {
    expect(users.update('nope', { name: 'x' })).toBeNull();
  });

  it('hard-deletes rows', () => {
    const user = users.create({ email: 'del@example.com' });
    expect(users.delete(user.id)).toBe(true);
    expect(users.findByPk(user.id)).toBeNull();
    expect(users.delete('nope')).toBe(false);
  });

  it('commits and rolls back transactions', () => {
    users.transaction(() => {
      users.create({ email: 'tx@example.com' });
    });
    expect(() =>
      users.transaction(() => {
        users.create({ email: 'tx2@example.com' });
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(users.count()).toBe(1);
  });
});

describe('orm relations / eager loading', () => {
  let db;
  let users;
  let posts;
  beforeEach(() => {
    db = new Database(':memory:');
    users = new Repository(User, db);
    posts = new Repository(Post, db);
    createSchema(db, [User, Post]);
  });
  afterEach(() => db.close());

  it('eager-loads hasMany relations', () => {
    const u1 = users.create({ email: 'u1@example.com' });
    const u2 = users.create({ email: 'u2@example.com' });
    posts.create({ title: 'P1', userId: u1.id });
    posts.create({ title: 'P2', userId: u1.id });
    posts.create({ title: 'P3', userId: u2.id });

    const all = users.findMany({ orderBy: { email: 'asc' }, include: ['posts'] });
    expect(all).toHaveLength(2);
    const byEmail = Object.fromEntries(all.map((u) => [u.email, u]));
    expect(byEmail['u1@example.com'].posts).toHaveLength(2);
    expect(byEmail['u1@example.com'].posts.map((p) => p.title).sort()).toEqual(['P1', 'P2']);
    expect(byEmail['u2@example.com'].posts).toHaveLength(1);
  });

  it('eager-loads belongsTo relations', () => {
    const u1 = users.create({ email: 'writer@example.com' });
    posts.create({ title: 'A', userId: u1.id });
    const withAuthor = posts.findMany({ include: ['author'] });
    expect(withAuthor[0].author.email).toBe('writer@example.com');
    expect(withAuthor[0].author.id).toBe(u1.id);
  });

  it('eager-loads nested relations (posts.author)', () => {
    const u1 = users.create({ email: 'nested@example.com' });
    const p = posts.create({ title: 'N', userId: u1.id });
    // post -> author belongsTo nested inside user.posts
    const all = users.findMany({ include: ['posts.author'] });
    expect(all[0].posts[0].author.email).toBe('nested@example.com');
    expect(p.id).toBeTruthy();
  });

  it('on delete cascade removes related posts', () => {
    const u1 = users.create({ email: 'cascade@example.com' });
    posts.create({ title: 'X', userId: u1.id });
    users.delete(u1.id);
    expect(posts.count({ userId: u1.id })).toBe(0);
  });
});

describe('orm soft delete', () => {
  let db;
  let items;
  beforeEach(() => {
    db = new Database(':memory:');
    items = new Repository(TaggedItem, db);
    createSchema(db, [TaggedItem]);
  });
  afterEach(() => db.close());

  it('soft-deletes by setting deleted_at and excludes from queries', () => {
    const a = items.create({ name: 'A' });
    const b = items.create({ name: 'B' });
    expect(items.delete(a.id)).toBe(true);
    expect(items.findByPk(a.id)).toBeNull();
    expect(items.findMany()).toHaveLength(1);
    expect(items.count()).toBe(1);
    expect(items.count({}, { includeDeleted: true })).toBe(2);
    expect(items.findMany({ includeDeleted: true })).toHaveLength(2);
    expect(items.findByPk(b.id).name).toBe('B');
  });
});

describe('orm createOrm helper', () => {
  it('creates schema and repositories keyed by entity name', () => {
    const db = new Database(':memory:');
    const orm = createOrm(db, { User, Post });
    const u = orm.repositories.User.create({ email: 'orm@example.com' });
    orm.repositories.Post.create({ title: 'Hello', userId: u.id });
    const list = orm.repositories.Post.findMany({ include: ['author'] });
    expect(list[0].author.email).toBe('orm@example.com');
    db.close();
  });
});

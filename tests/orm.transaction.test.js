import Database from 'better-sqlite3';
import {
  defineEntity,
  createSchema,
  Repository,
  Transaction,
  withTransaction,
  transactionFor,
  createOrm,
} from '../src/db/orm/index.js';

const User = defineEntity({
  name: 'User',
  table: 'users',
  columns: {
    id: { type: 'text', primaryKey: true },
    email: { type: 'text' },
  },
});

describe('orm transactions', () => {
  let db;
  let users;
  beforeEach(() => {
    db = new Database(':memory:');
    users = new Repository(User, db);
    createSchema(db, [User]);
  });
  afterEach(() => db.close());

  it('commits work performed inside withTransaction', () => {
    withTransaction(db, () => {
      users.create({ email: 'a@example.com' });
    });
    expect(users.count()).toBe(1);
  });

  it('rolls back all work when the transaction throws', () => {
    expect(() =>
      withTransaction(db, () => {
        users.create({ email: 'a@example.com' });
        users.create({ email: 'b@example.com' });
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(users.count()).toBe(0);
  });

  it('supports nested transactions via savepoints', () => {
    const tx = transactionFor(db);
    tx.run(() => {
      users.create({ email: 'outer@example.com' });
      tx.run(() => {
        users.create({ email: 'inner@example.com' });
      });
      expect(tx.inTransaction()).toBe(true);
    });
    expect(users.count()).toBe(2);
  });

  it('inner rollback undoes only the inner block', () => {
    const tx = transactionFor(db);
    tx.run(() => {
      users.create({ email: 'outer@example.com' });
      expect(() =>
        tx.run(() => {
          users.create({ email: 'inner@example.com' });
          throw new Error('inner boom');
        })
      ).toThrow('inner boom');
      const outer = users.findMany();
      expect(outer).toHaveLength(1);
    });
    expect(users.count()).toBe(1);
  });

  it('top-level rollback undoes everything including committed savepoints', () => {
    const tx = transactionFor(db);
    expect(() =>
      tx.run(() => {
        users.create({ email: 'a@example.com' });
        tx.run(() => {
          users.create({ email: 'b@example.com' });
        });
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(users.count()).toBe(0);
  });

  it('Repository.transaction supports nesting', () => {
    users.transaction(() => {
      users.create({ email: 'r1@example.com' });
      users.transaction(() => {
        users.create({ email: 'r2@example.com' });
      });
    });
    expect(users.count()).toBe(2);
  });

  it('error messages about begin/commit misuse', () => {
    const tx = transactionFor(db);
    expect(() => tx.commit()).toThrow(/commit without a transaction/);
    expect(() => tx.rollback()).toThrow(/rollback without a transaction/);
  });

  it('Transaction via class instance with explicit begin/commit', () => {
    const tx = new Transaction(db);
    tx.begin();
    users.create({ email: 'explicit@example.com' });
    tx.commit();
    expect(users.count()).toBe(1);
  });

  it('createOrm exposes a transaction() that nests with repo.transaction', () => {
    const orm = createOrm(db, { User });
    orm.transaction(() => {
      orm.repositories.User.create({ email: 'orm@example.com' });
      orm.repositories.User.transaction(() => {
        orm.repositories.User.create({ email: 'orm2@example.com' });
      });
    });
    expect(orm.repositories.User.count()).toBe(2);
  });
});

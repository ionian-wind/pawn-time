import { createSchema } from './schema.js';
import { Repository } from './repository.js';
import { withTransaction } from './transaction.js';
export { defineEntity, toSnake, buildColumnSql } from './entity.js';
export { createSchema, dropSchema, tableInfo } from './schema.js';
export { buildWhere, buildWhereIn, buildOrderBy, buildLimitOffset } from './query.js';
export { Repository } from './repository.js';
export { EntityValidationError } from './errors.js';
export { types, typeFor } from './types.js';
export { Transaction, withTransaction, transactionFor } from './transaction.js';
export { Migration, MigrationRunner } from './migrations.js';
export {
  diffSchema,
  schemaSnapshot,
  buildMigration,
  renderMigrationFile,
} from './migration-generator.js';

export { default as Database } from 'better-sqlite3';

/**
 * Convenience helper: builds a schema from a set of entity definitions (and
 * creates the tables/indexes) then returns a repository instance per entity
 * keyed by name.
 * @example
 * const orm = createOrm(new Database(':memory:'), { User, Post });
 * orm.users.create({ email: 'a@b.c' });
 * orm.users.findMany({ include: ['posts'] });
 * @param {import('better-sqlite3').Database} db
 * @param {Record<string, import('./entity.js').EntityDescriptor>} entities - object of {Name: entity}
 * @returns {{ db: import('better-sqlite3').Database, repositories: Record<string, Repository>, repo: (e: import('./entity.js').EntityDescriptor) => Repository }}
 */
export function createOrm(db, entities) {
  const descriptors = Object.values(entities);
  createSchema(db, descriptors);

  /** @type {Record<string, Repository>} */
  const repositories = {};
  for (const entity of descriptors) {
    repositories[entity.name] = new Repository(entity, db);
  }

  return {
    db,
    repositories,
    /**
     * Runs `fn` inside a (possibly nested) transaction.
     * @param fn
     */
    transaction(fn) {
      return withTransaction(db, () => fn());
    },
    repo(entity) {
      const key = Object.keys(entities).find((k) => entities[k] === entity);
      return key ? repositories[key] : new Repository(entity, db);
    },
  };
}

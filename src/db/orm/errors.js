/**
 * Thrown when entity input fails field-level validation before any write.
 */
export class EntityValidationError extends Error {
  /**
   * @param {Record<string, string>} errors - field -> message map
   * @param {string} [entityName]
   */
  constructor(errors, entityName = 'entity') {
    super(`${entityName} validation failed`);
    this.name = 'EntityValidationError';
    /** @type {Record<string, string>} */
    this.errors = errors;
    /** @type {string} */
    this.entityName = entityName;
  }
}

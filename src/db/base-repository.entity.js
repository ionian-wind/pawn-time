/**
 * @typedef {Object} ColumnConfig
 * @property {string} field - camelCase field on the input/entity object
 * @property {string} column - snake_case database column name
 * @property {'bool'} [type] - optional value coercion (booleans to 1/0)
 * @property {*} [insertDefault] - value used on create when the field is undefined
 */

export {};

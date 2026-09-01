import js from '@eslint/js';
import globals from 'globals';
import eslintConfigPrettier from 'eslint-config-prettier';
import jsdoc from 'eslint-plugin-jsdoc';

export default [
  {
    ignores: ['node_modules/**', 'data/**', 'coverage/**'],
  },
  js.configs.recommended,
  jsdoc.configs['flat/recommended'],
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
  },
  eslintConfigPrettier,
];

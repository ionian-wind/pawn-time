import js from '@eslint/js';
import globals from 'globals';
import eslintConfigPrettier from 'eslint-config-prettier';
import eslintPluginPrettier from 'eslint-plugin-prettier';
import jsdoc from 'eslint-plugin-jsdoc';
import eslintPluginPromise from 'eslint-plugin-promise';

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
  {
    name: 'pawn-time/base',
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    plugins: {
      promise: eslintPluginPromise,
      prettier: eslintPluginPrettier,
    },
  },
  {
    name: 'pawn-time/ignores',
    ignores: ['eslint.config.js'],
  },
];

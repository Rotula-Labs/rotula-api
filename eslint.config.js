const js = require('@typescript-eslint/eslint-plugin');
const tsEslint = require('@typescript-eslint/eslint-plugin');

module.exports = [
  {
    ignores: ['node_modules/**', 'dist/**', 'coverage/**'],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsEslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    plugins: {
      '@typescript-eslint': js,
    },
    rules: {
      'no-console': 'error',
    },
  },
  {
    files: ['src/services/observability.service.ts', 'src/config/env.ts'],
    rules: {
      'no-console': 'off',
    },
  },
];

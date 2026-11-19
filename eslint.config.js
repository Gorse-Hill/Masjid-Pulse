import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'android-tv/**',
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'public/tv/app.js',
      'data/**',
      'android-tv/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['public/**/*.js', 'src/tv/**/*.js'],
    languageOptions: { sourceType: 'module', globals: { ...globals.browser, ...globals.serviceworker } },
  },
);

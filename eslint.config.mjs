// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    // CLI scripts and tests may print progress (never secrets or connection strings).
    files: ['scripts/**/*.ts', 'test/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.mjs', '**/*.cjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
  {
    // These are executable Node 24 CommonJS tools, rather than TypeScript modules.
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: Object.fromEntries([
        'require', 'module', 'exports', '__dirname', '__filename', 'Buffer',
        'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
        'AbortController', 'fetch', 'TextDecoder', 'URL', 'Event',
      ].map(name => [name, 'readonly'])),
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import i18next from 'eslint-plugin-i18next';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Allow unused vars prefixed with _
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Allow any in specific cases (can tighten later)
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // i18n guard: flag hardcoded user-facing JSX text. The plugin's default only
    // checks plain text in JSX markup. Kept at "warn" during the string
    // migration; flipped to "error" in the i18n finalization task.
    files: ['src/**/*.tsx'],
    ignores: ['src/test/**'],
    plugins: { i18next },
    rules: {
      'i18next/no-literal-string': 'warn',
    },
  },
  {
    ignores: ['dist/', 'node_modules/', '*.config.js', '*.config.ts'],
  }
);

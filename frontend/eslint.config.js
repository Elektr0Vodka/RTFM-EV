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
    // i18n guard: fail the build on hardcoded user-facing JSX text so new strings
    // must go through t(). The plugin's default only checks plain text in JSX
    // markup. Intentional non-translatables (brand wordmarks, <code> tokens,
    // unit suffixes, the ThemePreview style-reference panel) carry targeted
    // eslint-disable comments at their call sites.
    files: ['src/**/*.tsx'],
    // Exclude tests and the vendored shadcn/ui primitives (their sr-only labels
    // stay close to upstream and are not part of the app's translatable copy).
    ignores: ['src/test/**', 'src/components/ui/**'],
    plugins: { i18next },
    rules: {
      'i18next/no-literal-string': 'error',
    },
  },
  {
    ignores: ['dist/', 'node_modules/', '*.config.js', '*.config.ts'],
  }
);

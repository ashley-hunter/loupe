import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Lint rules.
 *
 * The complexity limits are the point of this file. Everything that made this
 * codebase hard to get right — the invalidation classifier, the cost formula,
 * the parser — got easier to check the moment each piece stayed small enough to
 * read in one go. These thresholds are set at roughly where the existing code
 * sits, so they hold the line rather than demanding a refactor.
 */
export default tseslint.config(
  // scripts/ is plain JS run by node directly, outside the app's tsconfig, so the
  // type-aware rules have no project to resolve it against.
  { ignores: ['dist/**', 'release/**', 'build/**', 'node_modules/**', 'scripts/**'] },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // --- Complexity: the rules this config exists for ---------------------
      // Set where this codebase actually sits, so the rule holds the line rather
      // than demanding a refactor. The one genuine outlier is exempted by name
      // at its definition, with a reason.
      complexity: ['error', { max: 15 }],
      'max-depth': ['error', 4],
      'max-params': ['error', 4],
      'max-lines-per-function': ['error', { max: 120, skipBlankLines: true, skipComments: true }],
      'max-nested-callbacks': ['error', 3],

      // --- Correctness the type checker does not cover ----------------------
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],

      // --- Deliberate relaxations -------------------------------------------
      // Bracket access is how env vars and dataset are written, and TypeScript
      // requires it under noPropertyAccessFromIndexSignature if that is ever set.
      '@typescript-eslint/dot-notation': 'off',
      // `Array<T>` reads better than `T[]` for the longer element types here.
      '@typescript-eslint/array-type': 'off',
      // Non-null assertions are used where an index is provably in range, which
      // the compiler cannot see but noUncheckedIndexedAccess demands be handled.
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Template literals with numbers are how every figure on screen is built.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },

  {
    files: ['src/main/index.ts'],
    rules: {
      // The main process logs to the terminal; that is its only output channel.
      'no-console': 'off',
    },
  },

  {
    files: ['src/renderer/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Advisory. Every case here sets state from a subscription or a stored
      // preference on mount, which is what effects are for.
      'react-hooks/set-state-in-effect': 'warn',
      // Screens are long, and branch, because they are mostly markup. Neither is
      // the kind of complexity these limits exist to catch.
      'max-lines-per-function': 'off',
      complexity: ['error', { max: 24 }],
    },
  },

  {
    files: ['test/**/*.ts'],
    rules: {
      // Fixtures assert on shapes the compiler cannot narrow.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      'max-lines-per-function': 'off',
    },
  },

  {
    files: ['src/main/preload.cjs'],
    rules: {
      // Electron preload scripts must be CommonJS; there is no ESM option here.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  {
    files: ['**/*.cjs', '*.config.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: { ...globals.node, require: 'readonly', module: 'writable' } },
  },
);

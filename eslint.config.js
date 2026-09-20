import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * ESLint 9 flat config.
 * Sira onemli: once temel oneriler, sonra tip bilgili TS kurallari,
 * en sonda eslint-config-prettier (bicimlendirme kurallarini kapatir).
 */

/** Tip bilgisi gerektirmeyen dosyalar (config/araci dosyalari). */
const NON_TYPED_FILES = ['**/*.js', '**/*.cjs', '**/*.mjs', '**/*.config.ts', '**/*.config.mts'];

/** console kullanimi serbest olan dosyalar: testler ve calistirilabilir betikler. */
const CONSOLE_ALLOWED_FILES = [
  '**/test/**/*.ts',
  '**/tests/**/*.ts',
  '**/*.spec.ts',
  '**/*.test.ts',
  'scripts/**/*.{ts,js,mjs}',
  '**/scripts/**/*.{ts,js,mjs}',
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      'packages/proto/gen/**',
      '**/coverage/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    name: 'getir/typescript',
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      // Yapilandirilmis log zorunlu (@getir/observability); ham console yasak.
      'no-console': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },

  {
    name: 'getir/js-and-config-files',
    files: NON_TYPED_FILES,
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { ...globals.node },
      // Bu dosyalar hicbir tsconfig projesine dahil degil; tip servisi kapali.
      parserOptions: { projectService: false, project: false, program: null },
    },
    rules: {
      'no-console': 'off',
    },
  },

  {
    name: 'getir/tests-and-scripts',
    files: CONSOLE_ALLOWED_FILES,
    rules: {
      'no-console': 'off',
    },
  },

  prettier,
);

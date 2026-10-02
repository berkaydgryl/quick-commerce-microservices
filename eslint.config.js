import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';

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
    // Tarayici kodu: Node globals'i yerine tarayicininkiler; process/Buffer gibi
    // Node API'leri burada tanimsiz sayilir. Hook kurallari React'in sartidir.
    name: 'getir/web-browser',
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
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

  {
    // #51: surucu (7.6 ve 7.7) toplu yazimin seceneklerini iki kez cozer; tutamaktan
    // miras alinan islem suresini sureli transaction'in icinde reddeder ve yazim
    // INTERNAL duser. Repository toplu yazimi mongo-kit'in bulkCollection()'i ile yapar.
    name: 'getir/mongo-bulk-writes',
    files: ['apps/*/src/**/*.ts', 'packages/*/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression > MemberExpression[property.name=/^(insertMany|bulkWrite)$/][object.type='MemberExpression'][object.property.name='collection']",
          message:
            'Toplu yazim this.bulkCollection(options) ile yapilir (#51): surucu sureli transaction icinde miras alinan timeoutMS ile insertMany/bulkWrite yi reddeder.',
        },
      ],
    },
  },

  {
    // Mongo imajinin ilk acilista mongosh ile calistirdigi betikler (D14):
    // kabugun kendi globalleri vardir (process Node'dan gelir).
    name: 'getir/mongosh-scripts',
    files: ['infra/docker/mongo/**/*.js'],
    languageOptions: {
      globals: { db: 'readonly', print: 'readonly' },
    },
  },

  prettier,
);

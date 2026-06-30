import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default tseslint.config(
  // 린트 제외 대상(빌드/커버리지 산출물)
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // _ 접두사는 의도적 미사용으로 허용
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Tone v15 등 외부 타이핑 한계로 불가피한 any는 경고로(차단하지 않음)
      '@typescript-eslint/no-explicit-any': 'warn',
      // 의도적 빈 catch(예: jsdom 미지원 API) 허용
      'no-empty': ['error', { allowEmptyCatch: true }],
      // 신규/엄격 규칙 — 오탐 여지가 있어 경고로
      'no-useless-assignment': 'warn',
    },
  },

  // 웹: 브라우저 글로벌 + React Hooks/Refresh 규칙
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // 테스트: node + 브라우저(jsdom) 글로벌
  {
    files: ['**/*.test.{ts,tsx}', '**/test/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },

  // 설정 파일: node 글로벌
  {
    files: ['**/*.config.{ts,js}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // Prettier와 충돌하는 포맷 규칙 비활성화(반드시 마지막)
  prettier,
)

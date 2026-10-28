// فحص جودة JS — يستهدف أخطاء حقيقية لا تنسيقًا
export default [
  {
    files: ['js/*.js', 'sw.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly',
        localStorage: 'readonly', sessionStorage: 'readonly', console: 'readonly',
        fetch: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
        Intl: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
        caches: 'readonly', self: 'readonly', location: 'readonly',
        history: 'readonly', CustomEvent: 'readonly', Node: 'readonly',
        requestAnimationFrame: 'readonly', matchMedia: 'readonly',
        IntersectionObserver: 'readonly', ResizeObserver: 'readonly',
        AbortController: 'readonly', Blob: 'readonly', Response: 'readonly',
        Request: 'readonly', Headers: 'readonly', structuredClone: 'readonly'
      }
    },
    linterOptions: { reportUnusedDisableDirectives: true },
    rules: {
      // أخطاء حقيقية فقط — لا أسلوب
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'no-fallthrough': 'error',
      'no-self-assign': 'error',
      'no-self-compare': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-cond-assign': 'error',
      'no-sparse-arrays': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      'eqeqeq': ['warn', 'smart'],
      'no-implicit-globals': 'error',
      'no-loop-func': 'warn',
      'no-return-assign': 'warn',
      'no-shadow-restricted-names': 'error',
      'no-useless-escape': 'warn'
    }
  }
];

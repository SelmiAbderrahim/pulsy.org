import tsParser from '@typescript-eslint/parser';

// These checks run on application TypeScript/JSX as well as JavaScript. Locally
// scoped confirmation helpers are allowed; browser-native dialogs are not.
export default [{
  ignores: ['**/node_modules/**', '**/dist/**', '**/routeTree.gen.ts'],
}, {
  files: ['apps/*/src/**/*.{js,mjs,ts,tsx}', 'packages/*/src/**/*.{js,mjs,ts,tsx}'],
  languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
  rules: {
    'no-restricted-globals': ['error',
      { name: 'confirm', message: 'Use the shared themed confirmation dialog.' },
      { name: 'alert', message: 'Use accessible inline feedback or a themed dialog.' },
    ],
    'no-restricted-properties': ['error', ...['window', 'globalThis', 'self'].flatMap(object =>
      ['confirm', 'alert'].map(property => ({ object, property, message: 'Use shared themed dialogs.' })))],
  },
}, {
  files: ['apps/web/src/**/*.{js,mjs,ts,tsx}'],
  ignores: ['apps/web/src/components/ui/**'],
  rules: {
    'no-restricted-syntax': ['error',
      { selector: 'JSXOpeningElement[name.name=/^(select|details|summary)$/]', message: 'Use the shared Select/Combobox or Collapsible primitive.' },
      { selector: 'JSXOpeningElement[name.name=/^(input|Input)$/] > JSXAttribute[name.name="type"][value.value=/^(date|file)$/]', message: 'Use the shared DatePicker or FileDropzone primitive.' },
      { selector: 'JSXOpeningElement[name.name=/^(input|Input)$/] > JSXAttribute[name.name="type"] > JSXExpressionContainer > Literal[value=/^(date|file)$/]', message: 'Use the shared DatePicker or FileDropzone primitive.' },
    ],
  },
}];

import { ESLint } from 'eslint';
import assert from 'node:assert/strict';
import test from 'node:test';

const eslint = new ESLint();
for (const source of ['confirm("delete")', 'alert("error")', ...['window', 'globalThis', 'self'].flatMap(object =>
  ['confirm', 'alert'].flatMap(property => [`${object}.${property}("message")`, `${object}["${property}"]("message")`]))]) {
  test(`rejects native prompt: ${source}`, async () => {
    const [result] = await eslint.lintText(source, { filePath: 'apps/web/src/prompt-regression.tsx' });
    assert.equal(result.errorCount, 1);
    assert.match(result.messages[0].ruleId, /^no-restricted-(globals|properties)$/);
  });
}
test('allows scoped themed confirmation helpers and JSX', async () => {
  const [result] = await eslint.lintText('const confirm = async () => true; const View = () => <button onClick={() => confirm()}>Delete</button>;', { filePath: 'apps/web/src/prompt-regression.tsx' });
  assert.equal(result.errorCount, 0);
});

for (const source of ['<select aria-label="Language" />', '<details><summary>More</summary></details>', '<input type="date" />', '<input type="file" />', '<Input type="date" />', '<input type={"file"} />']) {
  test(`rejects native app control mutation: ${source}`, async () => {
    const [result] = await eslint.lintText(`const View = () => ${source};`, { filePath: 'apps/web/src/control-regression.tsx' });
    assert.ok(result.errorCount > 0, 'native controls must use shared primitives');
    assert.equal(result.messages[0].ruleId, 'no-restricted-syntax');
  });
}
test('allows native controls inside shared UI internals', async () => {
  const [result] = await eslint.lintText('const Internal = () => <input type="file" hidden aria-hidden="true" />;', { filePath: 'apps/web/src/components/ui/file-dropzone.tsx' });
  assert.equal(result.errorCount, 0);
});

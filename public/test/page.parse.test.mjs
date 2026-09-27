// The page is one inline script, and a syntax error in it is a blank screen
// in every browser with nothing logged anywhere Eesa can see. This compiles it
// the way a browser does — a classic script, strict because the page says so.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const HTML = fs.readFileSync(new URL('../app.html', import.meta.url), 'utf8');

export function scripts(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

function compiles(code) {
  new vm.Script(code, { filename: 'app.html' });
}

test('the page has its script', () => {
  assert.equal(scripts(HTML).length, 1);
});

test('the page script compiles', () => {
  for (const code of scripts(HTML)) compiles(code);
});

// A check that cannot fail is worse than none: prove this one does.
test('a script with a syntax error is refused', () => {
  const [code] = scripts(HTML);
  assert.throws(() => compiles(code + '\n function ( {'), SyntaxError);
});

test('no Eesa host is written into the page', () => {
  assert.doesNotMatch(HTML, /eesa\.ai/i);
});

test('no app is named in the page; names come from the server', () => {
  assert.doesNotMatch(HTML, /attendance/i);
});

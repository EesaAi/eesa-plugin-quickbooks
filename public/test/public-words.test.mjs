// Nothing in this public repo names a customer, a person or a host of ours.
//
// The words it must not contain are themselves what is being kept private, so
// the list is not written here: it comes from PUBLIC_BANNED_WORDS
// (comma-separated, any case), set wherever this suite runs. A failure names
// the file and the word's place in that list, never the word, because a
// public repo's test output is public too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const words = (process.env.PUBLIC_BANNED_WORDS || '')
  .split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);

test('no tracked file names what the public must not see', {
  skip: words.length ? false : 'PUBLIC_BANNED_WORDS is not set, so there is nothing to check against',
}, () => {
  const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  const found = [];
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8').toLowerCase();
    words.forEach((w, i) => { if (text.includes(w)) found.push(`${file}: word #${i + 1}`); });
  }
  assert.deepEqual(found, []);
});

// The gateway, started for real against a fake QuickBooks child. Nothing here
// reaches Intuit: no client id is set, so the token refresh never runs, and the
// child is a script that answers MCP on stdio and can be told to die mid-call.
// Run from gateway/: node --test test/gateway.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

const GATEWAY = new URL('../gateway.mjs', import.meta.url).pathname;
const CHILD = `
const fs = require('fs');
let buf = '';
const out = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (m.method === 'initialize') out({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } } });
    else if (m.method === 'tools/call') {
      fs.appendFileSync(process.env.FAKE_LOG, m.params.name + '\\n');
      const calls = fs.readFileSync(process.env.FAKE_LOG, 'utf8').split('\\n').filter(Boolean).length;
      if (calls === 1) process.exit(1);   // the first call dies half way
      out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'answered' }] } });
    } else if (m.id !== undefined) out({ jsonrpc: '2.0', id: m.id, result: { tools: [] } });
  }
});
`;

const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });

async function start(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qbgw-'));
  fs.mkdirSync(path.join(dir, 'dist'));
  fs.writeFileSync(path.join(dir, 'dist', 'index.js'), CHILD);
  const port = await freePort();
  const log = path.join(dir, 'calls.log');
  const env = { PATH: process.env.PATH, GATEWAY_PORT: String(port), QB_MCP_DIR: dir, FAKE_LOG: log,
    QB_TOKEN_STORE: path.join(dir, 'token.json'), QUICKBOOKS_REALM_ID: '9130000000000000', QUICKBOOKS_ENVIRONMENT: 'sandbox' };
  const gw = spawn(process.execPath, [GATEWAY], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  t.after(() => gw.kill());
  await new Promise((resolve, reject) => {
    gw.stderr.on('data', (d) => { if (/listening on/.test(String(d))) resolve(); });
    gw.on('exit', (code) => reject(new Error('gateway exited ' + code)));
  });
  const base = `http://127.0.0.1:${port}`;
  const rpc = (method, params) => fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((r) => r.json());
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
  return { base, rpc, calls };
}

test('a write whose child died mid-call is not sent again, and says it may have been made', async (t) => {
  const g = await start(t);
  const out = await g.rpc('tools/call', { name: 'create-bill', arguments: { bill: {} } });
  assert.deepEqual(g.calls(), ['create-bill'], 'sent once');
  assert.match(out.error.message, /^Connection closed/, 'the change road reads this as not known, not failed');
  assert.match(out.error.message, /may or may not have been made/);
});

test('a read whose child died is asked once more, on a fresh child', async (t) => {
  const g = await start(t);
  const out = await g.rpc('tools/call', { name: 'search_bills', arguments: {} });
  assert.deepEqual(g.calls(), ['search_bills', 'search_bills']);
  assert.equal(out.result.content[0].text, 'answered');
});

test('what the OAuth pages are sent is text, never markup, and they cannot be framed', async (t) => {
  const g = await start(t);
  const r = await fetch(g.base + '/oauth/callback?error=' + encodeURIComponent('<script>alert(1)</script>'));
  const body = await r.text();
  assert.equal(r.status, 400);
  assert.doesNotMatch(body, /<script>/);
  assert.match(body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  const stale = await fetch(g.base + '/oauth/callback?state=nope&code=x');
  assert.match(stale.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('the token health check names no company and no file', async (t) => {
  const g = await start(t);
  const body = await (await fetch(g.base + '/health/token')).json();
  assert.equal('realm_id' in body, false);
  assert.equal('token_store' in body, false);
  assert.doesNotMatch(JSON.stringify(body), /9130000000000000/);
});

// The page, mounted in jsdom against a made-up Eesa: every tool answers from
// the fixtures below, and a tool with no fixture answers as an older Eesa does
// for a tool it does not have yet. Every name, address and amount here is made
// up — this repository is public.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import FakeTimers from '@sinonjs/fake-timers';

const HTML = fs.readFileSync(new URL('../app.html', import.meta.url), 'utf8');
const EESA = 'https://app.eesa.example';
const PLUGIN = 'https://qb.plugin.example';
const ENDPOINT = '/api/v1/gateway/plugin-ui-invoke/';

const ME = {
  ok: true, name: 'Dana Reyes', email: 'dana@acme.example', has_access: true, role_key: 'company_admin',
  areas: ['sales', 'expenses', 'reports_financial', 'reports_ar', 'reports_ap', 'accounting', 'account_management'],
};
const NOT_AVAILABLE = { status: 403, body: { detail: 'This tool is not available to the UI.' } };
const DEFAULTS = {
  quickbooks_my_access: ME,
  get_company_info: { CompanyName: 'Acme Bistro' },
  specialist_chat_conversations: { ok: true, conversations: [] },
  quickbooks_changes: { ok: true, waiting_on_me: [], my_requests: [], failed: [] },
  qb_apps: { ok: true, apps: [], viewer: { can_connect: true } },
};

/** Mount the page. `tools` answers by tool name: a value, {status, body}, or (args) => either. */
function mount({ tools = {}, origins = EESA } = {}) {
  const p = { calls: [], posted: [], opened: [], errors: [] };
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/Could not parse CSS/.test(e.message)) p.errors.push(e); });
  const html = HTML.replace('<head>', `<head>\n<meta name="eesa-origins" content="${origins}">`);
  p.dom = new JSDOM(html, {
    url: PLUGIN + '/app', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      p.clock = FakeTimers.withGlobal(w).install({
        now: Date.parse('2026-09-27T16:00:00Z'),
        toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
      });
      w.postMessage = (msg, target) => { p.posted.push({ msg, target }); };
      w.open = (url) => { p.opened.push(url); return null; };
      w.fetch = async (url, init) => {
        const { tool, args } = JSON.parse(init.body);
        p.calls.push({ url, tool, args });
        let a = tool in tools ? tools[tool] : DEFAULTS[tool];
        if (typeof a === 'function') a = a(args);
        if (a === undefined) a = NOT_AVAILABLE;
        const r = a && typeof a.status === 'number' && a.body !== undefined ? a : { status: 200, body: a };
        return { ok: r.status < 300, status: r.status, json: async () => JSON.parse(JSON.stringify(r.body)) };
      };
    },
  });
  p.window = p.dom.window;
  p.$ = (s) => p.window.document.querySelector(s);
  p.$$ = (s) => [...p.window.document.querySelectorAll(s)];
  p.text = (s = 'body') => (p.$(s) || {}).textContent || '';
  p.called = (tool) => p.calls.filter((c) => c.tool === tool);
  p.events = (name) => p.posted.map((x) => x.msg).filter((m) => m && m.type === 'eesa:event' && m.name === name);
  p.button = (label, within = 'body') => p.$$(within + ' button').find((b) => b.textContent.trim() === label);
  return p;
}
async function settle(p, ms = 0) {
  await p.clock.tickAsync(ms);
  for (let i = 0; i < 8; i++) { await new Promise((r) => setImmediate(r)); await p.clock.tickAsync(0); }
}
async function session(p, { origin = EESA, apiBase, route, token = 'tok-1' } = {}) {
  const w = p.window;
  const data = { type: 'eesa:session', token, theme: 'light' };
  if (apiBase !== undefined) data.apiBase = apiBase;
  if (route !== undefined) data.route = route;
  w.dispatchEvent(new w.MessageEvent('message', { data, origin }));
  await settle(p);
}
async function click(p, el) {
  assert.ok(el, 'the button is on the page');
  el.click();
  await settle(p);
}
const turn = (id, extra = {}) => ({ type: 'turn', at: '2026-09-27T15:00:00Z', turn: {
  id, conversation: 'c-1', status: 'DONE', question: 'What runs this week?', answer: 'Here it is.',
  created_at: '2026-09-27T15:00:00Z', actions: [], ...extra } });
const chat = (items) => ({ ok: true, conversation: 'c-1', items });

// ── boot and origin ─────────────────────────────────────────────────────

test('a session from an origin Eesa is not served from is ignored', async () => {
  const p = mount();
  await session(p, { origin: 'https://elsewhere.example', apiBase: 'https://elsewhere.example' });
  assert.equal(p.calls.length, 0);
  await session(p, { origin: EESA });
  assert.ok(p.calls.length > 0);
  assert.ok(p.calls.every((c) => c.url === EESA + ENDPOINT));
});

test('apiBase is used only when it is one of Eesa\'s own origins', async () => {
  const api = 'https://api.eesa.example';
  const a = mount({ origins: `${EESA} ${api}` });
  await session(a, { apiBase: 'https://elsewhere.example/' });
  assert.ok(a.calls.length && a.calls.every((c) => c.url === EESA + ENDPOINT));
  const b = mount({ origins: `${EESA} ${api}` });
  await session(b, { apiBase: api + '/' });
  assert.ok(b.calls.length && b.calls.every((c) => c.url === api + ENDPOINT));
});

test('the old { token, theme } message still boots the page', async () => {
  const p = mount();
  await session(p);
  assert.equal(p.called('quickbooks_my_access').length, 1);
});

test('with no session in 8 seconds the page says so and tells the shell', async () => {
  const p = mount();
  await settle(p, 7999);
  assert.doesNotMatch(p.text('#view'), /Open QuickBooks from inside Eesa/);
  await settle(p, 1);
  assert.match(p.text('#view'), /Open QuickBooks from inside Eesa\./);
  const ev = p.events('quickbooks.page.boot');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].outcome, 'fail');
  assert.equal(ev[0].code, 'no_session');
});

test('a route is checked, and applied once, after boot', async () => {
  const p = mount({ tools: { qb_chat: chat([turn('t1')]) } });
  await session(p, { apiBase: EESA, route: { conv: 'c-1"><img src=x>', view: 'needs', other: 'x' } });
  assert.equal(p.called('qb_chat').length, 0);   // not a plain id: not asked for
  assert.equal(p.text('#title'), 'Waiting on you');
  const q = mount({ tools: { qb_chat: chat([turn('t1')]) } });
  await session(q, { apiBase: EESA, route: { conv: 'c-1' } });
  await session(q, { apiBase: EESA, route: { conv: 'c-2' } });   // a renewed token, not a new place
  assert.deepEqual(q.called('qb_chat').map((c) => c.args.conversation), ['c-1']);
});

// ── what a call that fails says ─────────────────────────────────────────

test('a tool an older Eesa lacks says so, and every failed call is told to the shell', async () => {
  const p = mount({ tools: {
    qb_apps: { ok: true, viewer: { can_connect: true },
               apps: [{ key: 'rota', name: 'Rota Planner', what: 'Hours', connected: false, shares: [{ title: 'Hours' }], not_shared: ['Notes'] }] },
  } });
  await session(p, { route: { view: 'needs' } });
  await click(p, p.button('Connect Rota Planner'));
  assert.match(p.text('.toast'), /This needs the latest Eesa — try again shortly/);
  const ev = p.events('quickbooks.page.call_failed').filter((m) => m.context.tool === 'qb_app_connect');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].context.status, 403);
});

test('role_forbids on the company read shows the no-access state', async () => {
  const p = mount({ tools: {
    quickbooks_my_access: { ...ME, has_access: false, role_key: '', areas: [] },
    get_company_info: { status: 403, body: { code: 'role_forbids', detail: 'Your QuickBooks role does not cover this.' } },
  } });
  await session(p);
  assert.match(p.text('#view'), /Your QuickBooks role isn’t recorded in Eesa yet/);
});

// ── money, and names ────────────────────────────────────────────────────

const CHANGE = { id: 'ch-1', status: 'PENDING', operation: 'create', kind: 'bill', summary: 'Bill from Acme Produce',
  amount: 1240.5, approvals_received: 0, required_approvals: 1, can_decide: true, requested_by: 'sam@acme.example',
  created_at: '2026-09-27T15:00:00Z', decisions: [] };
async function amountShown(access) {
  const p = mount({ tools: { quickbooks_my_access: access,
    quickbooks_changes: { ok: true, waiting_on_me: [CHANGE], my_requests: [], failed: [] } } });
  await session(p, { route: { view: 'needs' } });
  return p.text('[data-change="ch-1"] .amt');
}
test('money is in the company\'s currency; without one it keeps dollars; an empty one has no symbol', async () => {
  assert.equal(await amountShown(ME), '$1,241');
  assert.match(await amountShown({ ...ME, currency: 'EUR', money_locale: 'de-DE' }), /^1\.241\s€$/);
  assert.equal(await amountShown({ ...ME, currency: '', money_locale: 'en-US' }), '1,240.50');
});

test('an app\'s name comes from the server, not the page', async () => {
  const req = { id: 'rq-1', status: 'DRAFTING', words: 'Add Alex at $18 an hour', status_label: 'Drafting', steps: [],
    findings: [], log: [{ by: 'assistant', text: 'Drafting', at: '2026-09-27T15:00:00Z' }] };
  const p = mount({ tools: {
    qb_apps: { ok: true, viewer: {}, apps: [{ key: 'rota', name: 'Rota Planner', connected: true, counts: {} }] },
    qb_requests: { ok: true, open: [], recent: [] },
    qb_chat: chat([turn('t1'), { type: 'request', at: '2026-09-27T15:01:00Z', app: 'rota', request: req }]),
  } });
  await session(p, { route: { conv: 'c-1' } });
  const card = p.text('[data-req="rq-1"]');
  assert.match(card, /Rota Planner ·/);
  assert.match(card, /Rota Planner assistant/);
  assert.doesNotMatch(card, /attendance/i);
});

// ── cards nobody taught the page ────────────────────────────────────────

test('an unknown card is drawn as a generic card, never with the server\'s buttons, and told once', async () => {
  const mystery = { type: 'mystery', title: 'Something new', text: 'It is **new**.',
    fields: [{ label: 'Store', value: 'Acme Bistro' }], actions: [{ label: 'Delete everything', tool: 'x' }] };
  const odd = { type: 'toString', title: 'Named like a built-in' };
  const p = mount({ tools: { qb_chat: chat([turn('t1', { cards: [mystery, odd] }), { type: 'mystery', at: '2026-09-27T15:02:00Z', mystery: { message: 'Another one' } }]) } });
  await session(p, { route: { conv: 'c-1' } });
  const cards = p.$$('[data-card="mystery"]');
  assert.equal(cards.length, 2);
  assert.match(cards[0].textContent, /Something new/);
  assert.equal(cards[0].querySelector('strong').textContent, 'new');
  assert.match(cards[0].textContent, /Store\s*Acme Bistro/);
  assert.match(cards[1].textContent, /mystery[\s\S]*Another one/);
  assert.ok(!p.text('#view').includes('Delete everything'));
  assert.ok(p.button('Ask about this', '[data-card="mystery"]'));
  assert.match(p.text('[data-card="toString"]'), /Named like a built-in/);
  await settle(p, 60000);   // the minute's refresh draws it again
  assert.equal(p.$$('[data-card="mystery"]').length, 2);
  const ev = p.events('quickbooks.page.unknown_card').map((m) => m.context.type);
  assert.deepEqual(ev.sort(), ['mystery', 'toString']);
});

// ── Coming up, and the calendar ─────────────────────────────────────────

const CAL = {
  ok: true, tz: 'America/Chicago', says: 'This week: 2 runs.',
  next: { title: 'Bills to pay', time: '9:00 AM' },
  days: [
    { date: '2026-09-27', label: 'Today', items: [
      { at: '2026-09-27T11:00:00Z', local_time: '6:00 AM', type: 'pull', source: 'schedule', id: 'f1', occurrence: '20260927T1100Z',
        title: 'Acme POS sales', status: 'failed', can: ['run_now'], proposes: 'journal entries for Acme POS sales' },
      { at: '2026-09-27T14:00:00Z', local_time: '9:00 AM', type: 'alert', source: 'schedule', id: 'f2',
        title: 'Bills to pay', status: 'planned', can: [] } ] },
    { date: '2026-09-28', label: 'Tomorrow', items: [
      { at: '2026-09-28T17:00:00Z', local_time: '12:00 PM', type: 'bill_due', source: 'bills_due', id: 'b1',
        title: 'Rent', status: 'due', amount: 1800 } ] },
  ],
};

test('Coming up appears only when the calendar returns a scheduled item', async () => {
  const p = mount({ tools: { quickbooks_calendar: CAL } });
  await session(p);
  const asked = p.called('quickbooks_calendar')[0];
  assert.deepEqual(asked.args, { days: 7, include: ['schedule', 'runs', 'approvals'] });
  assert.match(p.text('#convs'), /Coming up\s*Next: Bills to pay · 9:00 AM/);

  const q = mount({ tools: { quickbooks_calendar: { ...CAL, next: null, days: [CAL.days[1]] } } });
  await session(q);
  assert.doesNotMatch(q.text('#convs'), /Coming up/);
});

test('the calendar: day by day, Run it now only where a run failed, a dialog first when it asks QuickBooks', async () => {
  let polls = 0;
  const p = mount({ tools: {
    quickbooks_calendar: CAL,
    quickbooks_schedule_change: { ok: true, run_id: 'r-9' },
    quickbooks_run_status: () => ({ ok: true, run: { status: polls++ ? 'done' : 'running', said: 'Posted 1 day' } }),
  } });
  await session(p, { route: { view: 'calendar' } });
  const view = p.text('#view');
  assert.match(view, /Today[\s\S]*6:00 AM[\s\S]*Acme POS sales[\s\S]*Tomorrow[\s\S]*Rent[\s\S]*\$1,800/);
  assert.equal(p.$$('#view button').filter((b) => b.textContent.trim() === 'Run it now').length, 1);

  await click(p, p.button('Run it now'));
  assert.match(p.text('.dlg'), /This asks QuickBooks for journal entries for Acme POS sales\. Approvers will be told\./);
  assert.equal(p.called('quickbooks_schedule_change').length, 0);
  await click(p, p.$('#dlgOk'));
  assert.deepEqual(p.called('quickbooks_schedule_change')[0].args, { id: 'f1', action: 'run_now', occurrence: '20260927T1100Z' });
  await settle(p, 2000);
  await settle(p, 2000);
  assert.deepEqual(p.called('quickbooks_run_status')[0].args, { run_id: 'r-9' });

  const before = p.called('quickbooks_calendar').length;
  await click(p, p.button('Two more weeks'));
  const last = p.called('quickbooks_calendar').slice(before).pop();
  assert.equal(last.args.days, 21);
});

test('a conversation a flow writes to has a bell, and a dot while a draft waits in it', async () => {
  const p = mount({ tools: { specialist_chat_conversations: { ok: true, conversations: [
    { id: 'aa11', title: 'Bills to pay', origin: 'FLOW', waiting: true, turns: 2, last_at: '2026-09-27T14:00:00Z' },
    { id: 'bb22', title: 'Who owes us?', origin: 'APP', turns: 1, last_at: '2026-09-27T13:00:00Z' } ] } } });
  await session(p);
  const flow = p.$('[data-id="aa11"]'), plain = p.$('[data-id="bb22"]');
  assert.ok(flow.querySelector('.ic.bell'));
  assert.ok(flow.querySelector('.ic .waitdot'));
  assert.equal(plain.querySelector('.ic.bell'), null);
});

// ── the cards in a conversation ─────────────────────────────────────────

test('a draft card\'s Yes calls quickbooks_draft_decide, and the card then says it is done', async () => {
  const draft = { type: 'draft', id: 'dr-1', tool: 'quickbooks_alert_save', title: 'Bills to pay · Mondays 9:00 AM',
    lines: ['If it ran now: 3 bills, $1,240', 'Tells Dana Reyes'] };
  const p = mount({ tools: {
    qb_chat: chat([turn('t1', { cards: [draft] })]),
    quickbooks_draft_decide: { ok: true, approved: true, result: {}, card: { id: 'dr-1', state: 'done' } },
  } });
  await session(p, { route: { conv: 'c-1' } });
  const card = p.$('[data-draft="dr-1"]');
  assert.match(card.textContent, /Set up\?[\s\S]*Bills to pay · Mondays 9:00 AM[\s\S]*3 bills/);
  await click(p, p.button('Yes', '[data-draft="dr-1"]'));
  assert.deepEqual(p.called('quickbooks_draft_decide').map((c) => c.args), [{ draft_id: 'dr-1', decision: 'yes' }]);
  assert.match(p.text('[data-draft="dr-1"]'), /Done/);
  assert.equal(p.button('Yes', '[data-draft="dr-1"]'), undefined);
});

test('a run card is polled while it is queued or running, then shows what it said', async () => {
  let n = 0;
  const p = mount({ tools: {
    qb_chat: chat([turn('t1', { cards: [{ type: 'run', run_id: 'r-1', title: 'Acme POS sales', status: 'queued' }] })]),
    quickbooks_run_status: () => ({ ok: true, run: n++ ? { status: 'done', said: 'Posted **2 days**', change_ids: [] } : { status: 'running' } }),
  } });
  await session(p, { route: { conv: 'c-1' } });
  await settle(p, 2000);
  await settle(p, 2000);
  await settle(p, 2000);
  assert.ok(p.called('quickbooks_run_status').every((c) => c.args.run_id === 'r-1'));
  assert.equal(p.called('quickbooks_run_status').length, 2);
  assert.match(p.text('[data-run="r-1"]'), /Posted 2 days/);
  await settle(p, 20000);
  assert.equal(p.called('quickbooks_run_status').length, 2);
});

test('a schedule card has no buttons, except Run it now after a failed or missed run', async () => {
  const ok = { type: 'schedule', id: 'f2', title: 'Bills to pay', when: 'Mondays at 9:00 AM', next_time: 'Mon 9:00 AM',
    last: { status: 'done', said: '3 bills' }, owner: { name: 'Dana Reyes', is_me: true } };
  const bad = { ...ok, id: 'f1', title: 'Acme POS sales', last: { status: 'missed' } };
  const p = mount({ tools: { qb_chat: chat([turn('t1', { cards: [ok, bad] })]),
    quickbooks_schedule_change: { ok: true, run_id: 'r-5' } } });
  await session(p, { route: { conv: 'c-1' } });
  assert.match(p.text('[data-sched="f2"]'), /Mondays at 9:00 AM/);
  assert.equal(p.$$('[data-sched="f2"] button').length, 0);
  await click(p, p.button('Run it now', '[data-sched="f1"]'));
  assert.deepEqual(p.called('quickbooks_schedule_change')[0].args, { id: 'f1', action: 'run_now' });
});

test('a day\'s items carry their chip, and an AMBER day can be released with a reason', async () => {
  const items = { type: 'items', app: 'acmepos', items: [
    { id: 'i1', status: 'REVIEW', title: 'Acme POS sales · Thu 25 Sep', amount: '3900.00' },
    { id: 'i2', status: 'WAITING', verdict: 'AMBER', title: 'Acme POS sales · Fri 26 Sep', reason: 'Card total is off by $3.10',
      figures: [{ label: 'Sales', value: '$4,210.55' }] },
    { id: 'i3', status: 'WAITING', verdict: 'RED', title: 'Acme POS sales · Sat 27 Sep', reason: 'Refunds do not add up' },
    { id: 'i4', status: 'WAITING', title: 'Acme POS sales · Sun 28 Sep', reason: 'Eesa’s copy is 3 h old' } ] };
  const p = mount({ tools: {
    qb_apps: { ok: true, viewer: {}, apps: [{ key: 'acmepos', name: 'Acme POS', connected: true, counts: {} }] },
    qb_requests: { ok: true, open: [], recent: [] },
    qb_chat: chat([turn('t1', { cards: [items] })]),
    qb_review: { ok: true, draft_id: 'dr-7', card: { type: 'draft', id: 'dr-7' } },
    quickbooks_draft_decide: { ok: true, approved: true, result: {}, card: { id: 'dr-7', state: 'done' } },
  } });
  await session(p, { route: { conv: 'c-1' } });
  const chips = p.$$('[data-item] .tag').map((t) => t.textContent);
  assert.deepEqual(chips, ['Ready', 'AMBER', 'RED', 'Waiting']);
  assert.match(p.text('[data-item="i2"]'), /Sales\s*\$4,210\.55[\s\S]*Card total is off/);
  assert.equal(p.$$('[data-item] button').filter((b) => /Release/.test(b.textContent)).length, 1);
  await click(p, p.button('Release with a reason', '[data-item="i2"]'));
  p.$('.dlg textarea').value = 'Checked the card batch';
  p.$('.dlg textarea').dispatchEvent(new p.window.Event('input', { bubbles: true }));
  await click(p, p.$('#dlgOk'));
  assert.deepEqual(p.called('qb_review')[0].args, { app: 'acmepos', action: 'release', ids: ['i2'], reason: 'Checked the card batch' });
  assert.deepEqual(p.called('quickbooks_draft_decide')[0].args, { draft_id: 'dr-7', decision: 'yes' });
});

test('owner_needed: Take it over drafts the reassignment to me, and the draft waits for Yes', async () => {
  const p = mount({ tools: {
    qb_chat: chat([turn('t1', { cards: [{ type: 'owner_needed', id: 'f3', title: 'Rent bill', why: 'Its owner’s role no longer covers bills' }] })]),
    quickbooks_schedule_change: { ok: true, draft_id: 'dr-3', card: { type: 'draft', id: 'dr-3', title: 'Rent bill becomes yours', button_only: true } },
  } });
  await session(p, { route: { conv: 'c-1' } });
  assert.match(p.text('[data-owner="f3"]'), /Rent bill has no owner who can run it/);
  await click(p, p.button('Take it over'));
  assert.deepEqual(p.called('quickbooks_schedule_change')[0].args, { id: 'f3', action: 'reassign', new_owner: 'dana@acme.example' });
  assert.equal(p.called('quickbooks_draft_decide').length, 0);
  assert.ok(p.button('Yes', '[data-draft="dr-3"]'));
});

test('a flow\'s delivery is drawn as its own message, headed with the flow', async () => {
  const p = mount({ tools: { qb_chat: chat([turn('t1', { origin: 'FLOW', question: 'Bills to pay', answer: '3 bills are due this week.' })]) } });
  await session(p, { route: { conv: 'c-1' } });
  assert.equal(p.$('.row.me'), null);
  assert.match(p.text('#view'), /Bills to pay ·[\s\S]*3 bills are due this week\./);
});

// ── connecting QuickBooks ───────────────────────────────────────────────

test('not connected here: an admin gets Connect, opened by the shell, and the page waits for it', async () => {
  let n = 0;
  const p = mount({ tools: {
    get_company_info: { status: 403, body: { code: 'not_connected_here', detail: 'QuickBooks is not connected for this workspace.' } },
    quickbooks_connection: () => (n++ < 2 ? { ok: true, state: 'NOT_CONNECTED', can_connect: true, who_can_connect: [] }
      : { ok: true, state: 'CONNECTED', company_name: 'Acme Bistro', can_connect: true }),
    quickbooks_connect: { ok: true, card: { type: 'connect', url: PLUGIN + '/oauth/start?ticket=made-up', expires_at: '2026-09-27T16:10:00Z' } },
  } });
  await session(p, { apiBase: EESA });
  assert.match(p.text('#view'), /QuickBooks isn’t connected yet/);
  await click(p, p.button('Connect QuickBooks', '#view'));
  const open = p.posted.map((x) => x.msg).filter((m) => m && m.type === 'eesa:open-external');
  assert.deepEqual(open.map((m) => m.url), [PLUGIN + '/oauth/start?ticket=made-up']);
  assert.equal(p.opened.length, 0);
  await settle(p, 3000);
  await settle(p, 3000);
  assert.ok(p.called('quickbooks_connection').every((c) => c.args.action === 'status'));
  assert.match(p.text('#co'), /Acme Bistro/);
});

test('not_connected_here from an Eesa without the connection tool still shows the connect card', async () => {
  const p = mount({ tools: {
    get_company_info: { status: 403, body: { code: 'not_connected_here', detail: 'QuickBooks is not connected for this workspace.' } },
  } });
  await session(p);
  assert.match(p.text('#view'), /QuickBooks isn’t connected yet/);
  assert.ok(p.button('Connect QuickBooks', '#view'));
});

test('an older shell cannot open links, so the page opens the connect link itself', async () => {
  const p = mount({ tools: {
    quickbooks_connection: { ok: true, state: 'NOT_CONNECTED', can_connect: true },
    quickbooks_connect: { ok: true, card: { type: 'connect', url: PLUGIN + '/oauth/start?ticket=made-up' } },
  } });
  await session(p);
  await click(p, p.button('Connect QuickBooks', '#view'));
  assert.deepEqual(p.opened, [PLUGIN + '/oauth/start?ticket=made-up']);
});

test('somebody who cannot connect is told whom to ask; a lapsed sign-in says Reconnect', async () => {
  const p = mount({ tools: { quickbooks_connection: { ok: true, state: 'NOT_CONNECTED', can_connect: false, who_can_connect: ['Sam Rivera', 'Lee Park'] } } });
  await session(p);
  assert.match(p.text('#view'), /Ask Sam Rivera or Lee Park to connect QuickBooks\./);
  assert.equal(p.button('Connect QuickBooks', '#view'), undefined);

  const q = mount({ tools: { quickbooks_connection: { ok: true, state: 'NEEDS_SIGN_IN', can_connect: true } } });
  await session(q, { route: { view: 'needs' } });
  assert.match(q.text('#view'), /QuickBooks needs signing in again/);
  assert.ok(q.button('Reconnect', '#view'));
});

// ── what waits on the person ────────────────────────────────────────────

test('Waiting on you gathers drafts, failed runs of my flows, owners needed and AMBER days', async () => {
  const p = mount({ tools: {
    qb_apps: { ok: true, viewer: {}, apps: [{ key: 'acmepos', name: 'Acme POS', connected: true, counts: { waiting: 1 } }] },
    qb_requests: { ok: true, open: [], recent: [] },
    qb_review: { ok: true, items: [{ id: 'i2', status: 'WAITING', verdict: 'AMBER', title: 'Acme POS sales · Fri 26 Sep', reason: 'Card total is off' }] },
    quickbooks_schedule: { ok: true,
      schedules: [
        { id: 'f1', title: 'Acme POS sales', when: 'Every day at 6:00 AM', last: { status: 'failed', said: 'Acme POS did not answer' }, owner: { name: 'Dana Reyes', is_me: true } },
        { id: 'f5', title: 'Somebody else’s flow', last: { status: 'failed' }, owner: { name: 'Sam Rivera', is_me: false } } ],
      drafts: [{ id: 'dr-9', title: 'Tell me when cash drops below $5,000', tool: 'quickbooks_alert_save', lines: ['Checks every morning'] }],
      owner_needed: [{ id: 'f3', title: 'Rent bill' }] },
  } });
  await session(p, { route: { view: 'needs' } });
  assert.ok(p.$('[data-draft="dr-9"]'));
  assert.ok(p.button('Run it now', '[data-sched="f1"]'));
  assert.equal(p.$('[data-sched="f5"]'), null);
  assert.ok(p.$('[data-owner="f3"]'));
  assert.ok(p.$('[data-item="i2"]'));
  assert.match(p.text('#convs'), /Waiting on you\s*4 items/);
});

test('ways to start: the week, a cash alert, a connected app\'s sales — and they only fill the box', async () => {
  const p = mount({ tools: {
    quickbooks_calendar: CAL,
    qb_apps: { ok: true, viewer: {}, apps: [{ key: 'acmepos', name: 'Acme POS', connected: true, counts: {},
      kinds: [{ key: 'pos_sales_journal', name: 'Daily sales' }] }] },
    qb_requests: { ok: true, open: [], recent: [] },
  } });
  await session(p);
  const view = p.text('#view');
  assert.match(view, /What runs this week\?/);
  assert.match(view, /Tell me when cash drops below/);
  assert.match(view, /Post yesterday’s Acme POS sales/);
  const start = p.$$('[data-act="start"]').find((b) => /What runs this week/.test(b.textContent));
  await click(p, start);
  assert.equal(p.$('#box').value, 'What runs this week?');
  assert.equal(p.called('specialist_chat_send').length, 0);
});

test('nothing on the page throws while it is used', async () => {
  const p = mount({ tools: { quickbooks_calendar: CAL } });
  await session(p, { route: { view: 'calendar' } });
  await click(p, p.$('[data-act="open-needs"]') || p.$('[data-act="new-chat"]'));
  assert.deepEqual(p.errors.map((e) => e.message), []);
});

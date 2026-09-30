import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeNode,
  isSifaItem,
  buildSnapshot,
  diffSnapshots,
  classifyTransition,
  isoWeek,
  lastNWeeks,
  aggregateWeekly,
  estimateVerifySolved,
  currentQaCounts,
  toCsv,
  parseCsv,
  transitionsToRows,
  rowsToTransitions,
  buildReport,
  runSnapshot,
  serializeState,
} from './lib.mjs';

function node({
  id = 'I1',
  status = 'Backlog',
  priority = null,
  product = null,
  repo = 'sifa-web',
  number = 1,
  title = 'Title',
  state = 'OPEN',
  stateReason = null,
  closedAt = null,
  labels = [],
  typename = 'Issue',
} = {}) {
  const sel = (name) => (name ? { name } : null);
  return {
    id,
    status: sel(status),
    priority: sel(priority),
    product: sel(product),
    content: {
      __typename: typename,
      number,
      title,
      state,
      stateReason,
      closedAt,
      repository: repo ? { name: repo } : undefined,
      labels: { nodes: labels.map((name) => ({ name })) },
    },
  };
}

// --- Sifa filter -----------------------------------------------------------

test('isSifaItem: Product Sifa counts regardless of repo', () => {
  assert.equal(isSifaItem({ product: 'Sifa', repo: 'barazo-web' }), true);
  assert.equal(isSifaItem({ product: 'Sifa', repo: null }), true);
});

test('isSifaItem: sifa-* repo counts when Product is unset', () => {
  assert.equal(isSifaItem({ product: null, repo: 'sifa-api' }), true);
  assert.equal(isSifaItem({ product: null, repo: 'sifa-workspace' }), true);
});

test('isSifaItem: Barazo and Singi Labs products are excluded even in sifa-* repos', () => {
  assert.equal(isSifaItem({ product: 'Barazo', repo: 'sifa-web' }), false);
  assert.equal(isSifaItem({ product: 'Singi Labs', repo: 'sifa-web' }), false);
});

test('isSifaItem: other repos without Product are excluded', () => {
  assert.equal(isSifaItem({ product: null, repo: 'barazo-api' }), false);
  assert.equal(isSifaItem({ product: null, repo: null }), false);
});

test('normalizeNode: extracts compact entry, stage label and ref', () => {
  const n = normalizeNode(
    node({
      status: 'QA: Verify',
      priority: 'Now',
      labels: ['bug', 'stage:beta'],
      number: 42,
      repo: 'sifa-api',
      state: 'CLOSED',
      stateReason: 'COMPLETED',
      closedAt: '2026-09-01T10:00:00Z',
    }),
  );
  assert.deepEqual(n.entry, {
    ref: 'sifa-api#42',
    s: 'QA: Verify',
    p: 'Now',
    st: 'beta',
    o: 'CLOSED',
    c: '2026-09-01T10:00:00Z',
    r: 'COMPLETED',
  });
  assert.equal(n.title, 'Title');
  assert.equal(n.repo, 'sifa-api');
});

test('normalizeNode: merged pull requests are closed without a state reason', () => {
  const n = normalizeNode(node({ typename: 'PullRequest', state: 'MERGED', closedAt: '2026-09-01T00:00:00Z', labels: ['stage:beta'] }));
  assert.equal(n.entry.o, 'CLOSED');
  assert.equal(n.entry.r, null);
});

test('serializeState: parses back to the same object with one item per line', () => {
  const state = { version: 1, trackingStarted: '2026-09-30', snapshotDate: '2026-09-30', items: { A: e('Done'), B: e('QA: Spec') } };
  const text = serializeState(state);
  assert.deepEqual(JSON.parse(text), state);
  assert.equal(text.trim().split('\n').length, 4);
});

test('normalizeNode: open items omit closedAt and stateReason, draft has no ref repo', () => {
  const n = normalizeNode({ id: 'D1', status: { name: 'Triage' }, priority: null, product: { name: 'Sifa' }, content: { __typename: 'DraftIssue', title: 'Draft' } });
  assert.deepEqual(n.entry, { ref: 'draft', s: 'Triage', p: null, st: null, o: 'OPEN' });
  assert.equal(n.repo, null);
});

test('buildSnapshot: keeps only Sifa items', () => {
  const snap = buildSnapshot([
    node({ id: 'A', repo: 'sifa-web' }),
    node({ id: 'B', repo: 'barazo-web' }),
    node({ id: 'C', repo: 'sifa-web', product: 'Barazo' }),
    node({ id: 'D', repo: 'singi-labs.github.io', product: 'Sifa' }),
  ]);
  assert.deepEqual(Object.keys(snap.items).sort(), ['A', 'D']);
  assert.equal(snap.titles.A, 'Title');
});

// --- Transition diff -------------------------------------------------------

const e = (s, extra = {}) => ({ ref: 'sifa-web#1', s, p: null, st: 'beta', o: 'OPEN', ...extra });

test('diffSnapshots: first run (no previous state) yields no transitions', () => {
  assert.deepEqual(diffSnapshots(null, { A: e('QA: Verify') }, '2026-09-30', {}), []);
});

test('diffSnapshots: status change becomes a transition', () => {
  const t = diffSnapshots({ A: e('QA: Verify') }, { A: e('Done', { p: 'Now' }) }, '2026-09-30', { A: 'Fix it' });
  assert.deepEqual(t, [
    {
      date: '2026-09-30',
      item: 'A',
      ref: 'sifa-web#1',
      title: 'Fix it',
      from: 'QA: Verify',
      to: 'Done',
      stage: 'beta',
      priority: 'Now',
      prevState: 'OPEN',
      state: 'OPEN',
    },
  ]);
});

test('diffSnapshots: unchanged items and new items produce nothing', () => {
  const t = diffSnapshots({ A: e('Backlog') }, { A: e('Backlog'), B: e('QA: Spec') }, '2026-09-30', {});
  assert.deepEqual(t, []);
});

test('diffSnapshots: item closed while still in a QA stage yields (closed)', () => {
  const t = diffSnapshots({ A: e('QA: Verify') }, { A: e('QA: Verify', { o: 'CLOSED' }) }, '2026-09-30', {});
  assert.equal(t.length, 1);
  assert.equal(t[0].from, 'QA: Verify');
  assert.equal(t[0].to, '(closed)');
});

test('diffSnapshots: item closed outside QA stage without status change yields nothing', () => {
  assert.deepEqual(diffSnapshots({ A: e('In Progress') }, { A: e('In Progress', { o: 'CLOSED' }) }, '2026-09-30', {}), []);
});

test('diffSnapshots: item that disappears yields (removed) using previous values', () => {
  const t = diffSnapshots({ A: e('QA: Explore', { p: 'Next' }) }, {}, '2026-09-30', {});
  assert.equal(t.length, 1);
  assert.equal(t[0].from, 'QA: Explore');
  assert.equal(t[0].to, '(removed)');
  assert.equal(t[0].priority, 'Next');
  assert.equal(t[0].state, '');
});

// --- Forward/back classification ----------------------------------------------

const tr = (from, to, prevState = 'OPEN') => ({ from, to, prevState });

test('classify: QA: Spec forward unless sent back to Backlog/Triage/Plan Review', () => {
  assert.equal(classifyTransition(tr('QA: Spec', 'Ready for Dev')), 'forward');
  assert.equal(classifyTransition(tr('QA: Spec', 'Done')), 'forward');
  assert.equal(classifyTransition(tr('QA: Spec', 'Backlog')), 'back');
  assert.equal(classifyTransition(tr('QA: Spec', 'Triage')), 'back');
  assert.equal(classifyTransition(tr('QA: Spec', 'Plan Review')), 'back');
});

test('classify: QA: Verify Done is forward, Rework is back, else other', () => {
  assert.equal(classifyTransition(tr('QA: Verify', 'Done')), 'forward');
  assert.equal(classifyTransition(tr('QA: Verify', 'Rework')), 'back');
  assert.equal(classifyTransition(tr('QA: Verify', 'QA: Explore')), 'other');
});

test('classify: QA: Explore Done is forward', () => {
  assert.equal(classifyTransition(tr('QA: Explore', 'Done')), 'forward');
  assert.equal(classifyTransition(tr('QA: Explore', 'Rework')), 'back');
  assert.equal(classifyTransition(tr('QA: Explore', 'Backlog')), 'other');
});

test('classify: closed or removed while in QA counts as forward', () => {
  for (const s of ['QA: Spec', 'QA: Verify', 'QA: Explore']) {
    assert.equal(classifyTransition(tr(s, '(closed)')), 'forward');
    assert.equal(classifyTransition(tr(s, '(removed)')), 'forward');
  }
});

test('classify: non-QA origins and already-closed items are not counted', () => {
  assert.equal(classifyTransition(tr('In Progress', 'QA: Verify')), null);
  assert.equal(classifyTransition(tr('QA: Verify', 'Done', 'CLOSED')), null);
});

// --- Weeks ------------------------------------------------------------------

test('isoWeek: handles year boundaries', () => {
  assert.equal(isoWeek('2026-09-30'), '2026-W40');
  assert.equal(isoWeek('2026-01-01'), '2026-W01');
  assert.equal(isoWeek('2027-01-01'), '2026-W53');
  assert.equal(isoWeek('2024-12-30'), '2025-W01');
  assert.equal(isoWeek('2026-09-01T23:59:59Z'), '2026-W36');
});

test('lastNWeeks: returns N consecutive weeks ending at the given date, oldest first', () => {
  const w = lastNWeeks('2026-01-06', 3);
  assert.deepEqual(w.map((x) => x.week), ['2025-W52', '2026-W01', '2026-W02']);
  assert.equal(w[2].monday, '2026-01-05');
});

// --- Aggregation ----------------------------------------------------------------

test('aggregateWeekly: counts forward/back/other per week and QA stage', () => {
  const weeks = lastNWeeks('2026-09-30', 2).map((w) => w.week);
  const transitions = [
    { date: '2026-09-29', from: 'QA: Verify', to: 'Done', prevState: 'OPEN' },
    { date: '2026-09-30', from: 'QA: Verify', to: 'Rework', prevState: 'OPEN' },
    { date: '2026-09-22', from: 'QA: Spec', to: 'Ready for Dev', prevState: 'OPEN' },
    { date: '2026-09-22', from: 'QA: Explore', to: '(closed)', prevState: 'OPEN' },
    { date: '2026-09-22', from: 'In Progress', to: 'QA: Verify', prevState: 'OPEN' },
    { date: '2026-01-01', from: 'QA: Verify', to: 'Done', prevState: 'OPEN' },
  ];
  const agg = aggregateWeekly(transitions, weeks);
  assert.deepEqual(agg['2026-W40']['QA: Verify'], { forward: 1, back: 1, other: 0 });
  assert.deepEqual(agg['2026-W39']['QA: Spec'], { forward: 1, back: 0, other: 0 });
  assert.deepEqual(agg['2026-W39']['QA: Explore'], { forward: 1, back: 0, other: 0 });
  assert.deepEqual(agg['2026-W39']['QA: Verify'], { forward: 0, back: 0, other: 0 });
  assert.equal(agg['2026-W01'], undefined);
});

test('estimateVerifySolved: completed + stage-labelled closures before tracking start, per week', () => {
  const weeks = lastNWeeks('2026-09-30', 3).map((w) => w.week);
  const items = {
    A: e('Done', { o: 'CLOSED', r: 'COMPLETED', c: '2026-09-15T10:00:00Z' }),
    B: e('Done', { o: 'CLOSED', r: 'COMPLETED', c: '2026-09-16T10:00:00Z', st: null }),
    C: e('Done', { o: 'CLOSED', r: 'NOT_PLANNED', c: '2026-09-16T10:00:00Z' }),
    D: e('Done', { o: 'CLOSED', r: 'COMPLETED', c: '2026-09-30T10:00:00Z' }),
    E: e('Done', { o: 'CLOSED', r: 'COMPLETED', c: '2026-09-22T10:00:00Z', st: 'alpha' }),
  };
  const est = estimateVerifySolved(items, '2026-09-30', weeks);
  assert.deepEqual(est, { '2026-W38': 1, '2026-W39': 1 });
});

test('currentQaCounts: totals per QA stage split by stage label, open items only', () => {
  const items = {
    A: e('QA: Verify'),
    B: e('QA: Verify', { st: 'alpha' }),
    C: e('QA: Spec', { st: null }),
    D: e('QA: Verify', { o: 'CLOSED' }),
    E: e('Backlog'),
  };
  const c = currentQaCounts(items);
  assert.deepEqual(c['QA: Verify'], { total: 2, alpha: 1, beta: 1, 'post-live': 0, none: 0 });
  assert.deepEqual(c['QA: Spec'], { total: 1, alpha: 0, beta: 0, 'post-live': 0, none: 1 });
  assert.deepEqual(c['QA: Explore'], { total: 0, alpha: 0, beta: 0, 'post-live': 0, none: 0 });
});

// --- CSV ----------------------------------------------------------------------

test('CSV round trip keeps commas, quotes and newlines', () => {
  const rows = [
    ['a', 'b,c', 'say "hi"'],
    ['x\ny', '', 'z'],
  ];
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
});

test('transitions round trip through CSV rows with header', () => {
  const t = [{ date: '2026-09-30', item: 'A', ref: 'sifa-web#1', title: 'a, "b"', from: 'QA: Verify', to: 'Done', stage: '', priority: 'Now', prevState: 'OPEN', state: 'CLOSED' }];
  const back = rowsToTransitions(parseCsv(toCsv(transitionsToRows(t, true))));
  assert.deepEqual(back, t);
});

// --- Report + run -----------------------------------------------------------

test('buildReport: baseline page says tracking started and has no chart yet', () => {
  const md = buildReport({ today: '2026-09-30', trackingStarted: '2026-09-30', transitions: [], items: { A: e('QA: Verify') } });
  assert.match(md, /# QA flow metrics/);
  assert.match(md, /baseline/i);
  assert.match(md, /Currently in each QA stage/);
  assert.doesNotMatch(md, /xychart-beta/);
});

test('buildReport: with transitions renders weekly table and mermaid charts', () => {
  const md = buildReport({
    today: '2026-09-30',
    trackingStarted: '2026-09-20',
    transitions: [{ date: '2026-09-29', from: 'QA: Verify', to: 'Done', prevState: 'OPEN' }],
    items: {},
  });
  assert.match(md, /```mermaid\nxychart-beta/);
  assert.match(md, /\| 2026-W40 /);
  assert.match(md, /ESTIMATE/);
  assert.match(md, /How to read this/);
});

test('runSnapshot: first run returns baseline state and no transitions', () => {
  const out = runSnapshot({ prevState: null, nodes: [node({ id: 'A', status: 'QA: Verify' })], today: '2026-09-30', prevCsv: null });
  assert.equal(out.state.trackingStarted, '2026-09-30');
  assert.equal(out.state.snapshotDate, '2026-09-30');
  assert.deepEqual(out.newTransitions, []);
  assert.match(out.csv, /^date,item,ref,title,from_status,to_status,stage,priority,prev_state,state\n$/);
  assert.match(out.report, /baseline/i);
});

test('runSnapshot: second run appends transitions and keeps trackingStarted', () => {
  const first = runSnapshot({ prevState: null, nodes: [node({ id: 'A', status: 'QA: Verify' })], today: '2026-09-29', prevCsv: null });
  const second = runSnapshot({ prevState: first.state, nodes: [node({ id: 'A', status: 'Done' })], today: '2026-09-30', prevCsv: first.csv });
  assert.equal(second.state.trackingStarted, '2026-09-29');
  assert.equal(second.newTransitions.length, 1);
  assert.equal(second.csv.trim().split('\n').length, 2);
  assert.match(second.report, /xychart-beta/);
});

test('runSnapshot: re-running on the same day does not duplicate transitions', () => {
  const first = runSnapshot({ prevState: null, nodes: [node({ id: 'A', status: 'QA: Verify' })], today: '2026-09-29', prevCsv: null });
  const second = runSnapshot({ prevState: first.state, nodes: [node({ id: 'A', status: 'Done' })], today: '2026-09-30', prevCsv: first.csv });
  const third = runSnapshot({ prevState: second.state, nodes: [node({ id: 'A', status: 'Done' })], today: '2026-09-30', prevCsv: second.csv });
  assert.equal(third.csv.trim().split('\n').length, 2);
});

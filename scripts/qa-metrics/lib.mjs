// Pure logic for the nightly QA flow metrics job. No I/O here, so every part
// is unit-testable. See run.mjs for fetching and file handling.

export const QA_STAGES = ['QA: Spec', 'QA: Verify', 'QA: Explore'];
export const STAGE_LABELS = ['alpha', 'beta', 'post-live'];
export const WEEKS_SHOWN = 12;

const EXCLUDED_PRODUCTS = new Set(['Barazo', 'Singi Labs']);
const SPEC_BACK_TARGETS = new Set(['Backlog', 'Triage', 'Plan Review']);
const GONE = new Set(['(closed)', '(removed)']);

const CSV_HEADER = ['date', 'item', 'ref', 'title', 'from_status', 'to_status', 'stage', 'priority', 'prev_state', 'state'];
const CSV_KEYS = ['date', 'item', 'ref', 'title', 'from', 'to', 'stage', 'priority', 'prevState', 'state'];

// --- Filtering and normalizing ------------------------------------------------

export function isSifaItem({ product, repo }) {
  if (product === 'Sifa') return true;
  if (product && EXCLUDED_PRODUCTS.has(product)) return false;
  return typeof repo === 'string' && repo.startsWith('sifa-');
}

function stageFromLabels(labels) {
  for (const name of labels) {
    const m = /^stage:(.+)$/.exec(name);
    if (m) return m[1];
  }
  return null;
}

export function normalizeNode(n) {
  const c = n.content ?? {};
  const repo = c.repository?.name ?? null;
  const labels = (c.labels?.nodes ?? []).map((l) => l.name);
  const entry = {
    ref: repo && c.number != null ? `${repo}#${c.number}` : 'draft',
    s: n.status?.name ?? null,
    p: n.priority?.name ?? null,
    st: stageFromLabels(labels),
    o: c.state === 'CLOSED' || c.state === 'MERGED' ? 'CLOSED' : 'OPEN',
  };
  if (entry.o === 'CLOSED') {
    entry.c = c.closedAt ?? null;
    entry.r = c.stateReason ?? null;
  }
  return { id: n.id, title: c.title ?? '', repo, product: n.product?.name ?? null, entry };
}

export function buildSnapshot(nodes) {
  const items = {};
  const titles = {};
  for (const raw of nodes) {
    const n = normalizeNode(raw);
    if (!isSifaItem(n)) continue;
    items[n.id] = n.entry;
    titles[n.id] = n.title;
  }
  return { items, titles };
}

// --- Diffing ------------------------------------------------------------------

function transition(date, id, title, from, to, prev, curr) {
  const src = curr ?? prev;
  return {
    date,
    item: id,
    ref: src.ref,
    title: title ?? '',
    from: from ?? '',
    to: to ?? '',
    stage: src.st ?? '',
    priority: src.p ?? '',
    prevState: prev.o,
    state: curr ? curr.o : '',
  };
}

export function diffSnapshots(prevItems, currItems, date, titles) {
  if (!prevItems) return [];
  const out = [];
  for (const [id, curr] of Object.entries(currItems)) {
    const prev = prevItems[id];
    if (!prev) continue;
    if (prev.s !== curr.s) {
      out.push(transition(date, id, titles[id], prev.s, curr.s, prev, curr));
    } else if (prev.o === 'OPEN' && curr.o === 'CLOSED' && QA_STAGES.includes(curr.s)) {
      out.push(transition(date, id, titles[id], prev.s, '(closed)', prev, curr));
    }
  }
  for (const [id, prev] of Object.entries(prevItems)) {
    if (!(id in currItems)) out.push(transition(date, id, '', prev.s, '(removed)', prev, null));
  }
  return out;
}

// Returns 'forward' | 'back' | 'other' for moves out of a QA stage, or null
// when the transition does not count (not from QA, or the item was already
// closed, in which case it was counted when it closed).
export function classifyTransition({ from, to, prevState }) {
  if (!QA_STAGES.includes(from)) return null;
  if (prevState === 'CLOSED') return null;
  if (GONE.has(to)) return 'forward';
  if (from === 'QA: Spec') return SPEC_BACK_TARGETS.has(to) ? 'back' : 'forward';
  if (to === 'Done') return 'forward';
  if (to === 'Rework') return 'back';
  return 'other';
}

// --- Weeks ----------------------------------------------------------------------

function toUtcDate(s) {
  const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Bad date: ${s}`);
  return d;
}

const ymd = (d) => d.toISOString().slice(0, 10);

export function isoWeek(s) {
  const d = toUtcDate(s);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day); // Thursday of this week
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function lastNWeeks(s, n) {
  const d = toUtcDate(s);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() || 7) - 1)); // Monday
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(d);
    m.setUTCDate(m.getUTCDate() - 7 * i);
    out.push({ week: isoWeek(ymd(m)), monday: ymd(m) });
  }
  return out;
}

// --- Aggregation ------------------------------------------------------------------

export function aggregateWeekly(transitions, weeks) {
  const agg = {};
  for (const w of weeks) {
    agg[w] = {};
    for (const s of QA_STAGES) agg[w][s] = { forward: 0, back: 0, other: 0 };
  }
  for (const t of transitions) {
    const kind = classifyTransition(t);
    if (!kind) continue;
    const w = isoWeek(t.date);
    if (agg[w]) agg[w][t.from][kind] += 1;
  }
  return agg;
}

export function estimateVerifySolved(items, trackingStarted, weeks) {
  const inWindow = new Set(weeks);
  const out = {};
  for (const it of Object.values(items)) {
    if (it.o !== 'CLOSED' || it.r !== 'COMPLETED' || !it.st || !it.c) continue;
    if (it.c.slice(0, 10) >= trackingStarted) continue;
    const w = isoWeek(it.c);
    if (inWindow.has(w)) out[w] = (out[w] ?? 0) + 1;
  }
  return out;
}

export function currentQaCounts(items) {
  const out = {};
  for (const s of QA_STAGES) out[s] = { total: 0, alpha: 0, beta: 0, 'post-live': 0, none: 0 };
  for (const it of Object.values(items)) {
    if (it.o !== 'OPEN' || !QA_STAGES.includes(it.s)) continue;
    const bucket = STAGE_LABELS.includes(it.st) ? it.st : 'none';
    out[it.s].total += 1;
    out[it.s][bucket] += 1;
  }
  return out;
}

// --- CSV --------------------------------------------------------------------------

function csvField(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows) {
  return rows.map((r) => r.map(csvField).join(',')).join('\n') + '\n';
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function transitionsToRows(transitions, withHeader) {
  const rows = transitions.map((t) => CSV_KEYS.map((k) => t[k] ?? ''));
  return withHeader ? [CSV_HEADER, ...rows] : rows;
}

export function rowsToTransitions(rows) {
  const body = rows.length && rows[0][0] === 'date' ? rows.slice(1) : rows;
  return body.filter((r) => r.length >= CSV_KEYS.length).map((r) => Object.fromEntries(CSV_KEYS.map((k, i) => [k, r[i]])));
}

// --- Report -----------------------------------------------------------------------

const short = (w) => w.slice(5); // "2026-W40" -> "W40"

function chart(title, labels, bars, line) {
  const max = Math.max(1, ...bars, ...line);
  return [
    '```mermaid',
    'xychart-beta',
    `    title "${title}"`,
    `    x-axis [${labels.map((l) => `"${l}"`).join(', ')}]`,
    `    y-axis "Items" 0 --> ${max}`,
    `    bar [${bars.join(', ')}]`,
    `    line [${line.join(', ')}]`,
    '```',
  ].join('\n');
}

export function buildReport({ today, trackingStarted, transitions, items }) {
  const weeks = lastNWeeks(today, WEEKS_SHOWN);
  const weekIds = weeks.map((w) => w.week);
  const agg = aggregateWeekly(transitions, weekIds);
  const baseline = transitions.length === 0 && trackingStarted === today;
  const L = [];

  L.push('# QA flow metrics (Sifa)', '');
  L.push(`Last snapshot: ${today} (UTC). Tracking started: ${trackingStarted}.`, '');
  L.push(
    'Generated nightly by `.github/workflows/qa-metrics.yml` from a daily snapshot of the Status field on [board #2](https://github.com/orgs/singi-labs/projects/2). Raw data: `transitions.csv` and `state.json` on this branch.',
    '',
  );

  L.push('## How to read this', '');
  L.push('- Each night the job compares the board with the previous night and records every item whose Status changed. A move is dated on the night it was detected, so most moves land on the day after they happened.');
  L.push('- The counts below are items that **left** a QA stage in that ISO week (Monday to Sunday).');
  L.push('- **QA: Spec** forward = spec approved (moved anywhere except Backlog, Triage or Plan Review). Back = sent to Backlog, Triage or Plan Review.');
  L.push('- **QA: Verify** forward = solved (moved to Done). Back = bounced (moved to Rework).');
  L.push('- **QA: Explore** forward = session done (moved to Done). Back = moved to Rework.');
  L.push('- An item that is closed, or disappears from the board, while in a QA stage counts as forward.');
  L.push('- Other = left the QA stage for another column (for example QA: Verify to In Progress). Not counted as forward or back.');
  L.push('- Only Sifa items count: Product is Sifa, or the repository name starts with `sifa-`.', '');

  L.push('## Currently in each QA stage', '');
  const cur = currentQaCounts(items);
  L.push('| QA stage | Open items | stage:alpha | stage:beta | stage:post-live | no stage label |');
  L.push('|---|---:|---:|---:|---:|---:|');
  for (const s of QA_STAGES) {
    const c = cur[s];
    L.push(`| ${s} | ${c.total} | ${c.alpha} | ${c.beta} | ${c['post-live']} | ${c.none} |`);
  }
  L.push('');

  L.push(`## Items that left each QA stage, per week (last ${WEEKS_SHOWN} weeks)`, '');
  if (baseline) {
    L.push(`First run on ${today}: this snapshot is the baseline, so there are no transitions yet. The table and charts fill from the next nightly run.`, '');
  } else {
    L.push('| Week | Starts | Spec approved | Spec back | Verify solved | Verify bounced | Explore done | Explore back | Other |');
    L.push('|---|---|---:|---:|---:|---:|---:|---:|---:|');
    for (const w of [...weeks].reverse()) {
      const a = agg[w.week];
      const other = QA_STAGES.reduce((n, s) => n + a[s].other, 0);
      const pre = w.monday < trackingStarted && isoWeek(trackingStarted) !== w.week ? ' (before tracking)' : '';
      L.push(
        `| ${w.week}${pre} | ${w.monday} | ${a['QA: Spec'].forward} | ${a['QA: Spec'].back} | ${a['QA: Verify'].forward} | ${a['QA: Verify'].back} | ${a['QA: Explore'].forward} | ${a['QA: Explore'].back} | ${other} |`,
      );
    }
    L.push('');
    L.push('In each chart, bars are forward moves and the line is back moves.', '');
    const labels = weekIds.map(short);
    const series = (s, k) => weekIds.map((w) => agg[w][s][k]);
    L.push('### QA: Verify (solved vs bounced)', '', chart('QA: Verify - solved (bars) vs bounced (line)', labels, series('QA: Verify', 'forward'), series('QA: Verify', 'back')), '');
    L.push('### QA: Spec (approved vs sent back)', '', chart('QA: Spec - approved (bars) vs sent back (line)', labels, series('QA: Spec', 'forward'), series('QA: Spec', 'back')), '');
    L.push('### QA: Explore (done vs rework)', '', chart('QA: Explore - done (bars) vs rework (line)', labels, series('QA: Explore', 'forward'), series('QA: Explore', 'back')), '');
  }

  const est = estimateVerifySolved(items, trackingStarted, weekIds);
  const estWeeks = weeks.filter((w) => w.week in est);
  L.push('## ESTIMATE: Verify solved before tracking started', '');
  L.push(
    `This is an approximation, not measured data. For weeks before ${trackingStarted}, it counts Sifa issues on the board that were closed as completed and carry a \`stage:*\` label, grouped by the week they were closed. It cannot tell whether an item passed through QA: Verify.`,
    '',
  );
  if (estWeeks.length === 0) {
    L.push('No completed stage-labelled closures in the window before tracking started.', '');
  } else {
    L.push('| Week | Starts | Estimated Verify solved |', '|---|---|---:|');
    for (const w of [...estWeeks].reverse()) L.push(`| ${w.week} | ${w.monday} | ${est[w.week]} |`);
    L.push('');
  }
  return L.join('\n');
}

// One item per line keeps the nightly git diff readable.
export function serializeState(state) {
  const { items, ...meta } = state;
  const lines = Object.entries(items).map(([id, it]) => `${JSON.stringify(id)}:${JSON.stringify(it)}`);
  const head = JSON.stringify(meta).slice(0, -1);
  return `${head},"items":{\n${lines.join(',\n')}\n}}\n`;
}

// --- One nightly run ----------------------------------------------------------------

export function runSnapshot({ prevState, nodes, today, prevCsv }) {
  const { items, titles } = buildSnapshot(nodes);
  const newTransitions = diffSnapshots(prevState?.items ?? null, items, today, titles);
  const trackingStarted = prevState?.trackingStarted ?? today;
  const csv = prevCsv
    ? prevCsv + (newTransitions.length ? toCsv(transitionsToRows(newTransitions, false)) : '')
    : toCsv(transitionsToRows(newTransitions, true));
  const all = rowsToTransitions(parseCsv(csv));
  const state = { version: 1, trackingStarted, snapshotDate: today, items };
  const report = buildReport({ today, trackingStarted, transitions: all, items });
  return { state, csv, report, newTransitions };
}

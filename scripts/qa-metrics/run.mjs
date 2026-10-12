#!/usr/bin/env node
// Nightly QA flow metrics: snapshot board #2 Status for Sifa items, diff it
// against the previous snapshot, append transitions, and rebuild the report.
//
// Usage:
//   GH_TOKEN=... node scripts/qa-metrics/run.mjs --data-dir <dir> [--today YYYY-MM-DD] [--dry-run]
//
// <dir> holds state.json, transitions.csv and QA-METRICS.md (the qa-metrics
// branch in CI). --dry-run fetches and prints a summary without writing.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runSnapshot, serializeState } from './lib.mjs';

const PROJECT_ID = 'PVT_kwDOD4Vljc4BPpMY';
const QUERY = `
query($id: ID!, $cursor: String) {
  node(id: $id) {
    ... on ProjectV2 {
      items(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
          priority: fieldValueByName(name: "Priority") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
          product: fieldValueByName(name: "Product") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
          content {
            __typename
            ... on Issue { number title state stateReason closedAt repository { name } labels(first: 15) { nodes { name } } }
            ... on PullRequest { number title state closedAt repository { name } labels(first: 15) { nodes { name } } }
            ... on DraftIssue { title }
          }
        }
      }
    }
  }
  rateLimit { cost remaining }
}`;

function parseArgs(argv) {
  const opts = { dataDir: null, today: new Date().toISOString().slice(0, 10), dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--data-dir') opts.dataDir = argv[++i];
    else if (a === '--today') opts.today = argv[++i];
    else if (a === '--dry-run') opts.dryRun = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!opts.dataDir) throw new Error('--data-dir is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.today)) throw new Error(`Bad --today: ${opts.today}`);
  return opts;
}

async function graphql(token, variables) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'sifa-qa-metrics' },
      body: JSON.stringify({ query: QUERY, variables }),
    });
    if (res.status >= 500 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }
    const body = await res.json();
    if (!res.ok || body.errors) throw new Error(`GraphQL error (${res.status}): ${JSON.stringify(body.errors ?? body)}`);
    return body.data;
  }
}

async function fetchAllItems(token) {
  const nodes = [];
  let cursor = null;
  let pages = 0;
  let cost = 0;
  for (;;) {
    const data = await graphql(token, { id: PROJECT_ID, cursor });
    const items = data.node?.items;
    if (!items) throw new Error('Project not readable with this token');
    nodes.push(...items.nodes);
    pages++;
    cost += data.rateLimit?.cost ?? 0;
    if (!items.pageInfo.hasNextPage) break;
    cursor = items.pageInfo.endCursor;
  }
  console.log(`Fetched ${nodes.length} project items in ${pages} pages (GraphQL cost ${cost}).`);
  return nodes;
}

const readIfExists = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error('GH_TOKEN is not set');

  const statePath = join(opts.dataDir, 'state.json');
  const csvPath = join(opts.dataDir, 'transitions.csv');
  const reportPath = join(opts.dataDir, 'QA-METRICS.md');
  const prevStateText = readIfExists(statePath);
  const prevState = prevStateText ? JSON.parse(prevStateText) : null;

  const nodes = await fetchAllItems(token);
  const out = runSnapshot({ prevState, nodes, today: opts.today, prevCsv: readIfExists(csvPath) });

  console.log(`Sifa items in snapshot: ${Object.keys(out.state.items).length}.`);
  console.log(prevState ? `New transitions: ${out.newTransitions.length}.` : 'No previous state: baseline snapshot only.');
  if (opts.dryRun) {
    console.log('Dry run: nothing written.');
    return;
  }
  mkdirSync(opts.dataDir, { recursive: true });
  writeFileSync(statePath, serializeState(out.state));
  writeFileSync(csvPath, out.csv);
  writeFileSync(reportPath, out.report + '\n');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

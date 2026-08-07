#!/usr/bin/env node
// Cross-repo dependency graph for the sifa-* repos.
//
// Reads every repo's package.json, resolves @singi-labs/* deps to sibling
// repos, and reports edges, orphans, cycles, version drift, and internal
// deps that have no repo under any scanned root.
//
// Usage:
//   node scripts/dep-graph.mjs [--root <dir>]... [--ref <git-ref>] [--json|--mermaid] [--strict]
//
// Defaults: root = parent of this repo, scope = @singi-labs, manifests read
// from the working tree. Pass --ref origin/main (after fetching) when local
// checkouts may be stale.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIP_DIR_SUFFIXES = ['-worktrees', '-page-shots'];
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

function parseArgs(argv) {
  const opts = { roots: [], ref: null, prefix: 'sifa-', scope: '@singi-labs', format: 'text', strict: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root') opts.roots.push(argv[++i]);
    else if (arg === '--ref') opts.ref = argv[++i];
    else if (arg === '--prefix') opts.prefix = argv[++i];
    else if (arg === '--scope') opts.scope = argv[++i];
    else if (arg === '--json') opts.format = 'json';
    else if (arg === '--mermaid') opts.format = 'mermaid';
    else if (arg === '--strict') opts.strict = true;
    else if (arg === '--help' || arg === '-h') opts.format = 'help';
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

function defaultRoot() {
  // scripts/ -> repo root -> the directory holding all sifa-* repos
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    return { __error: err.message };
  }
}

// Working trees go stale, and a stale clone reports stale pins. --ref reads
// package.json out of a git ref instead, so the graph reflects what is on the
// branch rather than what happens to be checked out. Fetch first: this reads
// the local ref as-is and never touches the network.
function readManifestAtRef(repoDir, ref) {
  try {
    const out = execFileSync('git', ['-C', repoDir, 'show', `${ref}:package.json`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(out);
  } catch {
    return null;
  }
}

function originUrl(repoDir) {
  try {
    return execFileSync('git', ['-C', repoDir, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

// git@github.com:singi-labs/sifa-docs.git and
// https://github.com/singi-labs/sifa-docs.git are the same repo. Reduce both
// to host/owner/name so clones added over ssh and https still collapse.
function normalizeRemote(url) {
  if (!url) return null;
  return url
    .replace(/^[a-z+]+:\/\//i, '')
    .replace(/^[^@/]+@/, '')
    .replace(/:\d+\//, '/')
    .replace(/:(?=\D)/, '/')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

// Repos are scattered across roots on some machines (~/Documents/Git and ~/Git),
// so scan every root and merge. Identity is the origin remote, not the directory
// name: a second clone under a different name (sifa-page-deploy -> sifa-page)
// would otherwise show up as a phantom node with phantom edges and phantom
// drift. First clone found wins; the rest are reported, not silently dropped.
function discoverAll(roots, prefix, ref) {
  const seen = new Map();
  const duplicates = [];
  for (const root of roots) {
    for (const repo of discoverRepos(root, prefix, ref)) {
      const repoDir = join(root, repo.dir);
      const origin = normalizeRemote(originUrl(repoDir));
      const key = origin || `dir:${repo.dir}`;
      const existing = seen.get(key);
      if (existing) {
        duplicates.push({
          kept: join(existing.root, existing.dir),
          ignored: repoDir,
          reason: origin ? `same origin ${origin}` : 'same directory name',
        });
      } else {
        seen.set(key, { ...repo, root, origin });
      }
    }
  }
  return { repos: [...seen.values()].sort((a, b) => a.dir.localeCompare(b.dir)), duplicates };
}

// A repo is any immediate subdirectory holding a package.json. Repos without
// one (sifa-deploy, sifa-workspace) are still listed so gaps stay visible.
function discoverRepos(root, prefix, ref) {
  const entries = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => e.name.startsWith(prefix))
    .filter((e) => !SKIP_DIR_SUFFIXES.some((s) => e.name.endsWith(s)))
    .map((e) => e.name)
    .sort();

  return entries.map((dir) => {
    const repoDir = join(root, dir);
    const manifestPath = join(repoDir, 'package.json');

    if (ref) {
      const manifest = readManifestAtRef(repoDir, ref);
      if (!manifest) return { dir, name: dir, manifest: null, source: `${ref} (unavailable)` };
      return { dir, name: manifest.name || dir, manifest, manifestPath, source: ref };
    }

    if (!existsSync(manifestPath)) return { dir, name: dir, manifest: null, source: 'worktree' };
    const manifest = readJson(manifestPath);
    if (manifest.__error) return { dir, name: dir, manifest: null, error: manifest.__error, source: 'worktree' };
    return { dir, name: manifest.name || dir, manifest, manifestPath, source: 'worktree' };
  });
}

function collectDeps(manifest) {
  const deps = new Map(); // pkg -> { range, fields[] }
  for (const field of DEP_FIELDS) {
    for (const [pkg, range] of Object.entries(manifest[field] || {})) {
      const existing = deps.get(pkg);
      if (existing) existing.fields.push(field);
      else deps.set(pkg, { range, fields: [field] });
    }
  }
  return deps;
}

function buildGraph(repos, scope) {
  const byPkgName = new Map(repos.filter((r) => r.manifest).map((r) => [r.name, r]));

  const edges = [];
  const unresolved = [];
  const pins = new Map(); // pkg -> [{ from, range, field }]

  for (const repo of repos) {
    if (!repo.manifest) continue;
    for (const [pkg, { range, fields }] of collectDeps(repo.manifest)) {
      if (!pkg.startsWith(`${scope}/`)) continue;
      pins.set(pkg, [...(pins.get(pkg) || []), { from: repo.dir, range, field: fields[0] }]);

      const target = byPkgName.get(pkg);
      if (target) {
        edges.push({ from: repo.dir, to: target.dir, pkg, range, field: fields[0] });
      } else {
        unresolved.push({ from: repo.dir, pkg, range, field: fields[0] });
      }
    }
  }

  // Version drift: one internal package pinned at differing ranges.
  const drift = [];
  for (const [pkg, sites] of pins) {
    const ranges = [...new Set(sites.map((s) => s.range))];
    if (ranges.length > 1) drift.push({ pkg, ranges, sites });
  }

  const connected = new Set(edges.flatMap((e) => [e.from, e.to]));
  const orphans = repos.filter((r) => r.manifest && !connected.has(r.dir)).map((r) => r.dir);
  const noManifest = repos.filter((r) => !r.manifest).map((r) => r.dir);

  return { repos, edges, orphans, unresolved, drift, noManifest, cycles: findCycles(repos, edges) };
}

// Depth-first cycle detection over the repo-level edge set.
function findCycles(repos, edges) {
  const adjacency = new Map(repos.map((r) => [r.dir, []]));
  for (const e of edges) adjacency.get(e.from)?.push(e.to);

  const cycles = [];
  const state = new Map(); // dir -> 'visiting' | 'done'

  function visit(node, path) {
    if (state.get(node) === 'visiting') {
      cycles.push([...path.slice(path.indexOf(node)), node]);
      return;
    }
    if (state.get(node) === 'done') return;
    state.set(node, 'visiting');
    for (const next of adjacency.get(node) || []) visit(next, [...path, node]);
    state.set(node, 'done');
  }

  for (const repo of repos) visit(repo.dir, []);
  return cycles;
}

function renderText(graph, roots, scope, ref) {
  const lines = [];
  const withManifest = graph.repos.filter((r) => r.manifest).length;
  lines.push('Dependency graph');
  for (const root of roots) lines.push(`  root: ${root}`);
  lines.push(`  read from: ${ref || 'working tree'}`);
  lines.push(`${withManifest} package(s), ${graph.edges.length} edge(s), scope ${scope}/*`);
  lines.push('');

  lines.push('Edges');
  if (graph.edges.length === 0) lines.push('  (none)');
  for (const e of graph.edges) {
    const dev = e.field === 'devDependencies' ? ' [dev]' : '';
    lines.push(`  ${e.from} -> ${e.to}  (${e.pkg}@${e.range})${dev}`);
  }

  if (graph.drift.length) {
    lines.push('');
    lines.push('Version drift');
    for (const d of graph.drift) {
      lines.push(`  ${d.pkg} pinned at ${d.ranges.length} different ranges:`);
      for (const s of d.sites) lines.push(`    ${s.range}  <- ${s.from}`);
    }
  }

  if (graph.unresolved.length) {
    lines.push('');
    lines.push('Internal deps with no repo under any scanned root');
    for (const u of graph.unresolved) lines.push(`  ${u.pkg}@${u.range}  <- ${u.from}`);
  }

  if (graph.duplicates.length) {
    lines.push('');
    lines.push('Duplicate clones (first one found wins)');
    for (const d of graph.duplicates) {
      lines.push(`  ignored ${d.ignored}`);
      lines.push(`     kept ${d.kept}  (${d.reason})`);
    }
  }

  if (graph.orphans.length) {
    lines.push('');
    lines.push('Orphans (no internal dep in or out)');
    for (const o of graph.orphans) lines.push(`  ${o}`);
  }

  if (graph.noManifest.length) {
    lines.push('');
    lines.push('No package.json (not graphed)');
    for (const n of graph.noManifest) lines.push(`  ${n}`);
  }

  if (graph.cycles.length) {
    lines.push('');
    lines.push('Cycles');
    for (const c of graph.cycles) lines.push(`  ${c.join(' -> ')}`);
  }

  return lines.join('\n');
}

function renderMermaid(graph) {
  const lines = ['graph LR'];
  for (const repo of graph.repos.filter((r) => r.manifest)) {
    lines.push(`  ${repo.dir.replace(/-/g, '_')}["${repo.dir}"]`);
  }
  for (const e of graph.edges) {
    lines.push(`  ${e.from.replace(/-/g, '_')} --> ${e.to.replace(/-/g, '_')}`);
  }
  return lines.join('\n');
}

const HELP = `Cross-repo dependency graph for the sifa-* repos.

  node scripts/dep-graph.mjs [options]

  --root <dir>     Directory holding the repos; repeatable
                   (default: parent of this repo)
  --ref <git-ref>  Read package.json from a git ref instead of the working
                   tree, e.g. origin/main. Fetch first; this never uses
                   the network.
  --prefix <str>   Repo directory prefix to scan (default: sifa-)
  --scope <scope>  Package scope treated as internal (default: @singi-labs)
  --json           Machine-readable output
  --mermaid        Mermaid diagram for docs
  --strict         Exit 1 if drift, unresolved internal deps, or cycles exist
`;

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.format === 'help') {
    process.stdout.write(HELP);
    return;
  }

  const roots = (opts.roots.length ? opts.roots : [defaultRoot()]).map((r) => resolve(r));
  const missing = roots.filter((r) => !existsSync(r));
  if (missing.length) {
    console.error(`Root not found: ${missing.join(', ')}`);
    process.exit(2);
  }

  const { repos, duplicates } = discoverAll(roots, opts.prefix, opts.ref);
  if (repos.length === 0) {
    console.error(`No "${opts.prefix}*" repos found under ${roots.join(', ')}`);
    process.exit(2);
  }

  // A typo'd ref resolves nowhere and would otherwise render as a clean empty
  // graph. Fail instead of reporting "no dependencies" for a bad input.
  if (opts.ref && !repos.some((r) => r.manifest)) {
    console.error(`No package.json readable at ref "${opts.ref}" in any repo. Wrong ref, or fetch needed?`);
    process.exit(2);
  }

  const graph = { ...buildGraph(repos, opts.scope), duplicates };

  if (opts.format === 'json') {
    process.stdout.write(`${JSON.stringify({ roots, ref: opts.ref, scope: opts.scope, ...graph, repos: graph.repos.map(({ manifest, ...r }) => r) }, null, 2)}\n`);
  } else if (opts.format === 'mermaid') {
    process.stdout.write(`${renderMermaid(graph)}\n`);
  } else {
    process.stdout.write(`${renderText(graph, roots, opts.scope, opts.ref)}\n`);
  }

  if (opts.strict && (graph.drift.length || graph.unresolved.length || graph.cycles.length)) {
    process.exit(1);
  }
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(2);
}

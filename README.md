<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/singi-labs/.github/main/assets/sifa-logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/singi-labs/.github/main/assets/sifa-logo-light.svg">
  <img alt="Sifa Logo" src="https://raw.githubusercontent.com/singi-labs/.github/main/assets/sifa-logo-dark.svg" width="120">
</picture>

# Sifa Workspace

**Project coordination and issue tracking for the Sifa professional network.**

[![Status: Alpha](https://img.shields.io/badge/status-alpha-orange)]()

</div>

---

## Overview

Central coordination repository for the [Sifa](https://sifa.id) professional network. All ideas, bugs, and feature requests are tracked in this repo's [GitHub Issues](https://github.com/singi-labs/sifa-workspace/issues). Contains project-level documentation, architecture decisions, and cross-repo coordination.

---

## Architecture

```
User's PDS (data lives here)
├── id.sifa.profile.*     Professional profile (positions, education, skills)
├── id.sifa.graph.follow   One-way professional follows
├── id.sifa.endorsement    Skill endorsements (mutual confirmation)
└── app.bsky.*             Social data (imported read-only)

Sifa AppView (reads and aggregates)
├── sifa-api               Fastify backend, Jetstream consumer, OAuth provider
├── sifa-web               Next.js frontend, SSR profile pages
└── sifa-deploy            Docker Compose + Caddy reverse proxy
```

---

## Repositories

| Repository                                                           | Description                                    |
| -------------------------------------------------------------------- | ---------------------------------------------- |
| sifa-api                                                             | AppView backend (Fastify, AT Protocol)         |
| sifa-web                                                             | Frontend (Next.js, React, TailwindCSS)         |
| [sifa-lexicons](https://github.com/singi-labs/sifa-lexicons)       | AT Protocol professional profile schemas (MIT) |
| sifa-deploy                                                          | Docker Compose + Caddy deployment config       |

### Dependency graph

`scripts/dep-graph.mjs` maps how the `sifa-*` repos depend on each other. It reads
each repo's `package.json`, resolves `@singi-labs/*` deps to sibling repos, and
reports edges, orphans, cycles, version drift, duplicate clones, and internal
deps with no repo checked out locally. No dependencies, no state written, no
network access.

```bash
# fetch first so origin/main is current, then read from the branch
# rather than from whatever happens to be checked out
git -C <each repo> fetch origin main
node scripts/dep-graph.mjs --root ~/Documents/Git --root ~/Git --ref origin/main
```

| Flag | Effect |
| ---- | ------ |
| `--root <dir>` | Directory holding the repos; repeatable (default: parent of this repo) |
| `--ref <git-ref>` | Read `package.json` from a git ref, e.g. `origin/main`, instead of the working tree |
| `--prefix <str>` | Repo directory prefix to scan (default: `sifa-`) |
| `--scope <scope>` | Package scope treated as internal (default: `@singi-labs`) |
| `--json` | Machine-readable output |
| `--mermaid` | Mermaid diagram for docs |
| `--strict` | Exit 1 on drift, unresolved internal deps, or cycles |

Two things worth knowing:

- **Pass `--ref origin/main`.** Reading the working tree reports whatever a local
  clone happens to be at, which on a machine with stale checkouts produces
  drift numbers that are simply wrong.
- **Pass every root.** Repos are not all under one directory on every machine.
  Clones are de-duplicated by their `origin` remote rather than directory name,
  so a second clone under a different name is reported instead of appearing as
  a phantom project with phantom edges.

Use `--strict` in CI to catch SDK version drift before it reaches a release.

---

## Tech Stack

- **Runtime:** Node.js 26 / TypeScript (strict)
- **API:** Fastify 5 / Drizzle ORM / PostgreSQL 17 / Valkey 8
- **Frontend:** Next.js 16 / React 19 / TailwindCSS / shadcn/ui
- **Protocol:** @atproto/oauth-client-node / Jetstream WebSocket / PDS applyWrites
- **i18n:** next-intl (English, Dutch, German, French, Spanish, Portuguese)
- **Deploy:** Docker / GitHub Actions / Caddy

---

---

## Part of Singi Labs

Sifa is built by [Singi Labs](https://singi.dev), alongside [Barazo](https://barazo.forum) (federated forum on AT Protocol). The two products share a flywheel: Barazo community participation builds verifiable professional track records that appear on Sifa profiles.

---

## Community

- **Website:** [sifa.id](https://sifa.id)
- **Bluesky:** [@sifa.id](https://bsky.app/profile/sifa.id)
- **Issues:** [Report bugs or request features](https://github.com/singi-labs/sifa-workspace/issues)

---

## License

The `id.sifa.*` lexicons are open source under the MIT license. See [sifa-lexicons](https://github.com/singi-labs/sifa-lexicons) for details.

---

Made with ♥ in 🇪🇺 by [Singi Labs](https://singi.dev)

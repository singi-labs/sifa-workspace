<div align="center">

# Sifa

**Professional identity and career network on the AT Protocol.**

[![Status: Alpha](https://img.shields.io/badge/status-alpha-orange)]()
[![License: Source Available](https://img.shields.io/badge/License-Source--Available-blue)]()

</div>

---

## Overview

Sifa is a decentralized professional network built on the [AT Protocol](https://atproto.com/). Portable profiles, verifiable track records from real community contributions, no vendor lock-in. A LinkedIn alternative where you own your data.

**Domain:** [sifa.id](https://sifa.id) | **Namespace:** `id.sifa.*`

---

## Repositories

| Repository | Description | License |
|------------|-------------|---------|
| [sifa-workspace](https://github.com/singi-labs/sifa-workspace) | Project coordination and issue tracking | Source-available |
| [sifa-api](https://github.com/singi-labs/sifa-api) | AppView backend (Fastify, AT Protocol, Jetstream) | Source-available |
| [sifa-web](https://github.com/singi-labs/sifa-web) | Frontend (Next.js, React, TailwindCSS) | Source-available |
| [sifa-deploy](https://github.com/singi-labs/sifa-deploy) | Docker Compose + Caddy deployment config | Source-available |
| [sifa-lexicons](https://github.com/singi-labs/sifa-lexicons) | Professional profile lexicon schemas | MIT |

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

## Tech Stack

- **Runtime:** Node.js 25 / TypeScript (strict)
- **API:** Fastify 5 / Drizzle ORM / PostgreSQL 17 / Valkey 8
- **Frontend:** Next.js 15+ / React 19 / TailwindCSS / shadcn/ui
- **Protocol:** @atproto/oauth-client-node / Jetstream WebSocket / PDS applyWrites
- **i18n:** next-intl (English, Dutch, German, French, Spanish, Portuguese)
- **Deploy:** Docker / GitHub Actions / Caddy

---

## Development

Each repository is independent (no monorepo). Clone and develop separately:

```bash
# Clone repos
git clone https://github.com/singi-labs/sifa-api.git
git clone https://github.com/singi-labs/sifa-web.git
git clone https://github.com/singi-labs/sifa-deploy.git

# API development
cd sifa-api
npm install
docker compose -f docker-compose.dev.yml up -d   # PostgreSQL + Valkey
npm run dev

# Web development (separate terminal)
cd sifa-web
npm install
npm run dev
```

---

## Issues

All ideas, bugs, and feature requests are tracked in this repo's [GitHub Issues](https://github.com/singi-labs/sifa-workspace/issues).

---

## Part of Singi Labs

Sifa is built by [Singi Labs](https://singi.dev), alongside [Barazo](https://barazo.forum) (federated forum on AT Protocol). The two products share a flywheel: Barazo community participation builds verifiable professional track records that appear on Sifa profiles.

---

## License

- **Lexicons + import tools:** MIT
- **Application code:** Source-available (public repo, proprietary license)

See individual repository LICENSE files for details.

---

(c) 2026 Singi Labs

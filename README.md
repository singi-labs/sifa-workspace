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

---

## Tech Stack

- **Runtime:** Node.js 25 / TypeScript (strict)
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
- **Discussions:** [GitHub Discussions](https://github.com/orgs/singi-labs/discussions)
- **Issues:** [Report bugs or request features](https://github.com/singi-labs/sifa-workspace/issues)

---

## License

The `id.sifa.*` lexicons are open source under the MIT license. See [sifa-lexicons](https://github.com/singi-labs/sifa-lexicons) for details.

---

Made with ♥ in 🇪🇺 by [Singi Labs](https://singi.dev)

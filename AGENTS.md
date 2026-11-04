# Daisy engineering map

This file is the index: the few rules that bind before you read anything else,
then where everything lives. Read the linked document for your work before you
start; it is binding. Keep this file thin: a new rule or procedure goes in its
owning document, and this file gains at most a link. It is the only
agent-facing operating map; never fork it into a second top-level agent
document (CLAUDE.md and friends).

## Always

- Bun only, from the repository root (1.4.2, pinned): never npm, npx, yarn, or
  pnpm. Use `bun run test` and `bun run build`; the built-ins bypass the
  machine-wide heavy queue.
- An owner instruction to implement an outcome authorizes discovery, planning,
  task administration, delegation, building, reviews and fixes within it. A
  planning-only request stays planning-only.
- Builders never merge, and only main receives merged PRs.
- Production identity, secrets, deployment and data actions keep human sign-off.
- Never commit `.env`, `.env.agent`, secrets, generated build output, or `.pu/`
  runtime state (only `.pu/config.yaml` and `.pu/agent-context.md` are
  committed).

## Where things live

| When you are                             | Read                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Making any change, plan or review        | **Architecture rules** (blockers), dependency rules and engineering constraints: [engineering rules](docs/architecture/rules.md)                                                                                                                                                                                                     |
| Placing code or adding a package         | [Architecture overview](docs/architecture/overview.md), [extending the repository](docs/development/extending.md), [dependency registry](docs/dependencies.md)                                                                                                                                                                       |
| Delivering a slice or epic               | [The slice process](docs/development/agent-pipeline.md), skills [epic-pipeline](.claude/skills/epic-pipeline/SKILL.md) and [task](.claude/skills/task/SKILL.md), [ADR 0083](docs/decisions/0083-lean-gates-and-slice-process.md)                                                                                                     |
| Using the board, drive or Issues; filing | [Work management](docs/development/work-management.md)                                                                                                                                                                                                                                                                               |
| Running several agents; merging          | [pu workflow](docs/development/pu-workflow.md) (owner and autonomous modes), [parallel work](docs/development/parallel-work.md)                                                                                                                                                                                                      |
| Reviewing a PR                           | [Reviews](docs/development/reviews.md)                                                                                                                                                                                                                                                                                               |
| Setting up, or choosing a command        | [Local development](docs/development/local-development.md)                                                                                                                                                                                                                                                                           |
| Writing tests                            | [Testing](docs/development/testing.md)                                                                                                                                                                                                                                                                                               |
| Building UI                              | [UI conventions](docs/development/ui-conventions.md)                                                                                                                                                                                                                                                                                 |
| Touching the schema or stored data       | [Persistence](docs/architecture/persistence.md), [database operations](docs/operations/database.md), [compliance](docs/operations/compliance.md)                                                                                                                                                                                     |
| Checking a policy decision               | [Identifiers](docs/decisions/0018-cuid2-identifiers.md), [tokens and secrets](docs/decisions/0019-token-secret-ownership.md), [auth activation](docs/decisions/0020-auth-activation-gates.md), [AIDD overrides](docs/decisions/0021-repository-aidd-overrides.md), [greenfield baseline](docs/decisions/0023-greenfield-baseline.md) |
| Looking deeper                           | `docs/architecture/`, `docs/domains/`, `docs/development/`, `docs/operations/`, `docs/decisions/`                                                                                                                                                                                                                                    |

## Repository shape

Bun workspaces plus Turborepo; one modular monolith. `apps/web` owns Next.js
routes and feature-local application operations. `packages/debate-engine` is
the framework-free domain, `packages/protocol` owns portable versioned JSON
contracts, `packages/db` owns PostgreSQL, and `packages/redis` owns expendable
Redis state.

## Commands

```sh
bun install --frozen-lockfile && cp .env.example .env   # first time
bun slot:up        # this checkout's databases, namespaces and ports
bun doctor         # should pass before service-based work
bun check:affected # the fast inner loop
bun check          # the blocking gates, as in CI
```

## Addresses

Skills and docs refer here for these ids.

- **Drive:** Daisy Debate `lguvh1y1ejhadk96xcftohha`. Start at Product → Project
  Status `qndsohpp7nihje7a2dw3a2kl`, then the area's Product intent page.
- **Delivery channel** `ijy2klr2s7g77351a0zilrol`: plans, questions, decisions
  and status (see the commands below).
- **Incidents channel** `h72n2om8p0oq3y3h6nfjy1pm`: main red, staging down and
  security reports.

```sh
pagespace channels send ijy2klr2s7g77351a0zilrol "<slice>: <message>"
pagespace pages read ijy2klr2s7g77351a0zilrol   # newest lines last
```

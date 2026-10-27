# Parallel worktree workflow

`pu` is the orchestration tool whenever more than one agent works, or when
work needs an isolated worktree. Direct single-agent work may proceed without
it. The delivery process itself is [the slice process](agent-pipeline.md).

## Two modes

- **Owner.** The owner's own sessions use the owner's GitHub identity and may
  merge any PR at any time.
- **Autonomous.** Every agent `pu` starts runs through
  `scripts/agent-launch.sh` (configured in the committed `.pu/config.yaml`).
  - The launcher exports the machine identity from the main checkout's
    `.env.agent` and sets `DAISY_AUTONOMOUS=1`.
  - `gh` and `git push` then act as the machine user over HTTPS, never with
    the owner's keyring token or SSH key.
  - `bun doctor` fails if an autonomous session resolves to the owner.
  - Until the owner creates `.env.agent` (GRD-6.2), the launcher starts
    agents as the owner with a warning, and `bun doctor` warns.

## Spawning and messaging

```text
pu spawn --agent claude --name <slice> "<mission brief>"
pu spawn --agent claude -w <worktreeId> "/review <PR url>"
pu send <agent> "<text>"
pagespace channels send <Delivery channel id> "<slice>: <text>"
pagespace pages read <Delivery channel id>
pu status | pu logs <agent> | pu attach <agent>
pu kill --agent <agent> && pu clean
```

AGENTS.md ("Channels") names the Delivery and Incidents channel ids.

- **One builder per slice.** The point guard spawns one Claude builder for
  each semantic slice, in its own worktree. Claude is required because its
  PR loop, PR Loop (Ralph Loop), runs on Claude Code's Stop hook.
- **Mission-only briefs.** The brief states only:
  - the outcome;
  - the owning intent pages and ADRs;
  - the PRs and branches the slice inherits;
  - the autonomy rules.
- **Reviewers join the builder's worktree** with `-w`. They stay read-only
  and are killed once they have posted.
- **Code-writing help** is a `pu` child in its own worktree.
  Worktree-isolated subagents and forks are for read-only research and
  review.
- **Services.** Run `bun install --frozen-lockfile` and `bun slot:up` in a
  worktree when the work needs dependencies or services
  ([ADR 0034](../decisions/0034-shared-stack-slots.md)).
- **Channel traffic.** Plans, decisions, the architecture reviewer and the
  point guard's confirmations go through the PageSpace Delivery channel;
  incidents go to Incidents. The pu channel is retired. Agents report to
  whoever spawned them, so the owner never relays status.

## Pull requests and merges

- **Opening.** Builders open one PR per slice with `/pr` and hand off with
  `/handoff`.
- **Converging.** The builder runs its harness's PR loop verbatim until it
  emits `PR_READY`: PR Loop (Ralph Loop) `cvslieavdwwkbz8l551hhhsz` for
  Claude Code, PR Loop (Goal) `asdc6hmpbeyu9ujlqrnes1oc` for Codex and
  opencode, both in Resources › Universal prompts.
- **Merging.** Builders never merge. Only main receives merged PRs, and no
  PR is ever merged into another branch.
  - The point guard's flow sweep merges a PR when its builder has emitted
    `PR_READY` and the required checks (CI gate, Playwright E2E, Isolated
    Room Launch E2E) are green at the exact head.
  - The sweep merges at most two PRs per cycle.
  - After a batch, the point guard runs a local typecheck and knip on main.
- **After a merge.** The tasks the PR names move to Done when its latest
  review verdict approves ([reviews](reviews.md)); otherwise they move to
  Merged.

## Acceptance criteria

- Given a slice, should be built by one Claude builder in its own worktree
  and delivered as one PR, with status and logs discoverable through
  `pu status` and `pu logs`.
- Given an open slice PR, should get `/review` and `/code-review` reviewers
  spawned into the builder's worktree, which post PR comments and are then
  killed.
- Given a PR whose builder emitted `PR_READY` with green required checks at
  its head, should be merged by the flow sweep, while the owner may merge
  any PR at any time.
- Given completed or abandoned work, should use `pu kill` followed by
  `pu clean`.
- Given direct single-agent work, should be allowed to proceed without `pu`.

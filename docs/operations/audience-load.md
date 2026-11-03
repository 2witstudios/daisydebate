# Audience load against a live debate

The promise this checks: viewers can never hurt the debate. `scripts/audience-load.ts`
drives the audience's poll routes at a stated rate, and its `floor` command reads the
existing floor logs, so one debate's timing can be compared with and without an audience.

## What the driver sends

`--viewers N` is N requests a second: each viewer polls
`GET /api/rounds/:id/timeline` and `GET /api/rounds/:id/audience` (chat, reactions and
the count) every 2 s, as the page does. It is open loop and sends no cookie, as a viewer
of a public Round does. It refuses every origin but local and staging.

## The comparison

Run one live, human, public Round with a Broadcast through both windows, on the same
deployment, keeping the logs of each.

1. **Without load.** For at least 5 minutes of speeches:
   `fly logs -a daisy-debate-staging -j > baseline.log` (locally, keep the server's
   stdout).
2. **With load.** Same Round, same length, with the log kept in `loaded.log`:
   `bun scripts/audience-load.ts --origin https://beta.daisydebate.com --round <roundId> --viewers 1000 --seconds 300`
3. **Read both.** `bun scripts/audience-load.ts floor baseline.log`, then `loaded.log`.

## What to read

| Field                       | Log event                   | What it says                                                                       | Viewers did no harm when              |
| --------------------------- | --------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------- |
| `passMs`                    | `round.media.floor_pass`    | How long a tick's pass for a due floor took (`durationMs`)                         | p99 stays near the baseline           |
| `failedPasses`              | `round.media.floor_pass`    | Passes that carried a failure `cause`                                              | Stays at the baseline, normally zero  |
| `waitingByCause`            | `round.media.floor_waiting` | Why a due floor did not start a pass: `lease`, `interval`, `running` or `capacity` | `running` and `capacity` do not rise  |
| `tickMs`                    | `round.media.floor_tick`    | How long a tick took to read its sessions                                          | p99 stays near the baseline           |
| `refusedByLane.audience`    | `db.capacity.refused`       | Viewers refused: the audience lane full                                            | May be any number: this is the design |
| `refusedByLane.competitive` | `db.capacity.refused`       | Debate work refused                                                                | Stays at the baseline, normally zero  |

The driver's own output says what viewers got: `statuses["200"]` answered,
`statuses["503"]` refused and told when to come back, `statuses["0"]` never answered, and
`answeredMs` how long an answer took. A rising `0` count or `answeredMs` with a flat
database is the process itself saturating, not a lane.

## What the lanes do not cover

The audience lane and the per-Round cache keep viewers from the database's competitive
connections. Every poll still runs through the web process that also runs debates: its
proxy, route handling and request log. `passMs` and `tickMs` rising while
`refusedByLane.competitive` stays flat means that shared process is the limit, and the
remedy is outside the database: answer polls before they reach Next, put a CDN in front
of the cacheable answers, or take the audience to its own machines.

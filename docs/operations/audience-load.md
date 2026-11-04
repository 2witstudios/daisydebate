# Audience load against a live debate

The promise this checks: viewers can never hurt the debate. A viewer's polls read the publisher's
state from the public bucket (ADR 0112). A page load meets the web gate first (ADR 0116). What still
reaches web is a cache miss, one sampled pulse, and requests within the gate's budgets.

## What the driver sends

`scripts/audience-load.ts` loads `/watch/:id` at `--viewers N` divided by `--every-seconds` (2 by default) requests a second, open loop, with no cookie, from one source. Run it from several machines
to stand in for separate addresses. It refuses every origin but local and staging.

## The comparison

Run one live, human, public Round with a Broadcast through both windows, on the same
deployment, keeping the logs of each.

1. **Without load.** For at least 5 minutes of speeches, keep the log in `baseline.log`.
2. **With load.** Same Round, same length, in `loaded.log`, sending page loads as well
   as direct requests, with seats joining during the burst.
3. **Read both.** `bun scripts/audience-load.ts floor baseline.log`, then `loaded.log`.

A floor pass is logged only when a floor is due, so a window with no speech boundary
has no passes to compare. Hold the window across at least two.

## What to read

| Field                       | Log event                   | What it says                                           |
| --------------------------- | --------------------------- | ------------------------------------------------------ |
| `passMs`                    | `round.media.floor_pass`    | How long a tick's pass for a due floor took            |
| `failedPasses`              | `round.media.floor_pass`    | Passes that carried a failure `cause`. The bar is zero |
| `waitingByCause`            | `round.media.floor_waiting` | Why a due floor did not start a pass                   |
| `tickMs`                    | `round.media.floor_tick`    | How long a tick took to read its sessions              |
| `refusedByLane.competitive` | `db.capacity.refused`       | Debate work refused. The bar is zero                   |

Read seat audio and rejoin from the seats' own browsers. The floor logs cannot show them.

## What stands in front

The web gate (ADR 0116) answers cached Watch pages and refuses past its budgets before web. In
the driver's output `429` is one address past its budget and `503` is the anonymous lane full, and
neither reached web. A rising `0` count or `answeredMs` reads as the machine or the gate.
`passMs` and `tickMs` rising with `refusedByLane.competitive` flat means web's process is still the
limit, so read how many requests reached it.

# Audience load against a live debate

The promise this checks: viewers can never hurt the debate. It holds for polls and not yet
for a burst of page loads (below). A viewer's polls read the publisher's state from the public bucket (ADR 0112), so they never reach web.
What still reaches web is the first page load, one sampled pulse, and anyone's direct
request, and `fly.toml` limits how many of those run at once.

## What the driver sends

`scripts/audience-load.ts` sends `--viewers N` requests a second to the web routes it
is told to, open loop, with no cookie, from one source. Run it from several machines
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

## What the limit does not cover

The connection limit in `fly.toml` protects the process by turning traffic away, and a
seat's requests share those slots with everyone's. It does not stop a page-load crowd from
hurting a debate. The one rerun, with 1,000 page loads a second from three regions for
150 s, broke the promise above (the proof page, Page loads beside a live debate).

Polls no longer reach web. A flash crowd of first page loads still does, because each one
renders on web and reads the database. This release accepts that limit. The fix and a rerun
at a lower rate, to find where harm begins, are on the Before a tournament checklist. An edge
per-address limit does not cover it, because a real crowd comes from many addresses.

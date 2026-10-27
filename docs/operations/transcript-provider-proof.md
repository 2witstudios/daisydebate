# Staging transcript provider proof

ISSUE-478 runs against the deployed Fly staging web app and capture worker,
with their real speech, TTS and STT providers. The manual **Staging transcript
provider proof** workflow accepts only a full deployed SHA, runs from `main`,
and has no production target. It does not deploy either service.

Before dispatch, coordinate with the judging lane in the PurePoint channel and
wait for the staging deploy to finish. Supply that release's full 40-character
SHA as `deployed_sha`. The workflow checks the capture worker's actual image
environment, then pipes a Bun bundle into the staging web machine. The bundle
checks its Fly app, public origin, actual image SHA, database URL and server-side
`current_database()` before writing anything. Keys, connection strings, signed
cookies, PCM and transcript text never leave Fly. Only closed metadata phases
and proof counts appear in the workflow summary.

The dedicated synthetic identity is `transcript-proof@example.test`, username
`staging-transcript-proof`. Orchestrator authorization is PurePoint channel
579 (2026-10-27), scoped to staging; channel 662 moved it onto the flat
DEC-183 beta cap (ISSUE-646). The fixture uses the existing username, age-step
and audited beta-access command operations. As an approved beta host it gets
the configured `AI_ROUND_MONTHLY_CAP` (20 by default) for the current UTC
calendar month through the normal admission policy; no grant or quota row is
written. It never resets usage, refunds a successful practice, alters the
attendance probe or grants coaching. Revoked access is refused. Each run makes
one CSPRNG session, valid for fifteen minutes, and removes its own session in
`finally`; an interrupted process's session expires normally. The identity and
completed evidence Rounds remain available for audit under the existing
account/utterance retention policies.

The runner holds a session advisory lock and refuses any existing live AI
reservation. The public application API still enforces the normal shared bot
capacity and allowance admission. It creates one unlisted custom foundation
Room: two one-minute speeches, one distinct bot per debater seat and a third
bot judge. Prep is disabled. It starts and observes the actual Round rather
than injecting speech, provider replies, coverage or freeze rows. A run consumes
one normal AI practice and must finish within seven minutes.

Passing requires decisive completion, a submitted AI ballot, a COMPLETE frozen
transcript, exactly the two expected debater streams sealed complete, captured
text and observed/credited publication time for both seats, and received real
OpenRouter speech and TTS accounting. STT evidence is captured utterance/coverage
from the deployed native worker, whose production path calls Whisper through
OpenRouter; it is not a separate provider billing receipt. The summary names
the Round, Room, release SHA, frontier, stream counts and each condition.

This is a deployed bot publication proof across all configured speaking grants.
The separate `bun proof:media-worker` fixture covers native human publishers and
honest silence on an isolated local database. The staging runner does not run
that fixture against staging data. Neither proof asserts video recording,
archive storage, retention of media, soak behavior or every revocation race.

For an authorized ad hoc run, bundle `scripts/staging-transcript-proof.ts` with
`bun build --target=bun --packages=external`, verify the capture worker release
as the workflow does, then pipe the bundle into:

```sh
fly ssh console -a daisy-debate-staging -C "bun - <full-deployed-sha>"
```

Record the source candidate SHA as well as the deployed SHA, Round ID, metadata
result and execution URL/time in the PageSpace handoff/review. A refusal or
incomplete freeze is a failed proof. Coordinate capacity release afterwards;
do not delete or rewrite competitive evidence to manufacture a pass.

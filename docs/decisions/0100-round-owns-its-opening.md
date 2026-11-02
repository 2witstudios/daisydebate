# 0100: A Round owns its strike and pre-round prep

Status: accepted (owner, 2026-11-01 and 2026-11-02). Supersedes
[ADR 0058](0058-one-round-model.md) §3's "`preRoundPrep` is Room-executed",
[ADR 0076](0076-pre-round-resolution-draw.md)'s Room-owned draw and
`start-pre-round`, [ADR 0053](0053-live-video-self-hosted-livekit.md)'s camera grant during
pre-round prep, and DEC-214's start horizon. Overrules DEC-263.

## Decision

The Room assembles and the Round plays. When every human is Ready, the host's
one Start round creates the Round, and everything after that runs on its own:

```text
Start round → strike → reveal → prep → countdown → first speech
```

Each step appears only if configured. Freestyle runs them all, Policy and Value
go straight to the countdown, and Custom runs what it enables. Round status
`opening` replaces `scheduled`, and a Round with nothing to run first is created
`active`. `start-pre-round`, `finish-prep`, the Round's `start` command and the
start horizon no longer exist.

- **The opening is derived.** A Round stores its Start round instant, its draw
  and its prep length. Every other fact comes from `settleOpening`, so a
  command, a read and the maintenance sweep cannot disagree. It sits beside
  `RoundRules`, not in them, and the speech clock does not see it.
- **Instants, not processing times.** A strike is stamped at its due instant and
  the Round starts at the instant its opening ended, so a late sweep cannot move
  the countdown.
- **Ready is asked once and is binding.** It accepts the format with the
  resolution unknown; striking is a debater's say over the topic. A second Ready
  would let someone back out after seeing the topic.
- **Prep always runs its full length.** Nobody can end it early, and its expiry
  starts the countdown with no action from anyone. A casual host sets it before
  Start; a ranked Round uses its preset.
- **Prep is private.** Every mic and camera closes, and they reopen at the
  countdown. Debaters get their documents; judges and spectators get the
  resolution and the clock. In-round prep keeps its own rules.
- **Starting commits.** Once the Round exists the Room takes no close, seat edit
  or Ready. Leaving the tab costs nothing, a missed strike is struck
  automatically, and absence settles at the first speech under the existing
  attendance rules.
- **A forfeit in the opening stands as a result.** The Round starts and completes
  at that instant. Before a reveal it has no resolution: `rounds.resolution` is
  null in the opening and stays null on such a Round, and it is never null on an
  active one, by CHECK.
- **Bot capacity and allowance are held from Start round.** Refusing a Round at
  the end of prep is worse than an idle slot, and bots may later use prep.

## Why

The Room setup page offered Start round while the next real step was a small
"Draw the resolutions" button, and a host clicked three starts to reach the
first speech. No Round existed until after prep, so a ranked host could see the
resolution and close the Room with no result recorded.

## Consequences

- Draw rows move to `round_resolution_draws`, `round_resolution_draw_items` and
  `round_resolution_strikes`, written with the Round. The seed, texts and private
  inputs stay in their existing Round tables, now written at Start round rather
  than copied at Launch.
- One forward migration, with no expand and contract. `scheduled` Rounds past the
  old 15-minute horizon are abandoned and the rest become `active`; an open Room
  that had begun a draw or prep starts over with Ready cleared. The Room draw
  tables are dropped, because launched Rounds already hold their evidence. It
  needs a quiet deploy window.
- A prep-holding bot Round occupies a global capacity slot for the whole clock, so
  the busy cap must be sized for it.
- Strike moves from the Room page to the Round room, with its form still working
  without JavaScript.

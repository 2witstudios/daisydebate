# 0096: Cross-examination has open microphones and no interruptions

Status: accepted (owner, 2026-11-01). Supersedes the `crossExModes[]` capability
and the "during cross-examination only" interruption state named in
[ADR 0058](0058-one-round-model.md) and [ADR 0078](0078-standard-formats-league-templates.md).

## Decision

Cross-examination is a conversation. For the whole segment every seated
debater has a microphone and nobody takes the floor. This follows from the
segment type, so no format, Room or Round chooses it: `crossExMode` and
`crossExModes` no longer exist.

Interruption describes speeches only. Its policy has three states: `disabled`,
`enabled` and `open`. The `interrupt` command is refused during
cross-examination under every policy, and `cross_ex_only` no longer exists.
Stored `cross_ex_only` values became `disabled`, because that one interruption
was all they allowed.

The scheduled seat, the questioner, still ends a cross-examination early.

## Why

Under the old default, `ordered`, only the questioner had a microphone, so the
respondent had to press Interrupt to answer a question.

## Consequences

- Team formats open every seated debater's microphone in cross-examination.
  The rules name no respondent seat. If a format needs one questioner and one
  respondent, that is a new segment fact, not a return of the mode.
- A bot still stops its phrase when a person talks over it. That is its hearing,
  not the `interrupt` command.
- A bot in the scheduled seat asks first. Any other bot seat stays silent until a
  question ends, because its microphone no longer holds it back.
- A forward migration rewrites stored formats, presets, Rooms and Rounds, since
  their schemas are strict (ADR 0023). It follows the `resolutionDraw` backfill,
  which also rewrote published format revisions in place.

## The historical record

A Round that ran before this decision keeps its truth in
`round_speaking_intervals` and the command log, which the migration leaves
alone: they record who could speak and every accepted interruption. Its
receipt no longer has a cross-examination row, and its "Interruptions: Off"
is accurate because the policy now describes speeches only and
`cross_ex_only` never allowed interrupting a speech.

## A Round live during the release

A Round cannot finish under its old mode, because no code keeps that mode. The
release runs while the previous version serves, and that version cannot read
migrated rows: its Launch or settings save fails during that window. So the
migration refuses to run while any Round is active, and the release can be
retried once those Rounds finish.

If one were live anyway, the effect lasts one segment. In an open
cross-examination the respondent's microphone opens but no speaking interval
exists for them until the next segment, so that speech may not be transcribed.

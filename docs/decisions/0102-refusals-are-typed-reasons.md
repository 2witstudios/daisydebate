# 0102: Refusals are typed reasons, never messages

Status: accepted (2026-11-02).

## Context

Capture retry and seal, attendance, panel completion and the Room and Round
routes all decided what to do by comparing `error.message`. Rewording
"Capture session is closed" turned a retryable pause into a final capture
failure, and the handler tests stayed green because they built the same
literal. The words also lived as inline lists of strings, so nothing proved a
map covered them all.

## Decision

- `AppError` carries an optional `reason`, a `RefusalReason` from the closed
  vocabularies in `@daisy/protocol`. `createRefusal(code, reason, message?, cause?)`
  mints one.
- Code branches on `reason`. `message` is free text for a person reading a
  trace, the word itself by default, and no behaviour reads it. Rewording a
  message needs no other change.
- Each feature owns its vocabulary: Room, Round, Attendance and Capture, plus the
  internal Round completion and Round media words. A reason sent to a
  client keeps its existing wire word and status.
- A map over a vocabulary is a `Record` keyed by it, so a new word without an
  entry fails to compile.
- A word only becomes a reason once code reads it, or a client receives it. A
  refusal nothing reads stays a sentence.
- ESLint refuses `error.message` in a comparison, lookup, computed member or
  `switch`, and a kebab-case word or a `.refusal` or `.reason` value as the
  message of `createAppError`. That also catches most mints from a branch cut
  before this decision, which would otherwise quietly lose their refusal. It
  cannot see a word held in any other variable, or a message read through
  another name. Scripts carry only the mint rules: their plain `Error` text is
  CLI output, and their tests compare it.

Capacity refusals stay separate (ADR 0088): an admission fact with a lane and a
reason, read through `isCapacityRefusal`, never by text. A vendor's own error
text, such as Redis's `NOSCRIPT`, is outside this rule because Daisy does not
own those words.

## Consequences

- Internal words sit in the portable contract package, because one closed type
  spans them. They are never sent to a client.
- A new refusal adds its word to a vocabulary before any code can mint it.

# 0087: Compliance from obligations; erasure keeps the competitive record

Status: accepted (plan confirmed by the point guard, architecture review by
astra, 2026-10-28). Implements [DEC-261](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/pymadwqmflrva5se0i4kb01d).
Supersedes [ADR 0036](0036-privacy-by-design.md) §1 (per-field categories
and visibility) and §3 (the data inventory and `bun privacy`), the scrub
clause of [ADR 0029](0029-competitive-schema-foundation.md) decision 2, and
DEC-11. ADR 0036 §2 (identifiers per telemetry surface), §4 (subject rights
and durable vendor deletion) and §5 (consent) stand.

## Context

The privacy layer grew from classifying every column, Redis key and payload
field, not from Daisy's legal obligations. Every feature carried a
declaration of each column's category, visibility, purpose, lawful basis,
retention and erasure rule; tests compared those declarations with the
schema; a planned `bun privacy` gate would have enforced them. Almost every
lawful basis and retention in them was "pending", so the ceremony recorded
no decision and gated nothing a law asks for.

It also got the product wrong. Treating every personal value as something to
scrub led erasure to null the username on Rounds, ballots and ratings, and to
rewrite host-written resolutions on Rooms, Rounds and draw copies. The owner
(2026-10-28): usernames and resolutions are the competitive record, not
private data to scrub, and accountability needs alt tracking.

## Decision

1. **One page owns compliance.** `docs/operations/compliance.md` lists the
   obligations Daisy has under the GDPR, the UK GDPR, the CCPA and COPPA,
   maps each to the one module or procedure that meets it, and records
   processing per data class (its Article 30 record). A change that adds a
   data class, purpose, processor or retention period updates that page.
   Lawful bases and retention periods are proposed until counsel signs off
   (COMP-4).
2. **No per-column classification.** The declaration contract
   (`@daisy/protocol/privacy`), every feature's declarations, the schema
   adoption tests, the admin column declarations and the planned
   `bun privacy` gate are deleted. The PR template asks only whether the
   compliance page changes.
3. **Each feature owns its subject-rights step.** A `PrivacyAdopter` is a
   feature's erase and export functions, nothing more. `subjectRightsAdoption`
   composes every step exactly once in its order; the public
   `erasePrivacySubject` and `exportPrivacySubject` always run the whole
   composition, and a test fails when a feature defines a step the
   composition misses.
4. **Erasure closes the account and keeps the competitive record.** It
   deletes the email, name, image, sign-in rows and every feature's private
   data, and queues vendor deletion. It keeps the `users` row id, the
   username, the actor link, Rooms, Rounds, resolutions, draw evidence,
   ballots and ratings, unchanged and with their original visibility. The
   `users_tombstone_scrubbed` CHECK now allows the username on a closed
   account; the unique `lower(username)` index keeps it reserved forever. A
   closed account is shown as closed: its profile shows the public record
   any unrelated viewer could see, and its name on others' records and the
   ladder carries a closed mark.
5. **Rooms on closure.** A closed account's open hosted Rooms close and its
   seats in unbegun Rooms are freed. Nothing is rewritten, so draw copies and
   drawn items are fully immutable and the `daisy.privacy_erasure` bypass is
   removed.
6. **Alt tracking is built for, not built.** Erasure keeps what future alt
   and ban-evasion detection would match on: the account row id, actor,
   username and the keyed email digests on delivery receipts and
   suppressions. A future integrity-signals capability is a separate concept
   with its own legitimate-interest assessment and retention.
7. **Log fields carry route patterns only.** The logger's `route` and `path`
   fields admit only patterns listed in `logRoutes`; a concrete URL is left
   out (ISSUE-832).

## Consequences

- A username is personal data. Keeping it relies on legitimate interest in an
  accurate record that other members' results depend on, with an objection
  procedure decided by the owner with counsel; both are proposed pending
  COMP-4.
- Export and erasure have no request path and vendor jobs no scheduled
  worker yet (ISSUE-833). The compliance page names this as the next slice.
- A new column needs no paperwork; a new data class, purpose, processor or
  retention period updates the compliance page.

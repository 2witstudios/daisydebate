# 0044: recipient-hash key independent of the session-signing secret

Status: accepted (ISSUE-141; builder decision under the auth builder
final-cleanup prompt).

## Context

`recipient-key.ts`'s `deriveRecipientSubkey` derived a subkey from
`BETTER_AUTH_SECRET`, the same secret Better Auth uses to sign the session
cookie. `recipientKey` (that subkey plus the normalized address) is the
only form an email address takes in `email_suppression.recipient_hash`,
`email_delivery.recipient_hash`, and the per-recipient rate-limit bucket
keys (`rate-limit.ts`): the address itself is never stored.

`BETTER_AUTH_SECRET` is expected to rotate, routinely or on suspected
compromise (`docs/operations/secret-rotation-rehearsal.md`). Every rotation
changed the recipient subkey, so every existing suppression row's hash
stopped matching a lookup computed with the new one: the suppression check
silently stopped recognizing a hard-bounced or complained address, with
nothing in the application to show it happened, and every rate-limit
bucket reset to zero. Because only a hash is stored, no code path can
recompute a new hash from an old one without the plaintext address — the
address has to come from somewhere else (Resend's own suppression list, in
the operator runbook). That reconciliation is itself only a partial fix: a
bounce or complaint webhook that arrives after a rotation, for a message
sent before it, still resolves its recipient hash from
`email_delivery.recipient_hash` (stored at send time, under the old
subkey), so it would suppress the address under a hash the post-rotation
suppression check can never look up.

Filed as ISSUE-141 during the AUTH-7.6 rotation rehearsal review, out of
scope for that rehearsal leaf.

## Decision

`recipientKey`'s subkey is derived from its own secret,
`RECIPIENT_HASH_SECRET` (`packages/config`'s `authFields`, same shape as
`BETTER_AUTH_SECRET`: 64 characters from 32 CSPRNG bytes), never from
`BETTER_AUTH_SECRET`. `deriveRecipientSubkey` itself is unchanged (it still
takes a secret and domain-separates it under the `recipient-key` label) —
only which secret feeds it changes, at the one composition site
(`server.ts`).

Consequences:

- A `BETTER_AUTH_SECRET` rotation (the cookie signature, and
  `client-ip.ts`'s `clientIdHash`) never desynchronizes the suppression
  ledger or the rate-limit buckets. This is a structural fix, not a
  reconciliation step: nothing needs to be re-keyed when
  `BETTER_AUTH_SECRET` rotates, and a bounce or complaint webhook received
  after such a rotation, for a message sent before it, still resolves to
  the same recipient hash the post-rotation suppression check looks up.
- `RECIPIENT_HASH_SECRET` is provisioned the same way as
  `BETTER_AUTH_SECRET` (`bun scripts/provision-auth-env.ts`, `.env.example`,
  the Fly staging secret set in `docs/operations/deploy-staging.md`), and
  is a required, non-optional auth field: a deployment cannot start without
  it, the same as `BETTER_AUTH_SECRET`.
- `RECIPIENT_HASH_SECRET` is expected to rotate far less often than
  `BETTER_AUTH_SECRET` — only on a suspected compromise of that specific
  value, never on a routine cadence — because rotating it still has the
  same reconciliation cost `BETTER_AUTH_SECRET` used to carry. The
  operator runbook (`docs/operations/secret-rotation-rehearsal.md`) moves
  that reconciliation procedure to `RECIPIENT_HASH_SECRET`'s own section.
- `client-ip.ts`'s `clientIdHash` stays derived from `BETTER_AUTH_SECRET`:
  log-correlation continuity across a rotation was never this decision's
  concern, and coupling it to `RECIPIENT_HASH_SECRET` instead would just
  move the same problem rather than remove it.

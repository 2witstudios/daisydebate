# 0075: Beta access gate

Status: accepted (owner-authorized BETA epic, plan revision 3.1 approved
2026-10-26 by the orchestrator under owner delegation). Built in two steps:
BETA-1 expands the schema and the mail queue, and BETA-2 activates the gate.
Confirms DEC-19, DEC-22 and DEC-47 with the amendments recorded on those
decisions.

## Context

Daisy opens as a beta. People sign up the normal way (magic link, verified
email, username, onboarding), then wait until an operator lets them in. The
operator works in a separate admin app (ADR 0043, ADMIN-1). That app reaches
the participant app only through a signed internal API, recorded separately.
This record decides what beta access is, where it lives, how it becomes
enforced without a window that opens or reopens access, and how the mail it
owes is delivered.

## Decision

### 1. Beta access is a typed account authorization fact

- **One table, `account_beta_access`, keyed by user.** Each row has a state
  (`pending`, `approved` or `revoked`), its own `revision` (the expected
  revision operator commands carry), `requested_at` (the sign-up date the
  admin app shows), `decided_at`, and `provenance` (`signup` or
  `grandfathered`). The state vocabulary lives in `@daisy/protocol`
  (`betaAccessStates`).
- **It is not an entitlement or a release flag.** Entitlements are durable
  benefit grants (ADR 0085). Release and ops flags control rollout, never
  access or grants ([ADR 0118](0118-release-and-ops-flags.md)). Beta access
  answers whether the person may use participant capabilities at all. It is
  read with `member` and `erased` under the account fence (ADR 0048).
  Account access states are authorization facts owned by `@daisy/auth` and
  `@daisy/db`.
- **It is not a waitlist store (DEC-47).** Joining the waitlist is signing
  up. The row is created inside the username claim's transaction for an
  existing account. It holds no email, name or reservation.
- **Only operator paths change it (DEC-22).** The paths are this record's
  migration and the signed operator API. `apps/web` has no UI that writes
  it, and it is not a `role_grants` row.

### 2. Who is approved when this ships

The expand migration approves exactly the **grandfathered cohort**. That is
every account that, when the migration runs, is not erased, has a claimed
username and has a human actor. Each row gets `requested_at` = the
account's `created_at` and `provenance = 'grandfathered'`, plus a
`migration:beta_access_expand` audit event.

An account without a username at that moment gets a `pending` row when it
claims one, like every new sign-up.

### 3. Audit and command receipts are append-only for the runtime role

- **`account_access_events`** records every change. Its principal is
  `signup`, `migration:<name>` or `operator:<service>/<ref>`.
- **`operator_command_receipts`** records every accepted operator command,
  including no-ops. It is used for idempotency and reconciliation, and is
  written by the operator API.
- **Grants.** The migration revokes UPDATE and DELETE on both tables from
  `daisy_web`.
- **After erasure.** Both tables keep only identifiers of the tombstoned
  account. They are declared `retain-nonpersonal` operational audit. They
  are not anonymized, and we do not claim they are.
- **Foreign keys.** Every beta foreign key to `users` cascades. No
  production path deletes a `users` row: erasure tombstones it (ADR 0029).
  Test cleanups do delete them. The append-only guarantee is against the
  runtime role writing these tables, not against a deleted account row.

### 4. Erasure and export

The `beta-access` privacy adopter runs after the scrub.

- **Erasure** deletes the subject's `account_beta_access` row and every mail
  intent addressed to them. A tombstone therefore has no beta state, and
  there is no "erased" value to model.
- **Export** returns the subject's access row.

The declarations are in `packages/db/src/privacy/beta-access-declarations.ts`,
and the schema-adoption test pins them to the real columns.

### 5. Durable mail intents

Owed mail is a row in `mail_intents`. It is written in the transaction that
decides the mail is owed, and it never stores an address or body.

- **Mail it covers.** Purposes are `beta-approved` (to the member) and
  `beta-requests-digest` (to the owner).
- **The worker** runs in every web instance (`server/beta-mail.ts`).
  - It claims due intents and lapsed leases with `FOR UPDATE SKIP LOCKED`,
    under a 60 s lease, with the lease token stored as a SHA3 digest.
  - It reads at send time what the mail should say.
  - It sends through the one suppression-honouring path (`createSendMail`),
    with the intent id as the Resend idempotency key.
  - Only the lease holder settles the intent.
- **Send outcomes.**
  - A crash after the provider accepted the mail resends under the same key,
    so the email is not doubled.
  - A failure retries after 30 s, doubling up to an hour, and fails for good
    after 8 attempts.
  - The cap also holds at the claim: an intent already claimed 8 times ends
    failed there, so a worker that keeps dying after its claim cannot keep it
    in the queue.
- **Cancellations.**
  - An erased recipient is cancelled as `recipient-gone`.
  - An approval that was revoked before sending is cancelled as `not-owed`.
  - A suppressed address is cancelled as `suppressed`.
- **Owner digest.**
  - The username claim upserts one digest per UTC 10-minute window, keyed by
    the window. It is due when the window closes.
  - It counts the accounts that joined in that window and still wait, plus
    the total waiting. It names no one.
  - An empty window is cancelled as `not-owed`.
  - Without `BETA_NOTIFY_EMAIL`, digests are cancelled as `unconfigured`.
- **Retention.** Terminal intents are deleted after 30 days.
- **Not the realtime outbox.** That outbox carries no personal data
  (ADR 0036), so no mail goes through it.

### 6. Enforcement (activated by BETA-2)

The rest of this record describes BETA-2.

- **Fact and evaluator.**
  - The account fence function returns the beta state.
  - `@daisy/auth`'s evaluator requires `approved` for every participant
    capability.
  - **Withdrawals do not need it.** A member who is not, or is no
    longer, admitted can always withdraw their own footprint. They can
    never add to it or read others' content (DEC-126). The withdrawals
    are:
    - leaving: `room.leave` and `channel.leave`;
    - blocking: `social.block`;
    - own cleanup: `channel.reaction.remove`, `channel.file.cleanup`,
      `channel.message.remove` (own messages only),
      `channel.invitation.decline` and `channel.group.archive`;
    - declining a friend challenge waiting for them (ADR 0072):
      `social.challenge.decline`;
    - cancelling their own requests and invitations (ISSUE-692):
      `channel.request.cancel` and `channel.invitation.cancel`;
    - the replay reads of their own commands: `channel.group.result`,
      `channel.invitation.result` and `channel.request.result`.
    - forfeiting a Round (DEC-249, confirmed), so a non-admitted member is
      never trapped in a Round; the opponent's result follows the normal
      forfeit rules.
  - **Not withdrawals.** Management transfer (`channel.manage`) grants
    authority to someone else, so the last manager without admission
    archives the group instead. Typing is presence, so it is refused.
  - **A withdrawal reads nothing.** Removing your own reaction checks
    only that the reaction is yours, then answers with your own
    footprint: `reactions: []` and the change version, never the
    aggregates. So the response shape and status never reveal whether
    others reacted. A non-member has no own reaction, so they get 404.
  - **One list, in one place.** `admitsCapability` in `@daisy/auth`
    holds the list. The messaging and Room command edges hand a waitlisted
    principal to the evaluator, so these withdrawals are reachable over
    HTTP. Room reads and creation stay member-only at the edge.
- **Age admission (ISSUE-664).** Participant access is beta approval
  _and_ a durable age record whose band, computed now, meets
  `ACCOUNT_AGE_FLOOR` (16 in the beta, DEC-106; 13 after). The account
  fence reports that band (never birth data). A missing record is no
  access: the account waits as `age-required`, and the beta page sends
  it to the age step. The operator command refuses to approve such an
  account. Age eligibility is a participant admission rule, so every
  feature behind participant access (round analysis among them) inherits it
  and repeats no age check of its own.
- **Round independence.** Facts about other accounts keep using `member`,
  so a revoked participant never blocks an opponent's Round or its outcome.
  The same holds in a channel: one member losing admission never closes
  reading for the others.
- **Fenced commands decide access inside the fence (DEC-249,
  ISSUE-693).** The commanding human's own access facts are read under
  the account fence, after any lock wait, and checked by the one rule
  (`admitsPrincipalAccess`), which the web app injects. So a revoke that
  commits after the edge's identity read still refuses the command. This
  covers:
  - Round commands and judge ballots: a human without access keeps only
    `forfeit`;
  - attendance check-in and target reads;
  - Round media binding, snapshots, reconcile requests and token minting.

  Seats stay membership-only.

- **A revoked human already in a Round's media stops publishing
  (ISSUE-714).** Every media snapshot and every reconcile mutation also
  lists the human seats whose own fenced facts fail the rule
  (`withdrawn`). These are read inside the same fences, with the rule the
  web app injects. A withdrawn seat gets no media grants: no publish, no
  subscribe, and a judge stays hidden. Only that seat is affected: the room
  stays open, and the opponent's grants and floor are computed exactly as
  before, so the Round continues and forfeit stays available (DEC-249).
  - **The bound.** The revoked identity's room permissions go to nothing
    by the end of the first full media recovery pass of that Round that
    starts after the revoke commits. A revoke is not on the tick's one read,
    so that pass may be the Round's heartbeat, 2 s after its last pass
    (`MEDIA_RECOVERY_HEARTBEAT_MS`). A heartbeat can wait behind floors, but
    at 5 s with no pass (`MEDIA_RECOVERY_OVERDUE_MS`) the Round is overdue,
    and each tick starts the longest-overdue Round ahead of floors, so floor
    work cannot starve it (ISSUE-972).
  - **Worst case in plain terms.** This is a bound under load, not a promise
    of 5 s. With a slot free and no backlog: about 5 s, plus up to one 500 ms
    tick, plus the pass, which on the CI runner took about 1 s at p99 and 3 s
    at most. With a backlog, overdue Rounds ahead of floors get about one
    turn per 500 ms tick, so 19 overdue Rounds can add about 9.5 s; they get
    more when slots are left after floors. A live lease holds the Round too:
    a crashed owner's lease lasts up to 15 s. These are measured or derived
    from the constants, not a guarantee under an outage of the media provider
    or the database.
  - **Old tokens.** A token minted before the revoke stays usable for its
    60 s join window, because self-hosted LiveKit does not invalidate it.
    A rejoin with one is demoted again by the next pass. No new token can
    be minted. So the revoked human can publish at most for one pass after
    any join, and not at all once 60 s have passed since their last mint.
  - **Proof.** `packages/db/integration/fenced-admission.integration.ts`
    proves the withdrawn seat in the snapshot and the mutation authority.
    `apps/web/src/features/round-media/revoked-media.test.ts` proves the
    demotion, the open room and the untouched opponent.

- **What a pending account sees.**
  - Every member requirement is denied.
  - After onboarding, a pending account lands on `/beta` ("You're on the
    list, @name").
  - `/settings`, `/help`, legal and the public pages stay reachable, as
    they are for an anonymous visitor (P1).
- **Linearization point.** Revocation takes effect at the commit of the
  access transaction. That transaction holds the same `users` row lock as
  the account fence.
- **Realtime.** Live sockets close through the existing `session.revoked`
  control row within one outbox drain interval. Ticket redemption,
  subscription admission and delivery re-check the fact.
- **Expand and contract (rolling-safe).** The fence's new result shape
  ships as versioned producers, `daisy_authorization_accounts_v2` and
  `daisy_room_read_account_v2`. The v1 account function keeps its exact
  five-column result, rewritten in place to compute from v2. The v1 Room
  reader is left untouched and reaches v2 through that account wrapper.
  A statement a live instance prepared against either v1 function
  therefore stays valid across the migration. Every web and realtime
  caller moves to v2 in the same release. The contract step (BETA-2C,
  migration `beta_access_fence_contract`) runs once no instance runs the
  old binary. It first repoints the age reader's own fence calls to v2,
  then drops both v1 functions, so only v2 remains.
- **One age validity rule.** `daisy_age_band` is the single SQL rule for
  a durable age record: a birth month present and not after the
  evaluation instant, a positive version, and a finite recorded time no
  later than that instant. Any missing input means no record (ISSUE-676). Both the
  fence's band and the age reader use it. The fence classifies at
  `clock_timestamp()`, sampled after its lock waits.
- **What the band is.** `ageBand` is an account authorization fact for
  participant admission only. It is not public profile data, not
  consent, and not a social-eligibility grant. Social policy keeps using
  the age reader's revisioned fact with `validUntil`.
- **Activation point.** The gate is enforced once every web and realtime
  instance runs this release. During a rolling deploy an old instance
  does not enforce it; staging accepts that window, and production needs
  its own cutover decision.
- **Rollback.** Activation is forward-only. Redeploying a pre-activation
  binary would reopen access, so a defect in activation is fixed forward.

## Consequences

- New sign-ups wait on `/beta` from BETA-2 on. Until the admin app lands
  (BETA-5), only a signed operator call can approve them.
- WAIT-5.1's name-claimed email is the queue's expected second consumer.
- Ending the beta (approve everyone, or remove the gate) is a later forward
  migration plus deletion of the gate, recorded then (ADR 0023).

## Email preapproval and invitations

The admin Accounts screen manages `beta_preapprovals`, independently of
`account_beta_access`. A normalized email (trimmed and case insensitive, with
plus tags and dots preserved) can be entered before an account exists. Only a
verified matching account, pending and age 16+, without erasure or moderation
restrictions, consumes it once. Username enrollment and the required age step
both attempt the claim. Adding a grant also approves an eligible existing
waiting account immediately. A claim is the same transition an operator's
approval is (`decideBetaAccessChange` in `@daisy/protocol`) and goes through the
same writer (`writeBetaAccessChange`): access, its revision, beta entitlements
and the access event are written atomically, from the state and revision the
claim was decided on. A claim never sends an approval email. Age, Terms and onboarding remain required. Revoked access is never
automatically restored. Removing a claimed grant leaves account access alone.

Invite by email saves the grant and owes one `beta-invitation` mail intent;
Preapprove only owes no mail. Repeated adds do not resend an earlier invitation.
Explicit Send/Resend and Remove carry the displayed grant revision. Account
writers lock users before the normalized email advisory lock; removal locks
only the email/grant because it has no account effect. Receipt identity and
all state and owed mail commit together. The mail worker resolves grant-backed
recipients fresh, retaining existing suppression, retry, lease and provider
idempotency behavior. Removal, erasure and revocation cancel unsent work. A
provider request already in flight cannot be recalled.

Invitation links go to ordinary `/sign-in`, without an email or bearer token.
Forwarding a link grants no access, and signing in with another email cannot
consume the grant. Delivery states distinguish queued, sent, suppressed,
failed, cancelled and unknown; an unsettled provider attempt is unknown.
Terminal-intent retention may remove old delivery detail; the grant retains
that an invitation was requested, so its status then reads unknown.

For invitations, a lost or malformed provider reply remains `unknown` even
when attempts are exhausted. Definite provider rejections can report `failed`.
Uncertainty survives retries and expired leases until a positive send receipt;
a later suppression cannot prove an earlier in-flight request was not sent.

A claimed grant's queued invitation and resend also require the account's
current verified email to still match, its age to remain eligible and its
moderation state to permit access. Changing email never transfers the old
grant or revokes the account, but cancels mail to the obsolete address.

Invitation sends stop 23 hours after intent creation, conservatively inside
[Resend's documented 24-hour idempotency window](https://resend.com/docs/dashboard/emails/idempotency-keys).
The worker and transport both check the internal deadline (including transport
retries and after suppression lookup), so a process resuming after a long
outage cannot reuse an expired key and duplicate mail. It records unknown and
leaves the preapproval valid. An owner can explicitly resend using a new intent.

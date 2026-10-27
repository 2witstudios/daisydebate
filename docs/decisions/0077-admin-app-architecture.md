# 0077: Admin app architecture

Status: accepted (BETA plan revision 3.1, owner-approved 2026-10-26;
BETA-4). Amends [ADR 0019](0019-token-secret-ownership.md) for the admin
app's own credentials (see the amendment below), and is itself amended by
BETA-5 for the signing operator client. Keeps
[ADR 0043](0043-no-admin-surface-in-participant-app.md) in force.

## Context

ADMIN-1 decided that operators get a separate app with its own deployable,
database and accounts, reachable over the private network only, and that it
acts on the participant app only through a signed, audited internal API (the
signed internal operator API ADR, BETA-3). The BETA epic needs the first
operator action, approving beta access, so the app's foundation lands first:
how operators authenticate, how they are authorized, and what the app records.

## Decision

### 1. Workspace and stack

- `apps/admin` (`@daisy/admin`): Next.js 16.4.2 and React 19.3.0, the same
  pins as `apps/web`. Server components and server-action forms; the only
  client script is the WebAuthn ceremony, which a browser alone can run.
  Sign-out and every later operator command are plain POST forms.
- It runs behind a small custom server (`src/server/start.ts`) that answers
  every request, static files included, with a Host gate before Next sees it.
- Dependencies: `@daisy/protocol`, `@daisy/clock`, `@daisy/logger`,
  `@simplewebauthn/server` 13.3.2, `drizzle-orm` over Bun SQL and `zod`.
  `scripts/boundaries-rules.ts` allows `auth` (the operator signer, BETA-5),
  `clock`, `config`, `errors`, `logger` and `protocol`, and forbids
  `@daisy/db` and `@daisy/redis`, with a negative test. The admin app holds no
  participant database, Redis or Better Auth credential.
- `PrivacyFieldDeclaration` and its zod schema moved from `@daisy/db` into
  `@daisy/protocol/privacy` so both databases declare their columns against one
  contract; the transaction-bound adopter stays in `@daisy/db`.

### 2. Database placement and the migrate app

- Its own database, `daisy_admin`, with its schema and migrations under
  `apps/admin/src/db` and its own drizzle config. `bun migrations:check` covers
  that folder with the same history rules as the participant one.
- Owner role `daisy_admin_owner` is held only by the release-only app
  `daisy-debate-staging-admin-migrate` (`fly.admin-migrate.toml`, the
  [ADR 0041](0041-migration-credential-in-a-release-only-app.md) pattern, deployed `--update-only`).
- Runtime role `daisy_admin_app` has DML on the operational tables and only
  INSERT and SELECT on `audit_events` (SELECT on `chain_checkpoints`). The app
  refuses to start in production when its role is a superuser, can create in
  the schema or database, or owns any table.
- `REVOKE CONNECT ON DATABASE daisy_admin FROM PUBLIC`; the participant
  database already grants PUBLIC no CONNECT, so neither side's roles open the
  other's database.
- Staging places `daisy_admin` on the existing cluster: with one operator, a
  second cluster doubles cost and operations for no boundary the separate
  database, roles and CONNECT revocation do not already give. The accepted
  residual risk is a compromise of the cluster superuser or host.
  **A separate production cluster is a production gate.**
- `bun slot:up` creates and migrates `<slot>_admin` (dev), `<slot>_admin_test`
  and `<slot>_admin_e2e` beside the participant databases; CI creates `daisy_admin_test`
  (`TEST_ADMIN_DATABASE_URL`), which `requireAdminTestDatabase` guards.

### 3. Operator authentication

- **Canonical origin.** Only `http://localhost:4800`, RP ID `localhost`, the
  port belonging to the origin alone. Any other Host, `127.0.0.1` and `[::1]`
  included, gets 421 before any ceremony, which also defeats DNS rebinding. A
  future hostname change needs a credential re-enrollment plan.
- **Bootstrap.** `bun /app/apps/admin/src/scripts/operator-enroll.ts --name <n>
[--replace | --additional]`, over `fly ssh console`, mints a 15-minute link
  `http://localhost:4800/enroll#<token>`. The token rides in the fragment, so
  no server log sees it. A first enrollment creates the owner and refuses a
  second one (a partial unique index allows one active owner); each issue
  revokes the operator's unconsumed earlier links and is audited.
- **Enrollment.** GET `/enroll` consumes nothing. The first POST validates the
  token and issues a register challenge bound to that enrollment; the finishing
  POST verifies the attestation (user verification required, exact origin and
  RP ID, a duplicate credential id refused) and in one transaction consumes the
  challenge, consumes the enrollment and stores the credential, so of parallel
  finishes exactly one succeeds. `--replace` revokes every other credential
  and session of the operator in that same transaction.
- **Sign-in.** A discoverable-credential assertion with user verification.
  The challenge is consumed before verification. A sign counter that does not
  advance on a credential registered as device-bound (not backed up) is
  refused and audited; a synced passkey may report 0. The session opens in
  the transaction that advances the counter by compare-and-swap on a
  credential that is still unrevoked, so a racing cloned assertion or a
  concurrent `--replace` leaves no session. Success rotates the session: a
  new token, and any presented session is revoked.
- **Challenges** are 32 CSPRNG bytes, single-use (`UPDATE … WHERE consumed_at
IS NULL AND expires_at > now RETURNING`), bound to their purpose and
  enrollment, and expire in 2 minutes.
- **Sessions.** Cookie `daisy_admin_session`, `HttpOnly; SameSite=Strict;
Path=/`, without `Secure` or `__Host-` because the origin is http on
  localhost. 12 h absolute and 30 min idle, enforced server-side on every
  request, which also re-reads the `operators` row: a disabled operator's
  session is revoked on its next request. Sign-out revokes the session.
- **Request checks.** The server answers a request other than GET or HEAD
  whose Origin is not the canonical origin with 421 before Next runs, and
  every server action checks the Origin again. Failed authentication is limited to 10 per 10-minute
  window per purpose and client, in the admin-owned `auth_attempts` table. An
  attempt that can fail takes its slot by one atomic increment before the
  ceremony and a success gives it back, so racing attempts cannot pass the
  limit; the limit is audited once, when it is reached. The
  client is stored as SHA3-256 of its socket address under `ADMIN_ATTEMPT_KEY`,
  never raw. The peer address is the socket's, written by the custom server
  into a header it owns.

### 4. Operator authorization

`authorizeOperator` is the one pure decision: (operator fact, action,
approval policy) → allow, or deny with a reason. The actions are
`accounts.read`, `account.beta_access.update` and `audit.read`; roles are
`owner` (every action) and `operator` (designed in, no actions yet).
`requiresSecondApproval` returns false while the policy's `twoPerson` is off,
which is today's only policy. When a policy requires approval, the action
needs evidence bound to the command digest, the target revision, the policy
revision and a distinct approver; missing or mismatched evidence denies. The
app authorizes before it signs anything, and the participant app authorizes
again on its own (the signed internal operator API ADR). A denied page view is
audited as `access.denied`.

### 5. Audit and its stated guarantee

- `audit_events` rows chain: `hash = SHA3-256(prev_hash ‖ canonical JSON of the
row without hash)` with sorted keys, every field present, UTC ISO time, from
  the genesis `SHA3-256("daisy-admin-audit-v1")`. Appends are serialized by
  `pg_advisory_xact_lock` and take the next `seq` under it, so the sequence has
  no gaps; `kind` and `detail` are closed vocabularies enforced by CHECKs.
- The verifier walks seq 1..N (or from the newest `chain_checkpoints` row after
  a prune) and reports an edited row, a missing row and, against a recorded
  head, a truncated tail.
- Events in this leaf: `enrollment.issued`, `operator.enrolled`,
  `auth.success`, `auth.failure`, `access.denied`, `credential.revoked` and
  `session.revoked`. BETA-5 adds the command events and the cross-database
  anchor (`adminAuditHead` in participant receipts).
- **What the badge claims.** "Chain consistent (seq 1–N)": the rows read back
  are the rows written, in order, from a known start. It never claims
  protection against a coordinated rewrite of the whole chain; BETA-5's anchors
  in a database held by a different role are what make that detectable.
- Retention is two years, pending the owner's decision; pruning deletes from
  the oldest end and records the checkpoint the verifier starts from.

### 6. Network and owner access

- `daisy-debate-staging-admin` (`fly.admin.toml`) runs on the org's default
  6PN with no `[http_service]` and no public address (`fly deploy
--no-public-ips`, checked with `fly ips list`), bound to `[::]:8080`.
- The owner runs `fly proxy 4800:8080 -a daisy-debate-staging-admin` and opens
  `http://localhost:4800`. The private network is a reachability control under
  the owner's Fly auth, never authorization: every request is authenticated by
  its session and authorized by `authorizeOperator`.
- Both admin apps are image stages of `apps/web/Dockerfile` (`admin`,
  `admin-migrate`, before `runtime`, which stays last) and deploy from
  `deploy-staging.yml` with their own tokens, `FLY_ADMIN_MIGRATE_API_TOKEN`
  then `FLY_ADMIN_API_TOKEN`; a missing token skips the step. Admitting the
  admin apps to the 6PN needs an owner sign-off decision (BETA-H).

## Amendment to ADR 0019: admin app credentials

ADR 0019 assigns session, verification and credential tokens to Better Auth
through its adapter. That ownership is the participant app's. **The admin app
owns its own bearer tokens and credentials, outside Better Auth:** enrollment
tokens, session tokens, WebAuthn challenges and operator passkeys live in its
own database and are created, consumed and revoked only by its adapter
(`apps/admin/src/auth`). Tokens and challenges are 32 OS CSPRNG bytes,
base64url, and are stored and compared only as SHA3-256 digests; credential
public keys and ids are identifiers, never secrets. ADR 0019's logging rule
applies unchanged: no token, cookie, challenge, attestation or raw exception
reaches a log, and the audit log's `detail` is a closed vocabulary that cannot
carry one.

## Amendment (BETA-5): the signing operator client

The admin app reaches the participant app only through the signed internal
operator API (ADR 0079), with this client:

- **Configuration.** `OPERATOR_API_URL` and `OPERATOR_AUDIENCE` are committed
  `[env]` in `fly.admin.toml`; `OPERATOR_API_KEY_ID` and `OPERATOR_API_KEY`
  (base64url, at least 32 bytes) are Fly secrets. All four or none: with none,
  the accounts screen says the API is unconfigured, and a partial set refuses
  startup.
- **Signing** (`apps/admin/src/features/operator-client`). Every request is
  signed fresh by `@daisy/auth/operator-signature`: the injected clock's epoch
  milliseconds and a 16-byte CSPRNG nonce, so a retry never reuses a nonce.
  The admin edge hashes with Bun's hasher; a parity test holds it
  byte-identical to the participant app's `node:crypto`.
- **Responses.** Parsed strictly with the protocol schemas
  (`operatorAccountsPageSchema`, `betaAccessCommandResultSchema`,
  `operatorCommandStateSchema`). The six refusals the API makes before or
  instead of a change (`VALIDATION`, `AUTHENTICATION`, `AUTHORIZATION`,
  `NOT_FOUND`, `CONFLICT`, `PAYLOAD_TOO_LARGE`, each at its own status) are
  definite. Anything else (`INFRASTRUCTURE`, `INTERNAL`, a code at the wrong
  status, a malformed body, a network error or a 5 s timeout) is `unknown`,
  never `failed`.
- **Commands** (`apps/admin/src/features/accounts`). Approve and revoke
  re-read the operator row and run `authorizeOperator` before anything is
  signed. One transaction then mints the cuid2 `commandId`, opens
  `pending_commands` and appends `command.intent`. The PUT carries the hash of
  that intent row as `adminAuditHead`. `command.outcome` records `changed`,
  `unchanged`, `rejected:<code>` or `unknown`, with the mail status as its
  detail. A settled outcome closes the pending command by one conditional
  UPDATE, so of two racing reconcilers exactly one records it.
- **Reconciliation.** The accounts and audit pages, and their Reconcile forms,
  read each open command back with `GET /operator/v1/commands/{id}` and append
  `command.reconciled`. On `NOT_FOUND` (the PUT never arrived) the command is
  resent under the same id and the same anchor with a fresh nonce; the
  participant app's receipt makes any resend idempotent.
- **Screens.** The accounts screen has Pending, Approved and Revoked tabs with
  keyset paging. The `nextCursor` goes back unchanged, so the microsecond
  `requestedAt` inside it survives. Approve and Revoke are plain POST forms
  carrying `expectedRevision`. They redirect back with a closed notice, so a
  `CONFLICT` re-renders the current state. The audit badge reads "Chain
  consistent (seq 1–N); M anchors sent", where M counts the commands whose
  result came back, so the participant app holds their anchors. The audit
  page also lists the commands whose outcome is still unknown.
- **Retention.** A settled `pending_commands` row is deleted 30 days after it
  settled; an open one is never swept.

## Consequences

- The participant app gains no admin route, credential or dependency; ADR 0043's
  boundary check still holds.
- Every future operator action is a new typed capability on both sides plus a
  line in the signed internal operator API ADR, authorized here first.
- Losing the only passkey is recovered with `--replace` over `fly ssh console`,
  which requires the owner's Fly access.
- RP ID `localhost` binds credentials to that hostname; serving the app under
  another name needs re-enrollment.

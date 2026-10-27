# 0076: Admin app architecture

Status: accepted (BETA plan revision 3.1, owner-approved 2026-10-26;
BETA-4). Amends [ADR 0019](0019-token-secret-ownership.md) for the admin
app's own credentials (see the amendment below). Keeps
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
- `bun slot:up` creates and migrates `<slot>_admin_test` and `<slot>_admin_e2e`
  beside the participant databases; CI creates `daisy_admin_test`
  (`TEST_ADMIN_DATABASE_URL`), which `requireAdminTestDatabase` guards.

### 3. Operator authentication

- **Canonical origin.** Only `http://localhost:4800`, RP ID `localhost`, the
  port belonging to the origin alone. Any other Host, `127.0.0.1` and `[::1]`
  included, gets 421 before any ceremony, which also defeats DNS rebinding. A
  future hostname change needs a credential re-enrollment plan.
- **Bootstrap.** `bun apps/admin/src/scripts/operator-enroll.ts --name <n>
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
  refused and audited; a synced passkey may report 0. Success rotates the
  session: a new token, and any presented session is revoked.
- **Challenges** are 32 CSPRNG bytes, single-use (`UPDATE … WHERE consumed_at
IS NULL AND expires_at > now RETURNING`), bound to their purpose and
  enrollment, and expire in 2 minutes.
- **Sessions.** Cookie `daisy_admin_session`, `HttpOnly; SameSite=Strict;
Path=/`, without `Secure` or `__Host-` because the origin is http on
  localhost. 12 h absolute and 30 min idle, enforced server-side on every
  request, which also re-reads the `operators` row: a disabled operator's
  session is revoked on its next request. Sign-out revokes the session.
- **Request checks.** Every server action checks the browser's Origin against
  the canonical origin. Failed authentication is limited to 10 per 10-minute
  window per purpose and client, in the admin-owned `auth_attempts` table; the
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

## Consequences

- The participant app gains no admin route, credential or dependency; ADR 0043's
  boundary check still holds.
- Every future operator action is a new typed capability on both sides plus a
  line in the signed internal operator API ADR, authorized here first.
- Losing the only passkey is recovered with `--replace` over `fly ssh console`,
  which requires the owner's Fly access.
- RP ID `localhost` binds credentials to that hostname; serving the app under
  another name needs re-enrollment.

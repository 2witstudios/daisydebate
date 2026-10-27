# 0079: Signed internal operator API

Status: accepted (owner-authorized BETA epic, plan revision 3.1 approved
2026-10-26 by the orchestrator under owner delegation). Built by BETA-3.
It implements the "signed internal API" of the ADMIN-1 owner decisions and
[ADR 0043](0043-no-admin-surface-in-participant-app.md). It amends DEC-22:
operator paths are a migration, an ops command, or this API.

## Context

The admin app (its own deployable, database and accounts) must approve and
revoke beta access ([ADR 0075](0075-beta-access-gate.md)). It must never
hold participant database credentials, and the participant app must never
grow an admin route. So the participant app exposes the operation itself,
and that operation needs to be:

- reachable only from the private network;
- authenticated per request;
- authorized by the shared evaluator;
- audited on both sides;
- safe to retry.

## Decision

### 1. A second, private listener: reachability, never authority

- **What it serves.** The web process opens a second Bun listener that
  serves only the operator router (`apps/web/src/features/operator-api`).
  Next never answers there, and the public listener has no operator route
  at all.
- **Where it binds.**
  - On Fly, it binds the address `fly-local-6pn` resolves to, port 8081. It
    refuses to start unless that address is in `fdaa::/16`, and it never
    falls back to a wildcard.
  - Port 8081 is not in `[[services]]`, so fly-proxy never routes to it.
  - In development and tests it binds a loopback literal.
- **When it starts.** Only when `OPERATOR_API_KEYS` is set. Configured but
  malformed keys, or a configured address that cannot be bound, fail the
  start.
- **Who can reach it.** Any org machine and any WireGuard peer can connect
  ([deploy-staging](../operations/deploy-staging.md#client-identity-on-fly-verify-on-every-deploy)).
  Network position therefore admits nobody; the steps below do.

### 2. The route names do not cross ADR 0043

The routes are `/operator/v1/accounts`, `/operator/v1/accounts/{userId}/beta-access`
and `/operator/v1/commands/{commandId}`. This stays clear of ADR 0043:

- "Operator" is ADMIN-1's name for the admin app's principal.
- No path has an `admin` segment.
- The router lives outside `src/app`. A boundaries rule (`operatorApiIssue`)
  refuses any import of it from a Next route.

The participant app still has no admin screen or route.

### 3. Signature, keys and verification order

The signer and verifier are one pure module, `@daisy/auth/operator-signature`.
The admin app signs with it and the web app verifies with it. Hash
primitives are injected (`node:crypto` in each app), and so are time and
keys.

**Canonical string.** UTF-8 lines joined by `\n`, every field checked
against its grammar first:

1. `DAISY-OPERATOR-V1`
2. The audience: `daisy-web:<environment>`. It comes from configuration on
   both sides and is never read from the request.
3. The method.
4. The raw path.
5. The query, limited to the route's keys, each at most once, sorted and
   RFC 3986 encoded.
6. The key id.
7. The 13-digit epoch-milliseconds timestamp.
8. The 22-character base64url nonce.
9. The operator id.
10. The lowercase SHA-256 of the raw body.

**Signature.** `Daisy-Signature: v1=<base64url HMAC-SHA256>`. It is
compared through SHA3-256 digests.

**Headers.** The exact `Daisy-*` set is: `Key-Id`, `Timestamp`, `Nonce`,
`Operator` and `Signature`. An unknown or duplicate `Daisy-*` header is
refused.

**Limits.** Bodies are at most 16 KiB and headers at most 8 KiB. A request
with a `Content-Encoding` header is refused, and PUT requires
`application/json`. Clock skew must be within ±30 s.

**Order.** Each step runs only if the previous one passed, and nothing
durable happens before the request is authenticated:

1. Route.
2. Bounds.
3. Grammar.
4. Key.
5. Signature.
6. Skew.
7. Nonce admission: Redis `SET NX EX 120` on
   `<namespace>:v1:operator-nonce:<service>:<kid>:<nonce>`. Redis being down
   answers 503, failing closed.
8. Authorization.
9. Handler.

Every authentication failure answers the same 401, so a caller cannot tell
which check refused it.

**Keys.** `OPERATOR_API_KEYS` holds one or two `kid:base64url` pairs, each
at least 32 bytes. Keys are per environment, and the audience binds the
environment into every signature.

- **Rotation:** add the new kid on web, switch the admin app's key, then
  remove the old kid.
- **Emergency revocation:** remove the kid.

### 4. A principal, then the shared evaluator

A verified request becomes the principal
`{ kind: 'operator_service', serviceId: 'daisy-admin', keyId, operatorRef, capabilities }`.

**Capabilities.** They come from server configuration for the verified key,
never from the request. This version has two closed capabilities:

- `account.collection.read`
- `account.beta_access.update`

**Evaluator rules.** `@daisy/auth`'s `authorize` decides these
capabilities:

- Only an `operator_service` principal holds them, and only those
  configured for it.
- A beta access change also needs a live target with a beta row.
- User, anonymous and foundation-service principals never hold them.
- The operator service holds nothing else.

**Trust and key compromise.** Web authenticates the admin _service_, not
the human. `operatorRef` is the service's attestation of an operator it has
already authorized in its own evaluator. A stolen signing key lets an
attacker act as the admin service, within its two capabilities and only
from inside the 6PN or a WireGuard peer, until the key is removed. Both
audit trails record every use, and the scope contains nothing destructive.

**Approval policy.** Future two-person approval evidence will be bound to
the command digest, the target revision, the policy revision and a
distinct approver. Whenever a policy requires that evidence and it is
missing, the request fails closed. Today's policy requires none.

### 5. Commands: receipts, revisions, reconciliation

A beta access command has this shape:

`{ v: 1, commandId, state: 'approved' | 'revoked', expectedRevision, adminAuditHead }`

**Command id.** The admin app mints the command id before its first send
and keeps it across retries. Each retry is a fresh signed request, with a
new nonce and timestamp.

**Semantic digest.** The command's semantic identity is the SHA3-256 of
`[service, operator, action, target, state, expectedRevision]`. The
transport fields are excluded, so a retry under a rotated key replays the
same command.

**The transaction.** Everything below happens in one transaction under the
target's account fence:

1. A stored receipt with the same digest replays its stored result. A
   receipt with a different digest is a `CONFLICT`.
2. The fresh account fact is authorized.
3. The pure transition `decideBetaAccessChange` runs. A stale revision is
   a `CONFLICT`. Asking for the current state is recorded as `unchanged`.
4. These writes commit together:
   - the state and its revision;
   - `users.version + 1`;
   - the audit event;
   - the receipt;
   - on approval, the owed mail intent;
   - on revocation, a `session.revoked` control row, which closes the
     account's live sockets.

A refused command writes nothing.

**Reconciliation.** `GET /operator/v1/commands/{id}` answers the stored
result and the approval mail's state. The admin app uses it to settle a
command whose response it never received.

**Retention.** Receipts are append-only for the runtime role. A retention
proposal of 400 days is pending the owner's privacy decision.

### 6. Resources and errors

**Listing.**

- Accounts are listed newest request first, with `userId` breaking ties.
- Pages use a keyset cursor. The cursor carries its filter, and a cursor
  sent with a different filter is a `VALIDATION` error.
- There is no total count.
- Items carry username, state, revision, requested-at and decided-at only.
  They never carry an email address.

**Errors.** Errors use `@daisy/errors` codes and the body `{ error: { code } }`:

| Status | Code                |
| ------ | ------------------- |
| 400    | `VALIDATION`        |
| 401    | `AUTHENTICATION`    |
| 403    | `AUTHORIZATION`     |
| 404    | `NOT_FOUND`         |
| 409    | `CONFLICT`          |
| 413    | `PAYLOAD_TOO_LARGE` |
| 503    | `INFRASTRUCTURE`    |

Nothing internal leaves, and there are no redirects.

**Future actions.** A future operator action is a new typed resource and a
new closed capability, recorded here. It is never a generic command
endpoint.

## Consequences

- Web gains a private listening port. Its 6PN surface grows from SSH alone
  to SSH plus this signed API. This needs the BETA-H owner sign-off.
- The admin app needs one signing key per environment and nothing else
  from the participant side.
- The media worker's earlier signer (`packages/media/src/worker-auth.ts`)
  authenticates a different principal for a different purpose, and stays
  as it is.

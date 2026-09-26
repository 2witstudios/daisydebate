# Secret-rotation rehearsal (AUTH-7.6)

Staging-only rehearsal of planned and emergency (compromised) rotation for
`BETTER_AUTH_SECRET`, `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET`, run
against `daisy-debate-staging` on 2026-09-26. Every new value came from a
CSPRNG or the Resend API and was piped directly into `fly secrets import`
(`NAME=VALUE` over stdin — `fly secrets set` has no such flag, and a literal
value on the command line is itself a leak); no value was ever printed,
logged or pasted anywhere durable. This page shows only what "never log a
secret" allows: commands, digests-free evidence, counts and outcomes.

**Two Resend CLI commands print a secret in their own success output**:
`resend api-keys create` prints `token` and `resend webhooks get` prints
`signing_secret`. Both were hit once during this rehearsal (their output
briefly appeared in an operator terminal); each exposed credential was
revoked or rotated again within the same minute, before anything used it,
and the safe pattern below (`--json` output redirected straight to a file,
never the terminal, then piped to `fly secrets import`) avoids it going
forward. Operators must redirect `--json` output to a file for both
commands, never let it print, and prefer `resend webhooks rotate-signing-secret`
(no `get`) to read a webhook's current secret indirectly.

## Safe pattern

```
bun -e 'console.log("BETTER_AUTH_SECRET=" + crypto.getRandomValues(new Uint8Array(32)).reduce((s,b)=>s+b.toString(16).padStart(2,"0"),""))' \
  | fly secrets import -a daisy-debate-staging

resend api-keys create --name "<name>" --json > /path/to/scratch/key.json
jq -r '"RESEND_API_KEY=" + .token' /path/to/scratch/key.json | fly secrets import -a daisy-debate-staging
shred -u /path/to/scratch/key.json   # or rm -f if shred is unavailable

resend webhooks rotate-signing-secret <id> --json > /path/to/scratch/wh.json
jq -r '"RESEND_WEBHOOK_SECRET=" + .signing_secret' /path/to/scratch/wh.json | fly secrets import -a daisy-debate-staging
shred -u /path/to/scratch/wh.json
```

`fly secrets import` triggers the same rolling machine update as
`fly secrets set`, without ever taking the value as a CLI argument.

## BETTER_AUTH_SECRET

`server.ts` passes it straight to Better Auth as `secret`, which signs the
session cookie's value (`<token>.<hmac>`) and derives the recipient-hash
subkey (`client-ip.ts`). Rotating it does not touch the `session` table at
all — only the cookie's signature stops verifying.

**Planned rotation** (executed): generated a fresh 32-byte CSPRNG value,
piped into `fly secrets import`. Fly rolled the one staging machine
(`stopped` → `started`, health `2/2`) in under a minute. Observed:

- A session cookie captured before rotation (`GET /api/auth/get-session`
  returned the session + user) now resolves `null` after rotation, same
  request, same cookie, HTTP 200 — Better Auth treats a bad signature as no
  session, not an error.
- A brand-new sign-in immediately after rotation redeems normally and gets
  a session cookie signed with the new secret — no window where sign-in
  itself is unavailable.
- `/api/health/ready` stayed `ready` throughout.

**Emergency (compromised) variant**: the rotation command is identical, but
a compromise response should not stop at the cookie signature — the
`session` rows themselves are unaffected by this rotation, so anyone who
captured a raw pre-rotation session token (not just an intact cookie) still
has a row that matches it. The emergency runbook step this rehearsal adds
beyond the planned path: after rotating the secret, also revoke every
session (`DELETE FROM session;`, the same primitive
`Database.purgeAllForRestore` uses for the restore runbook, or Better
Auth's own revoke-all if driving it through the application layer) so a
compromise is not only cookie-invalid but session-row-gone.

**Recovery/rollback**: rolling back to the previous secret value re-validates
any cookie signed with it — safe for "we rotated by mistake and need
yesterday's secret back" (keep the previous value for the deploy window,
never past it), actively wrong for "the secret leaked" (rolling back hands
the leaked value back its validity). A leaked secret is only recovered by
rotating forward again, never by rolling back.

## RESEND_API_KEY

Confirmed which of the account's four keys staging actually uses before
touching anything: `resend logs list`/`get` showed the `Bun/1.4.2`-agent
`/emails` POST (the raw-`fetch` sender `mail.ts` uses, not the Node SDK)
came from `daisydebate-app-sending`'s exact `last_used_at` timestamp — the
other three keys (`daisydebate`, the operator's own CLI key; `PageSpace`;
`Onboarding`, never used) were never touched.

**Planned rotation** (executed): create the replacement key, set it, verify
a send, then revoke the old one — old key stays valid until the new key is
already live, so sending never stops:

1. `resend api-keys create` (output to file) → `fly secrets import` → machine
   healthy.
2. `POST /api/auth/sign-in/magic-link` → `resend logs` shows a fresh `200`
   `/emails` POST signed with the new key.
3. `resend api-keys delete <old id>` → sent again → still `200`. Zero
   observed downtime.

**Emergency (compromised) variant** (executed): revoke the suspect key
_first_, accepting a gap, then replace it:

1. `resend api-keys delete <id>` on the active key.
2. Immediate sign-in attempt: `{"code":"EMAIL_DELIVERY_FAILED","message":"We
could not send the email. Please try again."}` — a real, observed outage
   window, unlike the planned path.
3. `resend api-keys create` → `fly secrets import` → sign-in succeeds again
   (`200`, confirmed against a second recipient address after the first hit
   the per-recipient rate limit — the abuse protection working as intended,
   not a rotation defect).

**Recovery/rollback**: a revoked Resend key cannot be un-revoked; recovery
is always "create another key", never "restore the old one". Keep the
outage window to the time between revoke and the next `fly secrets import`
— there is no way to shorten it further from this side, since Resend
revocation is immediate and irreversible by design.

## RESEND_WEBHOOK_SECRET

`resend webhooks rotate-signing-secret <id> --help` documents Resend's own
grace window: "for 24 hours, payloads are signed with both the new and the
previous secret" — a rotation on the same endpoint is zero-downtime by the
vendor's own contract, not something this rehearsal needs to prove by
waiting 24 hours.

**Planned rotation** (executed): `rotate-signing-secret` on the existing
webhook id (endpoint URL unchanged) → `fly secrets import` → machine
healthy. A subsequent sign-in produced an `auth.mail.webhook` /
`http.request.completed` log line at `status:200` within seconds —
verification against the new secret succeeds, and (per Resend's documented
grace window) so would the old one, for 24 hours.

**Emergency (compromised) variant** (executed): if the leaked secret must
stop verifying immediately rather than in 24 hours, the CLI's only lever is
deleting the webhook and creating a new one (a new endpoint id has no
grace-window relationship to the old secret at all):

1. `resend webhooks delete <id>` → sign-in attempt produces no
   `auth.mail.webhook` log line at all (no endpoint registered to deliver
   to) — expected: webhook _delivery_ is unavailable for the deletion
   window, though mail sending itself (a different secret) is unaffected.
2. `resend webhooks create` (same endpoint URL, output to a file) →
   `fly secrets import`.
3. **Observed limitation, not expected going in**: the recreated endpoint
   did not deliver any event for several minutes in this rehearsal, despite
   `resend webhooks get` showing `status: enabled` and `resend emails get`
   showing the sends themselves reached `last_event: "sent"`. Rotating the
   secret again on that _same, now-established_ endpoint id (no new
   `create`) delivered within seconds on the very next send. Recreating a
   webhook endpoint is therefore not a same-second recovery the way
   rotating a key or a signing secret is — its dispatch does not resume
   provably until an operator sees a real event arrive, and this rehearsal
   found no CLI signal (`status`, `get`) that told the difference.

**Recommendation from this finding**: prefer `rotate-signing-secret` over
delete+recreate even for a suspected compromise. It loses the sub-24h
immediacy delete+recreate would otherwise offer, but delete+recreate traded
that immediacy for an observed, unbounded-in-practice delivery gap with no
way to confirm recovery short of watching for a live event — a worse
outcome for an operator trying to restore webhook visibility quickly.
Reserve delete+recreate for when the endpoint URL itself must change.

**Recovery/rollback**: once the 24-hour grace window from a rotation has
elapsed, the previous secret no longer verifies anything — there is nothing
to roll back to. A wrong new secret set in `RESEND_WEBHOOK_SECRET` is fixed
by rotating again and re-importing, not by trying to recover the old value.

## End-of-rehearsal state

- `daisydebate-app-sending`: a fresh key (old one revoked); `daisydebate`
  (operator CLI), `PageSpace` and `Onboarding` untouched.
- The webhook: same endpoint URL and event subscriptions as before the
  rehearsal, current secret matches `RESEND_WEBHOOK_SECRET`.
- `BETTER_AUTH_SECRET`: rotated once from its pre-rehearsal value; every
  session created before this rehearsal no longer authenticates (expected —
  the synthetic seed's sessions from `restore-rehearsal.md` are among them).
- Verified before finishing: `GET /api/health/live` → `alive`,
  `GET /api/health/ready` → `ready`,
  `bun scripts/staging-security-probe.ts --url https://daisy-debate-staging.fly.dev`
  all `PASS` except the documented `NOT RUN` (needs a signed-in probe, a
  known AUTH-7.8 limitation, not caused by this rehearsal), and a fresh
  sign-in by email succeeds end to end.

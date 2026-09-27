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

A shell redirect (`> file`) to a fixed, guessable path is two risks at
once: the file's permissions come from the operator's `umask` (typically
`022`, world-readable, so the token or signing secret sits world-readable
on disk until the `shred`), and a fixed path can already exist — including
as a symlink pointing somewhere the operator does not intend — so `>`
opens and truncates whatever it points to rather than a fresh file.
`mktemp` closes both: it atomically creates a brand-new, uniquely-named
file (refusing an existing path or a symlink) with owner-only (`0600`)
permissions already set, no `umask` needed:

```
bun -e 'console.log("BETTER_AUTH_SECRET=" + crypto.getRandomValues(new Uint8Array(32)).reduce((s,b)=>s+b.toString(16).padStart(2,"0"),""))' \
  | fly secrets import -a daisy-debate-staging

key_file=$(mktemp)
resend api-keys create --name "<name>" --permission sending_access --domain-id <sending-domain-id> --json > "$key_file"
jq -r '"RESEND_API_KEY=" + .token' "$key_file" | fly secrets import -a daisy-debate-staging
shred -u "$key_file"   # or rm -f if shred is unavailable

wh_file=$(mktemp)
resend webhooks rotate-signing-secret <id> --json > "$wh_file"
jq -r '"RESEND_WEBHOOK_SECRET=" + .signing_secret' "$wh_file" | fly secrets import -a daisy-debate-staging
shred -u "$wh_file"
```

`fly secrets import` triggers the same rolling machine update as
`fly secrets set`, without ever taking the value as a CLI argument.
`--permission sending_access --domain-id <id>` (the app's own domain,
`daisydebate.com` on this account) scopes the replacement key to sending
mail from that domain only — the app never needs `full_access` (account
management, other domains, contacts, broadcasts), so a leaked
`RESEND_API_KEY` under this scope cannot do more than send mail from that
one domain, unlike the account's default `full_access` grant.

## BETTER_AUTH_SECRET

`server.ts` passes it straight to Better Auth as `secret`, which signs the
session cookie's value (`<token>.<hmac>`). Rotating it affects four things:

1. **The cookie signature.** `session` rows are untouched; only the HMAC
   stops verifying, so a pre-rotation cookie stops authenticating even
   though its row still exists.
2. **The suppression ledger.** `recipient-key.ts`'s `deriveRecipientSubkey`
   derives a subkey from this same secret, and `recipientKey` (subkey +
   normalized email) is the only form an address takes in
   `email_suppression.recipient_hash`, delivery receipts and
   `createSuppressionCheck`'s lookup (`suppression-check.ts`). A rotation
   changes the subkey, so every existing suppression row's hash stops
   matching a lookup computed with the new one: **our own suppression
   check stops recognizing a hard-bounced or complained address**, with
   nothing in the application to show it happened. This does not make the
   address mailable in practice — Resend maintains its own suppression
   list independently and blocks delivery to it regardless of what our
   application decides — but it is still a real defect: our audit trail
   goes wrong, and nothing protects an address on a channel Resend's own
   list does not cover (a complaint recorded some other way, or a future
   provider migration). This coupling is a design defect, filed as
   <a class="mention" data-mention-type="page" data-page-id="gxjfa42wj7kuvxlhyi31o4cq">@ISSUE-141</a> — out of scope for this rehearsal leaf to fix.

   Operator step until it lands: reconcile `email_suppression` to the new
   secret as part of the same rotation, not as a separate later step —
   `BETTER_AUTH_SECRET`'s value cannot be read back from Fly once set (the
   safe pattern above pipes it there directly), so reconciliation must run
   in the same session, from the same shell variable, before that value is
   gone:

   ```
   new_secret=$(bun -e 'console.log(crypto.getRandomValues(new Uint8Array(32)).reduce((s,b)=>s+b.toString(16).padStart(2,"0"),""))')
   echo "BETTER_AUTH_SECRET=$new_secret" | fly secrets import -a daisy-debate-staging

   subkey_reconcile() {
     bun -e '
       const { deriveRecipientSubkey, recipientKey } = await import("./apps/web/src/features/auth/recipient-key.ts");
       const subkey = deriveRecipientSubkey(process.argv[1]);
       console.log(recipientKey(subkey, process.argv[2]));
     ' "$new_secret" "$1"
   }

   cursor=""
   while :; do
     page=$(resend suppressions list --limit 100 --json ${cursor:+--after "$cursor"})
     echo "$page" | jq -c '.data[] | select(.origin == "bounce" or .origin == "complaint")' | while read -r row; do
       email=$(echo "$row" | jq -r '.email')
       reason=$(echo "$row" | jq -r '.origin')
       source_id=$(echo "$row" | jq -r '.source_id // "reconciled-secret-rotation"')
       hash=$(subkey_reconcile "$email")
       psql "postgres://postgres@localhost:5432/daisy_debate_staging" -c \
         "INSERT INTO email_suppression (recipient_hash, reason, provider_message_id) VALUES ('$hash', '$reason', '$source_id') ON CONFLICT (recipient_hash) DO NOTHING;"
     done
     has_more=$(echo "$page" | jq -r '.has_more')
     [ "$has_more" = "true" ] || break
     cursor=$(echo "$page" | jq -r '.data[-1].id')
   done
   unset new_secret
   ```

   Run from the repository root (the `import` is relative to it).
   `email_suppression.reason` accepts exactly Resend's `bounce`/`complaint`
   origins (`manual` entries are excluded — they were never automatic, and
   `email_suppression_reason_check` does not allow that value); `source_id`
   is Resend's own originating message id, the real
   `provider_message_id` this reconciliation would otherwise have no value
   for. `resend suppressions list` pages at 100 per call and reports
   `has_more`; the loop above follows every page, not only the first. The
   list is account-wide, not scoped to this app's sending domain — this
   account also sends for other apps sharing it, so reconciliation can
   insert a hash for an address Daisy never mailed. That is over-
   suppression, never under-suppression, and costs nothing but an unused
   row: safe to leave as a known imprecision of this rehearsal rather than
   building sender-scoped filtering the CLI does not offer.

3. **Per-recipient rate-limit buckets.** `rate-limit.ts`'s bucket key is
   also `recipientKey(recipientSubkey, email)` — a rotation resets every
   recipient's rate-limit counter to zero, the same way it resets the
   suppression lookup.
4. **Client-id hash continuity in logs.** `client-ip.ts`'s `clientIdHash`
   derives from the same secret (`deriveSubkey(secret, 'client-id-hash')`);
   a rotation makes the same real client produce a different
   `clientIdHash` before and after, breaking log correlation across the
   boundary.

**Verification links in flight survive a rotation.** `emailedLinkIdentifier`
(`emailed-link-token.ts`) hashes only the token itself (SHA3-256, unkeyed) —
`BETTER_AUTH_SECRET` never enters it — so a magic link or email-change link
issued before a rotation still redeems normally after it.

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
has a row that matches it. There is no application-level revoke-all for a
live database (`revokeOtherSessions` is per-user; `purgeAllForRestore`
refuses by design outside an isolated restore copy), so the emergency step
is a raw SQL delete, run as the Postgres superuser over the database
machine's own `fly ssh console` access — the same pattern this rehearsal's
Postgres access section uses throughout, so no connection string with a
password ever left the machine. `daisy_web` (the runtime role) also holds
`DELETE` on `session` and could run this same statement over its own
`DATABASE_URL` instead; the superuser path is documented here because it
is what this rehearsal actually ran, using access already open for the
restore rehearsal's own dump/restore steps:

```
psql "postgres://postgres@localhost:5432/daisy_debate_staging" -c "delete from session;"
```

Staging: 4 sessions before, 0 after; `/api/health/live` and `/ready` stayed
healthy, and a fresh sign-in immediately afterward succeeded. This is raw
SQL, not `revokeOtherSessions`, so it never appends the `session.revoked`
outbox row that operation adds — a realtime instance watching for that
event is not notified. That is an accepted consequence of an emergency,
database-wide revoke, not a defect: the point is removing every session
row immediately, and no realtime consumer needs to react to a compromise
response the same way it reacts to a user's own sign-out.

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
already live, so sending never stops. The account's `api-keys create`
defaults to `full_access` (account-wide management), while the app only
ever sends mail, so the replacement key is `sending_access`, scoped to the
`daisydebate.com` domain id (the app's only sending domain) — a leaked key
under this scope can send mail from that domain and nothing else, never
manage other domains, contacts, broadcasts or keys:

1. `resend api-keys create --permission sending_access --domain-id
a6f552e6-fe5b-417a-8fb1-b16999e40469` (output to a fresh `mktemp` file) →
   `fly secrets import` → machine healthy.
2. `POST /api/auth/sign-in/magic-link` → `resend logs` shows a fresh `200`
   `/emails` POST signed with the new, scoped key.
3. `resend api-keys delete <old id>` → sent again → still `200`. Zero
   observed downtime.

**Emergency (compromised) variant** (executed): revoke the suspect key
_first_, accepting a gap, then replace it:

1. `resend api-keys delete <id>` on the active key.
2. Immediate sign-in attempt: `{"code":"EMAIL_DELIVERY_FAILED","message":"We
could not send the email. Please try again."}` — a real, observed outage
   window, unlike the planned path.
3. `resend api-keys create --permission sending_access --domain-id
a6f552e6-fe5b-417a-8fb1-b16999e40469` (same scope as the planned
   rotation — an emergency replacement is never broader) → `fly secrets
import` → sign-in succeeds again (`200`, confirmed against a second
   recipient address after the first hit the per-recipient rate limit —
   the abuse protection working as intended,
   not a rotation defect).

**Recovery/rollback**: a revoked Resend key cannot be un-revoked; recovery
is always "create another key", never "restore the old one". Keep the
outage window to the time between revoke and the next `fly secrets import`
— there is no way to shorten it further from this side, since Resend
revocation is immediate and irreversible by design.

## RESEND_WEBHOOK_SECRET

`resend webhooks rotate-signing-secret <id> --help` documents Resend's own
grace window: "for 24 hours, payloads are signed with both the new and the
previous secret" — that is Resend's outbound behavior (every delivery in
that window carries a signature for each secret), not anything our side
needs to hold both secrets for. Our verifier
(`apps/web/src/features/auth/webhook.ts`, `resend.webhooks.verify({ ...,
webhookSecret: secret })`) checks against exactly the one `secret` value
`RESEND_WEBHOOK_SECRET` currently holds — never a list, never both old and
new. Two consequences follow:

- **Real deliveries never break across a rotation.** Because Resend signs
  every delivery in the 24h window with both secrets, whichever one secret
  our app currently holds, the payload always carries a matching signature.
- **A forged request signed only with the leaked old secret is rejected
  immediately** once `fly secrets import` lands the new secret — our
  verifier has already forgotten the old one, and Resend's dual-signing is
  a property of its own outbound deliveries, not something an attacker
  holding only the old secret can reproduce for a request they send us
  directly.

**Use `rotate-signing-secret` + `fly secrets import` for both the planned
and the emergency case.** The single-secret verifier above means this is
already the immediate response to a leak: the old secret stops working the
moment the import lands, with no 24-hour exposure window to wait out and no
need to touch the webhook endpoint at all.

**Planned rotation** (executed): `rotate-signing-secret` on the existing
webhook id (endpoint URL unchanged) → `fly secrets import` → machine
healthy. A subsequent sign-in produced an `auth.mail.webhook` /
`http.request.completed` log line at `status:200` within seconds —
verification against the new secret succeeds.

**Never delete and recreate the webhook to rotate its secret.** Reserve
delete+recreate for the one case `rotate-signing-secret` cannot cover: the
endpoint URL itself must change. Deleting and recreating the same endpoint
URL, observed on this rehearsal: the recreated endpoint delivered no event
for several minutes despite `resend webhooks get` showing `status:
enabled` and `resend emails get` showing the underlying sends reached
`last_event: "sent"` — rotating the secret again on the same, already-
established endpoint id delivered within seconds on the next send by
contrast. Delete+recreate is therefore not a same-second recovery the way
`rotate-signing-secret` is, and there is no CLI signal (`status`, `get`)
that distinguishes "still recovering" from "broken."

**Recovery/rollback**: once the 24-hour grace window from a rotation has
elapsed, the previous secret no longer verifies anything — there is nothing
to roll back to. A wrong new secret set in `RESEND_WEBHOOK_SECRET` is fixed
by rotating again and re-importing, not by trying to recover the old value.

## End-of-rehearsal state

- `daisydebate-app-sending`: a fresh key, `sending_access` scoped to the
  `daisydebate.com` domain id (every earlier `full_access` replacement
  created during this rehearsal was revoked); `daisydebate` (operator CLI),
  `PageSpace` and `Onboarding` untouched.
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

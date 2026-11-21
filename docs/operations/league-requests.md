# League requests and league grants

League is sales-led ("Talk to us", decision 80 on the drive's direction
page). This page is the owner's procedure for the requests that arrive and
for turning one into a league on Daisy. It authorizes no production data
action by itself: every write below is an owner-approved data action.

## Where a request goes

Anyone, signed in or not, can send the form at `/contact/league`, linked
from League's "Talk to us" on `/pricing`. Both sit behind the
`league-requests` release flag (ADR 0118): staging has it open by its
release default (decision 77); production keeps it closed until the owner
opens it.

- The request is stored in `league_requests` (one row per request id: a
  resend after a lost answer is stored once and spends no allowance; a
  resend with a field changed, such as a corrected email, is stored as a
  new request, because a stored request never changes and its id is no
  edit credential, ADR 0018) and emailed to
  `LEAGUE_REQUEST_NOTIFY_EMAIL`, or, when that is not set, to the beta
  owner address `BETA_NOTIFY_EMAIL` (point guard, 2026-11-18: no new secret
  needed), through the shared mail path (purpose
  `league-request`). The email carries every field and a "Reply to" link
  that starts a reply to the contact; the form promised a reply within two
  working days.
- Both addresses are personal data, so they are deploy secrets, never
  committed. To send League requests somewhere other than the beta digest:
  `fly secrets set LEAGUE_REQUEST_NOTIFY_EMAIL=<address> -a <app>` (owner
  action). With neither set, each web process logs
  `league_request.mail.unconfigured` once at start, requests are still
  stored, and their email waits queued; setting a secret (which restarts
  the app) sends the backlog.
- A send that fails retries with backoff for about two hours and then
  fails for good (`state = 'failed'`), which is logged as
  `league_request.mail.failed` and reported (`last_error_code` `delivery`
  for the provider, `unreadable` when the stored row could not be read); a
  suppressed owner address is reported the same way, because every later
  lead would vanish with it, and ends
  `cancelled` with `suppressed`. The request itself is kept either way.
- Spam: a hidden trap field answers the ordinary confirmation and stores
  nothing; each client address may send 5 an hour and 10 a day, and Daisy
  takes 500 a day in all (Redis limiter, fails closed). The client address
  is hashed into the limiter key and never logged.

To read requests whose email did not go, use a read-only session through
`fly proxy` (as for any staging read):

```sql
select id, created_at, league_name, contact_name, contact_email, state, last_error_code
from league_requests order by created_at desc limit 50;
```

## Retention and erasure

A request is deleted 365 days after it was made, sent or not
(`retention.league_requests`, [compliance](compliance.md)). A deployment
with no owner address therefore loses its unsent requests after a year:
production and staging always have `BETA_NOTIFY_EMAIL`, and the
`league_request.mail.unconfigured` warning at each start is the signal to
fix one that does not. One more case ends a request's email unreported: a
web process that dies while holding the request's eighth and last attempt
leaves it `failed` with `delivery-unknown` (the shared queue settles it at
the next claim). The read-only query above lists those rows. The contact may
have no account, so a deletion request to the privacy contact is an
owner-approved data action:
`delete from league_requests where lower(contact_email) = lower('<address>');`

The database row is not the only copy. Each request was also emailed to the
owner address, and replies to the contact are ordinary correspondence in
that mailbox. A deletion request therefore also covers, by hand: the owner
notices for that contact (search the owner mailbox for "League request" and
the address), the replies and any call notes, and Resend's own copy of the
sent message, which Resend keeps for its documented log window as Daisy's
processor ([compliance](compliance.md), processors). Reply to the requester
once all three are gone.

## Granting a league

League pricing is not set (decision 78), so a league's entitlement is
administrative and uses the existing hosting grant: a current
`tournament_hosting` grant with source `administrative` is what lets an
account create a league (`organizationCreation` in
`packages/auth/src/authorization-organization.ts`) and its lobbies. There is
no admin screen or route for it yet (ADR 0137: production hosting stays
fail-closed until an issuer is approved), so each grant is a reviewed SQL
write with the owner credential, posted on Delivery first:

1. The league's director signs up on Daisy (an adult account).
2. Insert the grant version and its current grant in one transaction, with
   a new cuid2 for `<version id>`, the account's `<user id>`, the owner's
   operator id as `<operator ref>`, and the request id in the decision
   reference:

   ```sql
   begin;
   insert into account_hosting_versions
     (id, user_id, source, version, starts_at, expires_at,
      issuer_service_id, issuer_operator_ref, decision_reference, coverage)
   values ('<version id>', '<user id>', 'administrative',
     (select coalesce(max(version), 0) + 1 from account_hosting_versions
       where user_id = '<user id>' and source = 'administrative'),
     now(), now() + interval '1 year', 'daisy-admin', '<operator ref>',
     'League request <request id>: <league name>',
     '{"tournamentIds": [], "sponsorConcurrencyLimit": 1, "tournamentConcurrencyLimit": 1}');
   delete from account_entitlement_grants
     where user_id = '<user id>' and entitlement = 'tournament_hosting'
       and source = 'administrative';
   insert into account_entitlement_grants (user_id, entitlement, source, hosting_version_id)
     values ('<user id>', 'tournament_hosting', 'administrative', '<version id>');
   commit;
   ```

3. The director creates the league (an organization of kind `league`,
   [ADR 0135](../decisions/0135-leagues-are-organizations.md)) from the host
   area and brings their schools in.

### A Youth standing lobby during the lobby migration

The league's division still supplies the legacy rating and season key. Its
standing lobbies store the age rule that governs Room eligibility. New leagues
start Open. During the migration, a new standing lobby initially takes the
league's existing rule.

The division is fixed once the league is in use. The league's ladder replays
every completed league Round, whatever season it fell in, so a league that
had rated adults must never become Youth (Youth and Open never share a
ladder). A Youth league is therefore set once, right after it is created and
before its first season or standing Room, as an owner-approved data action.
Update the league's season key and any standing lobbies already created in the
same transaction. Both updates skip leagues that are already in use:

```sql
with changed_league as (
  update organizations set league_division = 'youth'
    where id = '<league id>' and kind = 'league'
      and not exists (select 1 from seasons where organization_id = '<league id>')
      and not exists (select 1 from rooms r join lobbies l on l.id = r.lobby_id
                      where l.kind = 'standing' and l.owner_organization_id = '<league id>')
    returning id
), changed_lobbies as (
  update lobbies set age_rule = 'under-18'
    where kind = 'standing' and owner_organization_id in (select id from changed_league)
    returning id
)
select (select count(*) from changed_league) as leagues_changed,
       (select count(*) from changed_lobbies) as lobbies_changed;
```

It must report `leagues_changed = 1`. A result of zero means the league was
ineligible. If the league already has competitive history, create a separate
league for the other rating division during this stage.

Revoke by deleting the `account_entitlement_grants` row (the version row
stays as history); the account keeps the league it made but cannot create
another while it has no current grant.

# Group chat staging smoke

The group release is staging-only. Deploy web and realtime from the same
qualified commit; the committed staging Fly definitions set
`MESSAGING_PRIVATE_GROUPS=staging`. Their exact Fly app identity is validated at
startup. Production leaves this variable unset. Never use the isolated fixture
policy to activate a deployed app. There is no schema migration in this slice.

Coordinate the smoke window in PageSpace Delivery before using staging, which
serves testers. Use dedicated test accounts with compatible current ages; do not
copy an owner's session. Keep account identifiers, titles and message text out of
public logs and delivery reports. Record the tested commit, environment, time,
results and any cleanup limitation on Delivery.

1. As a normal member, open Messages and choose Create private group. Invite two
   known test usernames. Only the creator has conversation access initially.
2. In the invitee's ordinary inbox, open Group invitation. Verify it names no
   private title, history, roster or age/block reason. Read the history consent
   text and accept. The normal Messages conversation should open.
3. Keep the creator's conversation mounted. Send from the accepted member and
   verify the message arrives without navigation or reload. Verify the socket
   obtains authorized observation and a content revision snapshot. Reconnect and
   verify authorized history returns with one copy of the message.
4. With a third account that has not accepted, request the conversation page,
   entry metadata, history, search and observation. Expect unavailable/not found,
   with no title, author, message, membership list or hidden reason. Decline the
   invitation; the same refusals must continue.
5. Renew the invitation explicitly, accept and verify the disclosed retained
   history. Transfer management to the new member; remove the original creator.
   Verify the removed account's mounted chat loses access and subsequent reads,
   files, search, sends and observation refuse. An inbox preference cannot restore
   it. Verify the remaining member still reads their authorized history.
6. With an existing member blocking a proposed invitee, attempt an invitation as
   another manager: admission must refuse without disclosing the blocking pair.
   Verify no pending invitation/grant was written. A group containing an adult and
   a minor, an under-13 account or unavailable age fact must refuse admission.
7. Verify the last manager cannot abandon an active unmanaged group. Archive,
   verify history remains readable but posting/invites refuse, then leave and
   verify access is gone. Exercise own withdrawal before departure and account
   closure only with dedicated disposable accounts; retain peer contributions and
   verify the authored title/subject data is scrubbed.
8. Confirm production has no group flag and no creation/admission controls.
   Existing production DM policy remains independently composed.

Local proof uses the isolated checkout slot, real PostgreSQL/Redis and the actual
Next/realtime processes. Run through the machine heavy queue and reuse one build:

```sh
bun doctor
bun run build
bun test:e2e:groups
```

The dedicated profile enables no external mail delivery: existing browser mail
capture and scoped test-account teardown apply. Local evidence does not claim a
staging deployment or a staging smoke pass. Turning the flag off stops new
admission; it is not a data-deletion or production rollout procedure.

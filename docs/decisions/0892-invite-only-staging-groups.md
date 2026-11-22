# 0892: Invite-only group conversations on beta staging

Status: accepted for staging only (owner restoration on Delivery message
`gt9x32akp3ici8025uyflvuf`, 2026-11-22; point-guard confirmation at
2026-11-22T14:53:00Z). Production remains off.

Amends DEC-127's groups-off beta disposition and ADR 0160 §10's activation
sentence. ADR 0160's group eligibility rule and ADR 0063's group privacy and
retention semantics remain.

## Decision

Reuse the existing private-group creation, invitation, membership and Messaging
conversation flows. The staging policy is `social.private_group`, revision 1.
Web and realtime select the same membership reading policy. Availability is
explicit and independent of an approved policy object or a generic release flag.

The committed staging web and realtime definitions set
`MESSAGING_PRIVATE_GROUPS=staging`. A production-mode process requires its exact
Fly staging app identity (`daisy-debate-staging` or
`daisy-debate-staging-realtime`, respectively), otherwise startup refuses. Absent
activation keeps group creation, invitation and acceptance off. Production does
not set the flag. Isolated tests can still inject their explicit policy; the
production process edge does not inject a fixture.

Creation, invitation issuance and acceptance require all-pairs block checks over
the complete prospective cast, not only the initiating manager's pairs. Current
canonical account/age facts and ADR 0160's pair rule apply: no under-13 or unknown
age admission/posting, no adult/minor mixture, minor/minor bands may mix. These
facts are rechecked under existing account → contact → channel fences. A later
block keeps existing group posting semantics; it does not evict members or
implicitly revoke history. Removal/leave are explicit membership revocation.

The bounded staging disposition is 50 active members and 50 pending invitations,
with existing DEC-251 per-account rate budgets. Creation bounds the initial cast;
acceptance checks capacity under the exclusive channel fence. Capacity refusal
preserves the pending invitation and writes no grant. Fixture numbers confer no
runtime approval. These staging limits do not define a future production launch.

Pending invitees receive only their invitation ID/generation/state. They never
see shared titles, roster or history. The invitation explains that acceptance
opens retained full history and that their contributions are visible to group
members. Rejoining requires a new explicit eligible invitation. Existing manager
transfer, last-manager/archive, own withdrawal and retry binding remain.

## Privacy and retention

The existing Messages class applies. Membership is account-lifetime while active;
ordinary contributions remain until their author withdraws them or closes their
account, with the existing author-local erasure. Shared titles retain their
creator binding for subject export/erasure, regardless of later management.
Group erasure preserves content-free tombstones and peer contributions under
ADR 0063; no DM survivor continuity policy is imported. Production legal review,
future group tombstone decisions and activation remain separate. This release
adds no retention period, processor, personal telemetry or data class.

## Evidence and rollout

Seven former permissive/fixture-policy suites now use deployed policy evidence:
DM requests, group creation, group invitations, group management, inbox, inbox
search and preference revocation. The actual signed-in staging-route proof adds
all-pairs third-party block refusal and denied metadata. A dedicated native
browser profile runs the deployed web and production realtime selection, not
Messaging fixture injection, and requires a live observation snapshot in the
mounted member's UI. Local proofs do not assert a staging deploy.

Deploy matching qualified web/realtime commits; coordinate the tester-facing
staging smoke on Delivery using `docs/operations/group-chat-staging.md`.
Production stays off. Builders do not merge or promote a production release.

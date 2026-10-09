# Messaging runtime

Messaging uses a persistent channel as its authorization boundary. The current
social adapter supports DM pairs and private-group grants. Actor preferences,
following and read cursors do not grant access. Other contextual channel kinds
require their owning producers before admission.

`@daisy/db/messaging` supplies a transaction frame over the application's existing
pool. It discovers authority identities, locks current users in sorted order,
then locks the canonical DM pair and channel. Membership is reread after waits;
a changed actor set refuses the operation. The application injects the canonical
account and policy composition, keeping raw birth data outside messaging.
Protected reads and writes reevaluate that composition while the locks remain
held, including after limiter waits and before receipt replay.

Message sequence orders creation. Change version orders content changes and
reconnect reads. History pages are descending by sequence; reconnect pages are
ascending by current message change version. Removed content is represented by
a minimal unavailable marker. Read cursors advance monotonically and cannot
exceed committed channel sequence. Marking read does not follow the channel or
enable notifications.

Sends atomically persist message, actor/channel/request receipt, counters and a
content-free `channel.changed` outbox event. Equal concurrent requests commit
one message; a different live payload conflicts. A consumed unavailable result
refuses before comparing its fingerprint and cannot reinsert content. The
provisional unavailable-result precedence follows ADR 0063 and does not confer
owner approval of its pending product policy.

The same-transaction `messaging` privacy adopter runs before canonical account
scrubbing. It deletes subject receipts, reactions, preferences, grants, contact
pairs and DM pair authority, scrubs only subject-authored text, and preserves
other authors' contributions. Shared titles lack subject attribution and are
preserved; export returns no channel title rows. Missing DM pair authority denies
reads and posting. DEC126 governs any future survivor-history continuity; no
continuity permission is inferred. Export includes subject-owned declared fields
only, excludes the other actor's directional block flag, and serializes dates as
UTC ISO values.

The web composition accepts an explicit `MessagingRuntimePolicy`. It wires the
same operations to authenticated, same-origin HTTP send/history/change/read
handlers and the canonical limiter. An absent policy returns unavailable (503).
No production size, contact, reading, legal-basis or retention approval is supplied
by fixtures or package defaults. Native forms, edit/delete/reaction/search,
social lifecycle commands, realtime subscriptions and the remaining contextual
slices are still delivery work; these primitives do not constitute full messaging
acceptance.

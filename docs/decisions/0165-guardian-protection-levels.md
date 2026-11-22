# 0165 Guardian protection levels

Status: accepted in decision 92 and the PC-2 master plan.

An active guardian chooses one per-child protection level in Settings. A
linked child defaults to Guided. A child without a current guardian follows
Independent. An active guardian can change the same choice when multiple
guardians link to the child. Ending the final active link erases that choice.
Setting a choice and activating or ending a link serialize per child,
including concurrent account closures.

- Independent follows Daisy's ordinary teen rules.
- Guided requires guardian approval for an adult's incoming friend request.
- Supervised requires guardian approval for every new friendship, limits
  incoming message requests to accepted friends, and disallows ranked entry
  and seats.
- Custom selects the same approval, message request and ranked limits.

The protocol's `protectionLimits` expands each choice. The database's private
lookup uses the finite table generated from that function. Only the child
and a current guardian can read the full choice. The contact transaction
evaluates holds at creation and before acceptance, including reciprocal
friend requests. The friendship keeps its ordinary pending state in shared storage. The private approval rows determine who sees it waiting. An approval clears the hold for one child and one request.
The recipient then chooses whether to accept. A child can decline an incoming
request or cancel their own while it waits. A guardian's decline of an incoming
request applies the child's existing repeat-contact bounds. A guardian's
decline of an outgoing request cancels it. Each read projects current holds
from the protocol rule. The guardian action rechecks the hold under the pair
and account locks before changing the request. The guardian's generic in-app
notification links to their private waiting list. Other members see a pending
request without family or age information. A new or newly actionable hold
resurfaces a covered request for its guardian. A settings change plans and
delivers notices to the guardians current under the child's choice lock.
Subject scope fences approval reads, and the scoped
writer grants no direct updates. Approval records go when a request
ends, including by block or erasure.

Guardian inbox signals are read by the realtime delivery role and routed to
the guardian's authenticated inbox topic. The web runtime expires read
notices after 90 days through a bounded operation that returns a count.
Email digests recheck a queued friend request under the recipient's scope,
so an active hold suppresses the ordinary request email while it waits.

A message-request lock overrides the child's stored preference in the account
fence. The preference applies again when the lock is lifted. Conversations
already accepted keep the rules in ADR 0160. Ranked room creation, challenges,
seating and launch use the current protection choice under their account
fences. Lobby age rules and permissions continue to apply.

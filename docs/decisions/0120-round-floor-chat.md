# 0120: Round floor chat

Status: accepted (owner, 2026-11-06).

## Decision

Channels in the Round room contains one Round chat for the frozen debaters and
host. Judges, spectators and unrelated members cannot discover, read, observe,
post or report its messages. A host assigned as an anonymous judge gains no host
exception. A host seated as a debater participates as a debater. Social DM blocks
neither grant nor remove this contextual audience.

The floor is a `round_floor` Messaging channel governed by `round.floor`, separate
from spectator chat and social conversations. Rendering and discovery are reads;
a protected explicit POST creates it once under the Round lock. Concurrent opens
converge on the unique Round/kind channel. Every content operation rechecks the
current account and frozen audience under the same authority fences as lifecycle
changes. Shared message sequencing, retry receipts, edits, author removal, read
markers and observation delivery apply. This does not add attachments, reactions,
typing indicators or judge identity disclosure.

Posting continues through prep, play and judging. Completion or abandonment
makes the floor read-only. Original eligible members can visit
`/rounds/:id/floor` for 180 days after the Round ends; expiry denies reads and
observation immediately, independent of the asynchronous sweep. The sweep drains
retry receipts, reply leaves and read state in bounded batches. Own-message
removal remains an ADR 0075 withdrawal, including after posting access is lost;
it gives no access to peer content. Ordinary account export and erasure apply.

Visible peer messages can be reported using the closed chat-message safety
reasons. Reports and signed operator reads/removal use the existing Content
Reports evidence and authority boundaries. No new personal content enters logs.

The embedded panel remains mounted while changing tabs. Incoming messages and
acknowledgements update the thread without refreshing the Round or replacing its
document editor or media controller. A pending or uncertain send keeps the exact
text and request ID for retry. Protected HTTP reads supply history and author
labels. The standard short observation permit hides all cached history when its
authority expires; older pages cannot restore hidden content.

## Consequences

Round-floor text, receipts, read state and expendable observation copies enter
the compliance inventory. The Round-end retention window is distinct from
spectator chat's posting-based window. AI chat remains unavailable. This amends
ADR 0097's disabled Channels composer decision.

# 0111: One document manager, which Prep and a Round open

Status: accepted (owner, 2026-11-03; point guard confirmation on Delivery,
2026-11-04). Amends [ADR 0054](0054-debate-room-workspace.md),
[ADR 0058](0058-one-round-model.md) §9 and
[ADR 0097](0097-round-workspace.md).

## Context

The owner: "It is only a document manager that you can search and use inside of
the round, that's all it is basically. Not round documents." A member's documents
were already owned by their actor, but their code, names and routes lived in the
debate room, every list read every body, and browser recovery of unsaved edits was
keyed by Round.

## Decision

**One home.** `features/documents` and `ui/documents` own the documents concept:
names, types, routes, tree, search, tabs, editor wiring and draft recovery. Prep and
a Round are places it opens. `scripts/check-boundaries.ts` refuses an import from the
manager into `app`, `debate-room`, `rooms`, `prep` or `round*` code. Round notes and
round documents are not concepts.

**Drive.** A member's drive is one tree of folders and documents, shown as "My
drive", with no row of its own. Foreign keys carry the owner, so an orphan or a
cross-owner link cannot be stored. A nested value holds the tree in the browser, so
it cannot represent a cycle. Postgres cannot state "no cycle" as a constraint, so a
move checks it under the account fence, which runs one member's moves one at a time,
and a trigger is the last guard. Limits: depth 8, 500 documents and 500 folders per
member, and a 200,000-byte body as before. A later club drive replaces the owner
column with a drive id behind the same owner check; nothing is built for it now.

**Bounded reads.** A folder lists by cursor, 100 rows a page, with no body. Bodies are
read by id, at most 16 a request, for the documents opened or recovered.

**Search.** One stored `tsvector` over title and body, with a GIN index, using the
`simple` config: debaters need exact words and names back, in any language, and
stemming to one language would fail them. The words travel in a POST body and are
never logged. A snippet reads only the start of a body, because building one from a
whole document was most of a search's cost.

**Delete.** Permanent, after a confirmation that states how many documents a folder's
deletion takes. A trash would need a retention job and a compliance row nobody asked
for in this release. Nothing references a document, so a Round is untouched. A
document deleted elsewhere while open here keeps its typed text, says so and offers
to save it as a new document; a tab learns at its next save or when it is next
focused.

**Draft recovery.** A browser copy of unsaved edits is keyed by person and document,
so it follows the document wherever it next opens. DEC-271 and DEC-272 are amended by
this: their limits, retention and sign-out rules stand, and only the Round leaves the
key. A draft of a document deleted on another device, with no tab open on it, stays
hidden until it expires.

**A Round's end.** A document is not the Round's, so the end of a Round stops no one
typing: the notice shows beside the manager rather than replacing it (ISSUE-1092).

**Capacity.** Documents were on the competitive lane. They now have their own: a
`documents` lane of 3 connections, queue 64, 1,000 ms for every list, read, save and
change, a live debater's save included, and the `search` lane of 1 connection, queue
8, 250 ms. A web process goes from 29 to 33 connections. A refused save stays in draft
recovery and retries, so a burst delays durability and loses nothing.

**Access.** Only an admitted member (`participantAccess`, ADR 0075) reads, changes or
searches. A waitlisted, revoked, under-age or restricted account is refused and keeps
export and account erasure, which do not come through these routes. ADR 0075 does not
name documents among its withdrawals, so a non-admitted member has no single-document
delete this release; account erasure is the way out. The request's identity read gates
every route, and changes to the drive's shape check again under the account fence. A
save relies on the identity read alone, so an account revoked mid-request can land one
more autosave of its own private text.

**Forms.** A change posts JSON or a plain form to the same route. A form answers with a
303 to a page from a fixed list, and a refusal carries a fixed notice key, so the drive
works without JavaScript apart from editing, which needs script.

## Consequences

- Erasure deletes documents and folders, and export returns them (ISSUE-329,
  ISSUE-383).
- Renaming the browser storage prefix leaves any copy under the old
  `daisy:round-notes:draft:` prefix unswept and unreadable to the app, past the policy's
  seven days. Daisy has no real users yet; no sweep is kept (ADR 0023).
- A drive holds 500 documents, set by the point guard on 2026-11-04, not the owner. An
  export holds every body in memory inside a transaction that locks the account's row, on
  the `control` lane, so no competitive or documents connection is taken. Measured locally
  at the limit (500 documents, 96 MB): 581 ms, a writer on that account waiting 570 ms, and
  269 MB of process memory growth. Nothing of another account waits. The limit can rise once
  the export streams (ISSUE-1323), which would change the shared privacy contract. Reaching
  it says so in plain words.
- The connection total grows with web machines. The 33 is per process and is not a
  production limit.
- Search under a burst refuses rather than queues for long; the palette keeps what it
  shows and asks again at the next keystroke.

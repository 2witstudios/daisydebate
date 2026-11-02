# 0097: The Round room is a workspace under the videos, with open help and no Round files

Status: accepted (owner, 2026-11-02; design
[Round room canvas](https://claude.ai/artifact/9s5Eczbd2BTt3RCSyWXzgx)).
Amends [ADR 0054](0054-debate-room-workspace.md) §1, §3, §5 and §8 and
[ADR 0058](0058-one-round-model.md) §9. Overturns DEC-108, DEC-159, DEC-160,
DEC-173, DEC-175 and DEC-177.

## Decision

**Layout.** The round bar, video tiles, clock and round actions are one
full-width section at the top. The workspace starts on one line below it:
Files on the left, the open documents in the centre, and a right sidebar that
switches between Transcript, Channels and AI chat. Each region scrolls on its
own, and notices render inside the frame, so the page itself never scrolls.
The sidebar never closes on its own; Files closes by hand. Below 901px one
panel shows at a time behind bottom tabs: Doc, Transcript, Channels, AI chat,
Files and Room. Until script runs, those panels stack in one scrolling column
so the transcript stays readable without JavaScript.

**Video.** Tile height follows the Round's phase from one map, capped by the
window. The layout presets, the layout menu and the resize divider are gone:
they changed nothing on the live media stage.

**Help.** All communication and all AI help are allowed in every Round, ranked
included. Daisy cannot enforce a ban, because anyone can open another device,
so it does not pretend to. Nothing the room offers depends on the Round's type.
The Terms of Service say the same.

**Documents.** A user owns documents, and a club will too. A Round only opens
them, so Daisy has no Round concept of files: the `round` folder, the stored
`folder` column and `round_document_refs` are gone. A new document goes to the
creator's drive, whichever Round it was created in.

**A document is just a document.** Templates are gone, including
`template_id`. A new document is titled `Untitled` and starts empty, and a flow
is one a debater chooses to write. With nothing open, the room opens the
document edited last, or offers New document when there are none.

**Transcript.** It is a Round record shown in the sidebar, not a document, and
the inert Add to Flow control is deleted. It follows new lines until the reader
scrolls up. It shows whole clips as the capture produces them, with no interim
text.

## Consequences

- Channels and AI chat keep their existing panels with disabled composers until
  messaging is built. A live Round has only its own channel and no direct
  messages yet.
- Ratings may reflect outside help. That follows from the stance and is
  accepted.
- Nested folders and club drives belong to the prep-documents slice, which
  builds on this ownership model.
- The migration drops `template_id`, `folder` and `round_document_refs` in one
  step, which suits the pre-ship baseline (ADR 0023). A server still running
  the previous release cannot create documents once it has run.

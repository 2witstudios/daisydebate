# 0097: The Round room is a workspace under the videos, with open help and no Round files

Status: accepted (owner, 2026-11-02; design
[Round room canvas](https://claude.ai/artifact/9s5Eczbd2BTt3RCSyWXzgx)).
Amends [ADR 0054](0054-debate-room-workspace.md) §1, §3, §5, §7 and §8 and
[ADR 0058](0058-one-round-model.md) §9. Overturns DEC-108, DEC-155, DEC-159, DEC-160,
DEC-173, DEC-175, DEC-176 (its marks) and DEC-177.

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
so it does not pretend to. Nothing the room offers depends on the Round's type,
and the Terms of Service say the same. A plan may later decide who has the AI
assistant, as a paid entitlement (owner, 2026-11-02); it never decides by round
type, and this slice adds no such gate.

**Documents.** A user owns documents, and a club will too once club drives exist. A Round only opens
them, so Daisy has no Round concept of files: the `round` folder, the stored
`folder` column and `round_document_refs` are gone. A new document goes to the
creator's drive, whichever Round it was created in.

**A document is just a document.** Templates are gone, including
`template_id`, and so are the debate marks (Aff, Neg, Extend, Dropped, New).
A stored mark loses its styling and keeps its text the next time the document
is opened. A page follows the viewer's theme until they choose otherwise.
A new document is titled `Untitled` and starts empty, and a flow
is one a debater chooses to write. When documents load with nothing open, the
room opens the one edited last. A workspace with nothing open offers New
document.

**Transcript.** It is a Round record shown in the sidebar, not a document, and
the inert Add to Flow control is deleted. It follows new lines until the reader
scrolls up. It shows whole clips as the capture produces them, with no interim
text.

## Consequences

- AI chat keeps its existing panel with a disabled composer. Round Channels
  uses the contextual floor chat in ADR 0120; social direct messages stay outside
  the live Round.
- Ratings may reflect outside help. That follows from the stance and is
  accepted.
- Nested folders and club drives belong to the prep-documents slice, which
  builds on this ownership model.
- The migration drops `template_id`, `folder` and `round_document_refs` in one
  step, which suits the pre-ship baseline (ADR 0023). A server still running
  the previous release cannot create, list or rename documents once it has
  run.

Round Channels now uses the live Round floor chat described in [ADR 0120](0120-round-floor-chat.md).

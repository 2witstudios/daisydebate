# 0054: the debater's round room and its document editor

Status: accepted (owner request, 2026-10-05; design
[Debate Room](https://claude.ai/artifact/Y32dLCZuXTwyruTfQFoUFn)). Extends
[ADR 0028](0028-tailwind-v4.md) and [ADR 0045](0045-daisy-brand-system.md)
for two narrow styling cases.

## Context

A debater mid-round needs to see both debaters, the clock, and a place to
write: a flow, cross-examination questions, a plan for the next speech.
The owner rejected a fixed flow grid as too rigid and chose free rich-text
documents, a page tree, chat and an AI helper that can edit the open
document. Daisy builds this itself rather than embedding another product.

## Decision

1. **Layout.** `/rooms/[id]/round` renders outside the shell: the two
   debaters side by side, the round controls with the clock large and
   centred, then a workspace of file tree, tabbed editor and a sidebar with
   Chat and AI tabs. Three draggable dividers size the panes; Auto picks a
   preset from the round phase (Split while the opponent speaks, Stage for
   cross-examination, Focus for prep and one's own speech).
2. **Tiptap 3 (MIT) is the document editor**, in `apps/web` only:
   `@tiptap/react`, `@tiptap/core`, `@tiptap/pm`, `@tiptap/starter-kit`,
   `@tiptap/extension-list` and `@tiptap/extensions`, pinned together. No
   Tiptap Pro or cloud packages. Documents are stored as Tiptap JSON; the
   templates that seed them are pure functions in
   `features/debate-room/documents.ts` that never import Tiptap.
3. **Tiptap's injected stylesheet is off** (`injectCSS: false`): its style
   tag carries no nonce, so the CSP would refuse it. The ProseMirror base
   rules live in `app/theme/room.css` instead.
4. **Pane sizes are custom properties set through the CSSOM**
   (`element.style.setProperty`), which the CSP allows, read by named
   utilities in `room.css` (`room-tree-pane`, `room-sidebar-pane`,
   `room-video-tile`, `room-workspace`). No style attribute and no
   arbitrary class value is introduced.
5. **The document page may carry its own scheme.** A debater can keep a
   dark page in a light app or the reverse. `[data-room-page]` joins
   the selector list in `globals.css` that re-declares the tokens, the same
   mechanism ADR 0045 gave the brand sheet's preview panels.
6. **Debate marks** (Aff, Neg, Extend, Dropped, New) are one Tiptap mark
   with a `kind` attribute rendered as `data-debate-mark`, coloured by the
   area hues and status tokens in `room.css`.
7. **Fair play.** In a rated round the sidebar has Chat only, with the
   round's own channel; club channels and agents are hidden
   (`features/debate-room/workspace.ts`). Recorded as DEC-108,
   open until the owner confirms or overrules it.

## Consequences

- Real-time collaboration, persistence and the AI agents need their own
  backend work; the room runs over sample data (`ui/mock/debate-room.ts`)
  until then, and chat and agent requests stay in the client.
- Upgrading Tiptap moves all six packages together and re-checks that no
  extension added later injects a style tag or a style attribute.

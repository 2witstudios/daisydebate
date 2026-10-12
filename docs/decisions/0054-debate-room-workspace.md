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

1. **Layout.** `/rounds/[id]/room` renders outside the shell for a
   debater of a round that has not ended (everyone else, and every ended
   round, gets the receipt at `/rounds/[id]`). One round bar: a drawer
   toggle (the unread chat count when closed), the round kind, the motion,
   the speeches with the live one as the current step, the judge chip
   (`Judge present`, anonymous, or `AI judge`), `Rec` while recording, and
   Leave alone in the far corner behind a confirm. Below it, one closable
   drawer with Files, Chat, AI and Room tabs beside the video, the
   three-column controls row (mic status and both prep clocks; the clock;
   the phase action, Tech issue and the layout menu) and the tabbed
   document. There is no Mute: the server controls the mics. Only the
   video resizes, by one divider; a manual resize pins the layout, and
   Auto picks a preset from the round phase (Split while the opponent
   speaks, Stage for cross-examination, Focus for prep and one's own
   speech). On a phone the drawer tabs become bottom round tabs (Doc,
   Files, Chat, AI, Room) and the phase action sits above them.
2. **Tiptap 3 (MIT) is the document editor**, in `apps/web` only:
   `@tiptap/react`, `@tiptap/core`, `@tiptap/pm`, `@tiptap/starter-kit`,
   `@tiptap/extension-list` and `@tiptap/extensions`, pinned together. No
   Tiptap Pro or cloud packages, plus `@tiptap/html` and `happy-dom` for
   the server-side round trip below.
3. **HTML is the stored source of truth**, as PageSpace stores its pages,
   so an AI reads and edits a document in the form it is stored. Every
   write (editor or agent) is first scanned (`document-scan.ts`): only
   strictly nested markup from the tags the editor writes is accepted
   (no comments, raw-text or foreign elements, no raw `<` or `>` in text
   or attribute values, nothing the HTML parser would re-nest), within a
   depth of 32 and 3,000 elements, so the parser reads exactly what was
   scanned; a seeded differential test checks this against the real
   parser, and that switching off any one depth defence lets a document
   past the bound. It is then parsed through the one document schema
   (`features/debate-room/documents/document-schema.ts`) on the server and
   serialized back (`normalize-html.ts`), so handlers, style attributes
   and unknown attributes never survive; then it is line-broken by
   only adding newlines (`document-lines.ts`, idempotent), so a line
   number means the same thing to every reader. Agents edit by line range
   or anchor through that one module, with the expected line count and a
   revision compare-and-swap refusing stale edits. Documents live in
   `debate_documents` (owner, optional AI debate, folder, title, HTML,
   revision); the templates that seed them are pure functions in
   `features/debate-room/documents/documents.ts` that never import Tiptap.
4. **Tiptap's injected stylesheet is off** (`injectCSS: false`): its style
   tag carries no nonce, so the CSP would refuse it. The ProseMirror base
   rules live in `app/theme/room.css` instead.
5. **The video size is a custom property set through the CSSOM**
   (`element.style.setProperty`), which the CSP allows, read by named
   utilities in `room.css` (`room-video-band`, `room-workspace`); the
   room's fixed metrics are `--spacing-room-*` and `--spacing-round-*`
   theme tokens there. No style attribute and no
   arbitrary class value is introduced.
6. **The document page may carry its own scheme.** A debater can keep a
   dark page in a light app or the reverse. `[data-room-page]` joins
   the selector list in `globals.css` that re-declares the tokens, the same
   mechanism ADR 0045 gave the brand sheet's preview panels.
7. **Debate marks** (Aff, Neg, Extend, Dropped, New) are one Tiptap mark
   with a `kind` attribute rendered as `data-debate-mark`, coloured by the
   area hues and status tokens in `room.css`.
8. **Fair play.** In a rated (ranked) round the drawer has Files, Chat
   and Room only, Chat holds the round's own channel; the AI tab, club
   channels and agents are hidden
   (`features/debate-room/workspace.ts`). Recorded as DEC-108,
   open until the owner confirms or overrules it.

## Consequences

- The room reads the durable Launch view (`/api/rounds/[roundId]`) and
  the room's competition type. That view carries no live position, so the
  room shows a waiting round: no speech lit, the first speech's length on
  the clock before the round starts, closed mics, nothing recorded.
  Ratings, stakes, chat delivery, the AI agents, media and Tech issue
  have no server yet: chat and agent turns stay in the client, and Tech
  issue is shown disabled (DEC-100).
- Account erasure keeps the `users` row, so `ON DELETE CASCADE` does not
  remove a person's documents on erasure; the erasure transaction must
  delete them explicitly.
- Upgrading Tiptap moves all seven packages together and re-checks that no
  extension added later injects a style tag or a style attribute.

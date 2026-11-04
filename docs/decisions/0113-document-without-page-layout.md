# 0113: A document is text, with no page layout

Status: accepted (owner, 2026-11-04). Supersedes point 7 of
[ADR 0054](0054-debate-room-workspace.md), except its last sentence: text size
stays the viewer's own and is never stored. Amends
[ADR 0091](0091-extended-nav-rail-default.md) and
[ADR 0111](0111-one-document-manager.md).

## Context

The owner: "get rid of the portrait stuff... we don't want template, we just
want a fucking document editor." A document could open with a stored page
setting that chose portrait or two to six landscape columns. It cost a schema
node, a custom top node and a transaction hook to pin it, plus a toolbar control
and its stylesheet. At Prep the manager also drew its own title, border and
centred column, so a document read as a window in the middle of the screen.

## Decision

1. A document has no page, orientation, column or template setting. The node,
   its command, its control and its stylesheet are gone. A stored setting falls
   away the next time the document is normalized; its text is untouched, and no
   migration is needed.
2. The document fills its pane with no maximum width, and the editing surface
   draws no focus decoration while someone types. Keyboard focus stays visible
   on every control.
3. The document manager draws no frame of its own. A page gives it one, and at
   Prep the frame is the whole middle section.
4. Prep's Files is a sub-sidebar attached to the main rail, which is icon-only
   on that page whatever the viewer's saved choice says. The saved choice from
   ADR 0091 applies everywhere else.

## Consequences

- The Round shares the editor, so its documents lose page layout too.
- Writing tools shrink to fit a fine pointer; a coarse pointer or a phone keeps
  the 44px target.

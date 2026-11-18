# 0153: Popover visibility belongs to the primitive

Status: accepted (owner redirect of 2026-11-18 on the `seat-menu-visible`
brief, SEAT-14a). The rule is in
[UI conventions](../development/ui-conventions.md#a-popovers-visibility-belongs-to-the-primitive).

## Context

Creating a Room showed every Fill seat menu open on load. The menus are
native `popover="auto"` dialogs. A browser hides a closed popover only with
the user-agent rule `[popover]:not(:popover-open) { display: none }`, and any
author rule that sets `display` beats a user-agent rule. The seat menu's
classes began `m-auto flex`, so each closed menu was laid out inline. The
Ready dialog had the same classes written correctly (`open:flex`), and the
file menu set `display: flex` under `:popover-open` in its own utility.

So the primitive let every caller own `display`, and each caller had to
remember that a popover's display belongs to its open state. The test that
should have caught it counted `[popover]:popover-open` elements. A closed
popover that is laid out on the page is still not `:popover-open`, so the
count was right while the page was wrong.

## Decision

1. **The primitive owns display.** `PopoverDialog` (`role="dialog"`, moves
   focus to its choice when opened) and `PopoverMenu` (`role="menu"`, its
   caller keeps the focus and placement behavior) live in
   `apps/web/src/ui/components/popover/`. Their classes come from one pure,
   unit-tested function, `popoverClasses`: closed is `not-open:hidden`, open
   is `open:flex` with the direction of the `layout` prop (`stack` or `row`),
   then the caller's surface classes.
2. **Callers may not set display or direction.** A literal `className` that
   holds a display or flex-direction utility (under any variant on the
   popover itself, with an important mark, or as an arbitrary
   `[display:…]` or `[flex-direction:…]` property) fails the type check.
   A variant that styles children (`*:`, `**:`, `[&>li]:`, `[&_p]:`) stays
   the caller's. A computed className that slips past the type check has
   its owned classes dropped at render: the type check and `check-styling`
   are the gates, and a slip should cost one class, not the Room route.
   `popoverClasses({ strict: true })` throws instead, for tests.
   `scripts/check-styling.ts` fails on a raw `popover` JSX attribute outside
   the primitives' folder and on a display or direction class passed to one.
   These guards are the fix.
3. **Every popover uses a primitive.** The Room seat menus, the Ready
   confirmation and the file row menu all do. `file-menu`'s
   `&:popover-open { display: flex }` is gone.
4. **Defence in depth.** `globals.css` keeps
   `[popover]:not(:popover-open) { display: none !important }` in its base
   layer. An important declaration in the first layer outranks every later
   rule, important utilities included. It backs up the primitive; it is not
   the fix, and a caller does not rely on it.
5. **Tests assert what the reader sees.** A popover test finds the popover
   with `includeHidden` and asserts it is hidden until its opener is pressed
   and visible after, with JavaScript on and off. It never counts
   `:popover-open` in place of visibility.

## Consequences

- A new popover is a `PopoverDialog` or `PopoverMenu` with a `layout`. A
  popover that needs grid or another display gets a new `layout` value in
  `popoverClasses`, with a test, rather than a class on the caller.
- A closed popover leaves layout at once: the important base-layer rule
  cannot be overridden, so no exit transition on `display` is possible. A
  popover that needs one amends this ADR and the rule, not its caller.
- `check-styling` reads every tracked `.tsx` and `.jsx` file as well as its
  path, and `scripts/check-styling.ts` imports the owned-utility list from
  the primitive so the two cannot disagree.

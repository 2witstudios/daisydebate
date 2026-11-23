# 0919: Client drivers and role-and-name component tests

Status: accepted (owner, 2026-11-19: "execute it all" on Plan — reconcile,
step R4.8). Builds on the client edge of PR 910 (`apps/web/src/ui/edge/`,
[UI conventions](../development/ui-conventions.md) § Browser lifetimes),
which recorded no decision of its own; this one records the driver
contract it introduced. Amends [ADR 0164](0164-property-tests-and-virtual-time.md)
(browser timers in tests run on its virtual clock).

## Context

Measured on main at `bfb17fa8d`:

- Six client components still held their own state machines in React
  hooks: the people list, the inbox, the broadcast stage, the document
  drive, conversation recovery and the person menu (1,877 lines, 110 hook
  calls, 39 of them `useState`, `useRef` or `useReducer`). Their
  transitions could be tested only by mounting React.
- 208 test files rendered components to a string; 200 of them, outside
  Tab, matched tags, attribute order, class strings or text in that HTML.
  Such a test passes when the page is unusable (a button with no name) and
  fails when markup moves without any change a reader could notice.

## Decision

1. **A driver is a plain module.** No React import and no DOM global. Its
   ports are arguments: the transport or a typed read, the realtime
   connection, timers (`BrowserScheduler` or the waits it needs), clocks,
   randomness, navigation and any media adapter. It exposes `readSnapshot`,
   `subscribe` and `dispose`, plus the commands its view sends. State is
   one snapshot; where a choice exists only in one mode, the type says so
   (`PersonMenuState`). A view reads the snapshot through `useDriver(seed,
start)`, which now hands `start` the seed the page rendered, so a driver
   begins from exactly what the server drew. Browser-only adapters (the
   LiveKit room, document events, a DOM ref for focus or video) stay in the
   view file and reach the driver as ports or commands.
2. **A driver is tested as a state machine** on `@daisy/clock/testing`'s
   virtual clock (`ui/test-support/virtual-browser-time.test-support.ts`
   gives the `BrowserScheduler` and window timers over it), with fake ports
   and no DOM. Before a component becomes a view, its behaviour is pinned
   through its public surface (a provider's context or a hook's result) in
   the mounted browser realm, and those tests pass before and after.
3. **Component tests read by role and accessible name.**
   `apps/web/src/test-support/rendered/accessible.ts` (`renderAccessible`,
   `accessible`, `accessibleWithin`) answers "the button named Save", "the
   dialog named X", "the status that says Y", and fails loudly on none and
   on two matches. Roles come from `@testing-library/dom` (`aria-query`
   5.3), names from `dom-accessibility-api` (accname 1.2), over a happy-dom
   document per read. Chosen over hand-written rules because role mapping
   and name computation are standards with edge cases (labelledby chains,
   embedded controls, hidden content) a maintained implementation already
   handles; chosen over Playwright's role engine because component tests
   run under `bun test` without a browser. The helper adds what a page
   without its stylesheet cannot tell the library: display from the
   Tailwind display utilities in `class` (spacing names as the browser
   lays them out), `<a href="">` as a link, and names of hidden content
   when asked for hidden elements.
4. **Rendered HTML is not a test value.** `rendered-markup/through-roles`
   (`eslint.config-rendered-markup.mjs`) refuses, in every test file and
   test-support module under `apps/web/src`, any string naming
   `react-dom/server` or `react-dom/static` (import, re-export, `import()`,
   `require`, a resolver, a type import) or the raw-markup helper, and any
   read of `innerHTML`, `outerHTML`, `getHTML` or a serializer. A test
   writing its own DOM fixture (`el.innerHTML = …`) stays legal. The rule
   has no file list and no disable: the one home for rendered output is
   `apps/web/src/test-support/rendered/`, and tests whose subject is the
   markup itself (design-system class contracts, decorative drawing,
   responsive visibility classes, head tags, the document shell) live in
   `apps/web/src/markup-contracts/`, each with its reason, reading HTML
   through `rendered/markup.ts`. Tab's screens and feature (`ui/tab/`,
   `features/tab/`) are the Tab team's and outside the rule.

## Consequences

- A test that asks for a button by name fails when the button loses its
  name, which no string match could see; several conversions found
  duplicated controls and regions sharing a name (listed in PR 919).
- A class-only meaning has two homes: an ARIA state the component renders
  (`aria-current`, `aria-pressed`, `disabled`), or a markup contract. A
  new markup contract is a reviewable file in one folder, not a pattern in
  a component test.
- The browser proof of conversation recovery
  (`e2e/support/messaging-committed-refusal.ts`) now finds the recovery
  driver in `useDriver`'s holder rather than a ref.
- Known limit of the ban: it refuses rendered HTML as a string, not the
  DOM. A test can still select elements by tag, attribute or class
  (`querySelector('svg')`, `[style]`), because the role helper hands back
  real elements, and a hidden input or a decorative child has no role to be
  asked for. The shared reader for hidden fields is the form a named button
  posts (`ui/test-support/posted-fields.test-support.ts`); fifteen room and
  form tests written before it still select their hidden inputs by name,
  and they move to it as they are next touched. Markup facts (decorative
  drawing, inline styles) belong in `markup-contracts/`. Review, not the
  rule, keeps selector checks out of component tests.
- Removal: replace `accessible.ts`'s two library calls and the rule's
  message; tests keep their role questions.

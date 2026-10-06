# UI conventions

Rules every screen in `apps/web` follows. They sit beside the component
guidance in `apps/web/src/ui`; this page holds only the rules that have
caused defects when broken. The brand (which mark on which surface, stage
ink, brand graphics and contrast pairs) has its own guide:
[brand usage](brand.md).

## Mutating forms work without JavaScript

Owner decision, 2026-09-23 (ISSUE-18). Every form that changes state is a
real POST that works before hydration and with JavaScript off. Client
JavaScript only enhances it.

- The form posts to a Next server action (`<form action={serverAction}>`,
  usually through `useActionState`) or to a route that answers a form POST.
  An `onSubmit` handler that calls `preventDefault()` and does the work in
  `fetch` is not enough on its own. Before hydration the browser submits
  the bare `<form>` as a native GET to the current page. That drops the
  submission and puts the field values in the URL.
- Form data never lands in a URL: not in the action's redirect, a query
  string or a notice. A refusal comes back as action state, which renders
  the typed value again and the notice with it. Success moves on with a
  redirect to a page that needs nothing from the form.
- The server re-validates everything the browser sends back, including
  arguments bound with `.bind`: they round-trip through the page and are
  untrusted. The action runs the same gates as the equivalent API route:
  it calls that route's handler in process with the request's own headers
  (`inProcessFetch` in `apps/web/src/server/in-process-fetch.ts`). The
  username claim, the sign-in link request and the email change all work
  this way.
- An action that moves on ends with `moveOn` (`apps/web/src/server/form-action.ts`),
  never a bare `redirect()`. A form posted without JavaScript gets a 303;
  a hydrated page gets the destination back as action state and navigates
  itself. A `redirect()` in an action the page's script calls makes Next
  fetch the target from the public origin with the browser's cookies, and
  print a raw error when that fails (ISSUE-80).
- Every action body is capped at 16 KiB (`serverActions.bodySizeLimit` in
  `apps/web/next.config.ts`, ISSUE-79). Next reads and decodes the body
  before the action's own gates run, so a form that needs more (a file
  upload) needs its own route and a recorded decision, not a higher cap.
- A form's action state comes from `useFormAction`
  (`apps/web/src/ui/form-action/form-action.ts`), not a bare
  `useActionState`. With JavaScript on, the action is a fetch the page makes.
  If that fetch fails in transport (a dropped connection), the form answers
  its own unavailable state with the typed value kept, never the root error
  screen (ISSUE-94). The server render keeps the server action itself,
  because React renders the no-JavaScript POST only from a server action.
- A form that disables its controls while the answer is pending hands focus
  back with `useFocusAfterAnswer` from the same module. A disabled control
  drops focus to `<body>`, so each new answer owes focus until the state it
  settles into has rendered; the caller says when that is (`settled`), and
  focus then goes to the element that state names: the form's field, or the
  next step's heading when the answer leads to a new step (ISSUE-107). A
  target named before the answer settles may be about to unmount, as the
  inbox heading is when a resend is refused. The browser suite asserts
  `document.activeElement` after each answer, resends included
  (`e2e/answer-focus.e2e.ts`).
- JavaScript may add a local check before posting (`onSubmit` calling
  `preventDefault()` for a value that cannot be valid), pending states and
  focus handling. React runs the action only when `onSubmit` did not
  prevent the default.
- A choice that only navigates, such as "Not now", is a link (`<a href>`),
  not a button with an `onClick`, so it works before hydration too.
- No `loading.tsx` or `<Suspense>` fallback sits above a page with a form.
  Next streams such a page into a hidden node that only an inline script
  reveals, so without JavaScript the page never appears (ISSUE-74).
- Prove it in the browser suite with JavaScript actually off: a context
  with `javaScriptEnabled: false` runs no script at all, inline or bundled.
  Submit, then assert the outcome and a URL without the submitted values.
  Aborting only the script chunks is not enough, because inline scripts
  still run and reveal what a script-less browser never sees. See the
  "with JavaScript off" block in `apps/web/e2e/journey.e2e.ts`.

Forms that predate this rule are tracked as issues in the PageSpace `Issues`
list. Bring each one into line when you next change it.

## Copy says what the interface cannot

Owner decision, 2026-10-04. The interface explains itself; copy fills only
the gaps it cannot.

- Keep text that is data, a heading or label, an error that says what to do,
  or the consequence of an action the person is about to take (a bye given
  away, an export that cannot be recalled).
- Do not explain what a control does, why the system works the way it does,
  or what will appear here later. Empty states are a short title and one
  action, not a paragraph.
- Say a policy once, on the page that owns it (Ranked rules, the privacy
  pages, how ratings work), and link to it; never repeat a reassurance such
  as "never changes your rating" across screens.
- A control with no backend is a sample action (the shell banner answers
  it); it carries no explanation of its own. Never show build status
  ("needs the organizer service", "not built yet", "no backend"), "Sample
  data" badges, spec placeholders (`[N]`, `[speech time]`) or
  owner-decision notes to people.
- No ledes that restate the page title, and no slogan pairs ("Practice
  arguments. Sharpen your mind.") outside the landing hero and the auth
  brand panel.
- Exception, owner decision 2026-10-05: the three onboarding intro steps
  (`/onboarding/welcome`, `/onboarding/daisy`, `/onboarding/debate`) may
  explain why debate matters, how Daisy works and how a debate runs. They
  are the one place that teaches the product, shown once after sign-up and
  reopened from Help; every other onboarding step follows the rule.

## App shell

Owner decision, 2026-10-05 ([the shell
design](https://claude.ai/artifact/BpZVQgWaDZEnuqiS7kejja), option A). The
bar and the side columns are one frame on the surface colour, with no
borders between them; the page is one sheet set into it, outlined and
rounded at the top, so it is the only edge on the screen. The bar never
collapses: the brand on the left, its logo centred over the nav icons, and
the account on the right (a member's bell and avatar, name and status as
one rounded control, or a visitor's Sign in, Finish sign-up mid sign-up).
Under it, navigation on the left and a member's friends on the right each
collapse with a panel button at the top of the column, on the side facing
the page ([the toggle design](https://claude.ai/artifact/Eaa6XtndWDpt6kPUYBujrt),
option A, owner decision 2026-10-05): a plain icon whose chevron points the
way the column will move. Collapsed, the sidebar is icons and the rail a
strip of avatars, each with its button at the top. Collapsed to icons, the
sidebar's Help, Terms and Privacy sit behind a help icon at its foot. A visitor has
no rail; their sheet keeps a margin on the right. Both views of the rail
are in the markup and CSS shows one, so the shell is right before any
script runs.

The sidebar's column always runs the page's full height. Its content is
pinned to the viewport only when the viewport can hold all of it (the
`tall:` variant); on a shorter one it scrolls with the page. It never
becomes a scroll box of its own, because that would clip the nav flyouts.

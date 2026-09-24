# UI conventions

Rules every screen in `apps/web` follows. They sit beside the component
guidance in `apps/web/src/ui`; this page holds only the rules that have
caused defects when broken.

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
  untrusted. The action runs the same gates as the equivalent API route.
  The username claim calls that route's handler in process with the
  request's own headers (`inProcessFetch` in
  `apps/web/src/ui/auth/onboarding/claim-username.ts`).
- JavaScript may add a local check before posting (`onSubmit` calling
  `preventDefault()` for a value that cannot be valid), pending states and
  focus handling. React runs the action only when `onSubmit` did not
  prevent the default.
- A choice that only navigates, such as "Not now", is a link (`<a href>`),
  not a button with an `onClick`, so it works before hydration too.
- Prove it in the browser suite. Abort the page's script chunks
  (`page.route(/\/_next\/static\/.+\.js/, (route) => route.abort())`), then
  submit and assert the outcome and the URL. See "a username submitted
  before the page hydrates…" in `apps/web/e2e/journey.e2e.ts`.

Forms that predate this rule are tracked as issues in the PageSpace `Issues`
list. Bring each one into line when you next change it.

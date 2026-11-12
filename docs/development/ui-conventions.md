# UI conventions

Rules every screen in `apps/web` follows. They sit beside the component
guidance in `apps/web/src/ui`; this page holds only the rules that have
caused defects when broken. The brand (which mark on which surface, stage
ink, brand graphics and contrast pairs) has its own guide:
[brand usage](brand.md).

## A live Round's page survives a temporary read failure

The Round keeps running on the server, so its room must not wait on anyone
pressing Try again. When a read answers temporarily (`temporary-read.ts`: a
refused read's 503 with `Retry-After`, or a rate limit), or a refusal makes the
page's identity temporarily unavailable, a Round's room and its own page render
an honest status page that asks again after 2 to 4 s, so pages refused together
do not return together. With JavaScript it asks in place with a `router.refresh`,
waiting longer each time up to 10 s, which keeps focus and the shell around it,
and a member moving on cancels it. Without JavaScript a plain `meta refresh` does
it. It shows no Round state, because none was read, and each retry applies the
access and redirect rules again. It answers 200 and `no-store`: a Next page cannot choose a 5xx.
Reads beside the room (ratings, transcript, attendance) degrade in place,
because a refresh would cost the room for less than its controls. Any other
failure, a genuinely unavailable identity included, stays on the error boundary:
it is not known to pass and must not say so (ISSUE-927).

## Messages fills the height between the rails

`/messages` has no page scroll. `.area-main:has(.messages-frame)` makes `main` a
column of `100dvh` (less the phone's tab bar), so the room bar and notices take
their own height and each pane scrolls alone (`theme/messages.css`). Below compact
one pane shows: a route with something to read marks it `data-open-pane`, so CSS
chooses before any script runs. Every route renders through `ConversationPane`,
and none adds its own `main`. The list refreshes through the inbox API, never
`router.refresh()` (ADR 0115).

## Mutating forms

Daisy needs JavaScript: nobody can compete without it, so nothing is built or
tested for JavaScript being off ([ADR 0114](../decisions/0114-daisy-requires-javascript.md)).
The rule that remains is that a click before hydration never leaks what was typed.

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
- An action with no typed input (only arguments bound with `.bind`) has
  no value to render again, so it may report a refusal by redirecting
  with a fixed `?notice=<key>`. The key is a constant the feature exports.
  It carries no form value, and the page compares it with that constant and
  renders a fixed sentence, never text from the URL. Messaging's
  `read-unavailable` (`markReadUnavailableNotice`, `markReadAction`) works
  this way.
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
  The full create-room editor uses a streaming 128 KiB POST route, with
  five-minute member-scoped native preview answers (ADR 0092).
- A form's answer is exactly one variant of a union discriminated on `kind`
  (`idle`, `refused`, `done`, `moved`, `unacknowledged`, plus the form's own
  accepted variants); the convention, the shared variants and their
  constructors are in `apps/web/src/features/forms/form-state.ts`. Readers
  switch on `kind`; nothing probes an optional field. A post whose answer was
  lost (dropped call, server fault, unreadable reply) is `unacknowledged`,
  not refused: it may have been recorded, so the form says so and keeps the
  original fields for a retry that posts them unchanged. Ballots, Round
  commands and Room commands all work this way.
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
  A form whose neighbours stay usable while its answer is pending (one row's
  button among several, as in the Invite people dialog) passes
  `onlyWhenLost`: focus moves only if it is on nothing usable, and a form
  that live sync removes before its answer arrives pays the same debt as it
  leaves.
- JavaScript may add a local check before posting (`onSubmit` calling
  `preventDefault()` for a value that cannot be valid), pending states and
  focus handling. React runs the action only when `onSubmit` did not
  prevent the default.
- A choice that only navigates, such as "Not now", is a link (`<a href>`),
  not a button with an `onClick`, so it works before hydration too.

### Conversation completion ownership

A hydrated DM send's durable result and its right to navigate are separate: the
conversation owns both, and a newer same-tab choice in it supersedes the send's
destination. See [messaging](../domains/messaging.md#send-completion-ownership).

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
  (`/onboarding/daisy`, `/onboarding/styles`, `/onboarding/debate`) may
  explain how Daisy works, the three debate styles and how a debate runs. They
  are the one place that teaches the product, shown once after sign-up and
  reopened from Help; every other onboarding step follows the rule.

## Home notes

Home's eight destinations are curled notes (owner, 2026-11-03). Hovering or
keyboard-focusing one peels it and plays its icon's motion once, in CSS alone,
so it needs no script. With reduced motion neither plays. The Seasons note is
the one exception to "no live facts on tiles": on hover and focus only, it
reveals the running season's number and time, which appear instantly with
reduced motion. The rail and tab bar keep the static icons.

On a phone (below 641px) they are not notes but one vertical menu (owner,
2026-11-04): full-width rounded rows, each its icon and title centred, with no
curl, peel, tilt, tagline or season reveal. Play keeps its accent colour and the
other seven share one. CSS alone decides it, so the first HTML is right.

A phone has no Home hero and no opening tournament or Live now cards. A member
sees the menu, and the hero returns only while they hold a Room, because it
carries Return to room. A visitor sees only the join form, plainly on the page.

## App shell

Owner decision, 2026-10-12 (the Round room redesign canvas, Proposal page;
RRD-1), amended 2026-10-29 by [ADR 0091](../decisions/0091-extended-nav-rail-default.md).
Every shell page is one navigation rail beside the page. The rail defaults
to extended at desktop widths: each destination's name shows as text beside
its icon. Top to bottom: the logo (home) with the "Daisy Debate" wordmark
beside it; the destinations (Home, Play, Tournaments, Leaderboard,
Watch, Judge, Train, Prep); a divider; then a member's Notifications,
Messages and Friends (with the online count), with
Minimize as the group's last row (Expand when mini). The foot is the
account: a member's avatar and username open an account menu to the right.
The menu lists their ratings on each ladder under the season's name, each
as the rating, "Provisional", "Unrated" or "Hidden while judging", then
Profile, Settings, Help, Terms, Privacy, Analytics preferences and Sign out.
It is a native disclosure, so it opens on a tap without script. The shell
reads the ratings once per request and does not wait for them: the menu
streams them in, and a failed read says so in the menu. A visitor's Sign in
or Finish sign-up takes the foot instead. Mini shows the same order as icons
only, with every name kept as screen-reader text.

The full accessible name is unchanged in both modes: counts stay in it
("Friends, 5 online"), hover flyouts (Watch: Spectate live, Recordings)
reveal on hover and keyboard focus, badges are unchanged, and Friends is its
own page, `/friends`. Minimize is a form posting a server action, so it
works without JavaScript; it is named Minimize when extended and Expand when
mini.

Both shell sidebars follow the selected theme: light cream/white surfaces in
light mode and normal green surfaces in dark mode (owner, 2026-11-04,
overruling DEC-359). The navigation rail and people sidebar use `--surface`;
the people sidebar uses `--text`, and neither forces a dark color scheme.
A page that marks itself
`data-workspace` fills the viewport and scrolls its own panes, and the rail is
icon-only beside it whatever the saved choice says (ADR 0113), by CSS alone.

The choice to minimize to the icon-only rail — names as screen-reader text
with a tooltip, the 56px column — persists in a cookie the server reads per
request (`daisy.rail=mini`; absent is extended), so the first HTML carries
the right width. Below 1101px the viewport cannot hold words: the rail is
icon-only whatever the choice says and the toggle is hidden, decided by CSS
alone (`max-rail:sr-only` keeps every accessible name). On a phone (below
641px) a tab bar fixed along the bottom replaces the rail: Home, Play, Prep,
a member's Inbox (a visitor's way in), and More, a native disclosure whose
sheet lists every other destination. Both navigations are in the markup and
CSS shows one, so the shell is right before any script runs.

The rail sticks to the viewport at every height, so its foot (the account)
never scrolls with the page, and its column always
runs the page's full height. It never becomes a scroll box of its own,
because that would clip the nav flyouts.

While a member holds a Room, a slim bar opens every shell page's
column with the Room's title, its phase and "Return to room". Home and the
Lobby pin the Room themselves and the Room's own page needs no way back, so
the bar is left off those.

The live round renders outside the shell, with its own round bar.

## Lobby and Play

Owner decision, 2026-10-26 (the Lobby redesign canvas). The Lobby (`/lobby`)
is where people find, join, host and return to debates, and Play in the
navigation goes there. It is one flat list: the member's own Room pinned
first, then status tabs (All, Open, Starting, Live), then search with Ranked
or casual behind Filters as one GET form, then one compact row per
Room grouped Open, Starting and Live now. A row carries the Room's name, host
and facts on the left and its status and one action on the right.

- The word is "room", never "table". Starting one is "New room"; "Open a
  room" names it in Play.
- One verb per state: Join (an assembling Room), Spectate (ready, not
  started), Watch (a live Round), Return to room (the viewer holds a seat).
  Check in and Register are reserved for tournament and league seats.
- A row shows what the listing carries: format, seats taken of the seat
  count, how long an open Room has waited, and a live Round's stage. The
  host's rating stays out while the beta is unranked. A field the listing
  does not carry yet (tournament and league grouping, an event-scoped room
  label) is left out, never faked; its tab or column appears when the data
  does.
- The status tabs and the mode select are the listing query itself
  (`RoomListQuery`): the server narrows the whole listing before paging and
  the Lobby only groups the page it gets back. An absent value, `all` or
  `any` narrows nothing; an unknown or repeated value is refused.
- Play in the Lobby header is a link to `/play`. Once hydrated it opens the
  same choices (Open a room, Ranked match, Practice with a bot, Tournaments
  and leagues, then Just browse the Lobby) in a modal
  dialog over the Lobby;
  without script `/play` lists them as a page.
- A member's Home leads with the Lobby, or with Return to room while they
  hold a Room. Visitors keep the waitlist hero. On a phone, see Home notes.

## Pre-round Room

The gathering view uses the saved topic, authoritative team/judge lineup and
resolved ordered schedule. Settings are an acknowledged summary with explicit
native Edit disclosures; a refused save opens its disclosure and retains the
submitted draft and version. The main readiness/start bar follows the schedule,
with personal device setup beside the saved settings.

Duration forms use integer minutes and decimal seconds (0–59.999). The form
boundary converts their strings to exact integer milliseconds and checks the
combined duration against the room's pinned format bounds. Speech order, seat
identity and structural schedule authority remain with the pinned definition.
The pre-round Room has no chat composer; Messages stays in the rail.

Seat assignment pickers show the saved occupant, or an explicit empty choice.
An acknowledged assignment follows the canonical Room view; a refused enhanced
submission retains its selected participant and shows the refusal.

Invite people is a host tool, so it takes no page space: it is a button in the
header's button row that opens a modal dialog, and it shows only to the host
while the Room is open. Close room and Invite people share one dialog shell
(`RoomDialog`). The button carries the number of pending invitations. The
dialog holds the invite form and the pending invitations with Withdraw, and
stays open after each answer, so the notice is read in place and the next name
can follow. A refused invite keeps the name and the seat kind chosen. An answer
hands focus back to the username field only when focus is lost, never away from
a control the host has moved to. Esc and Done close it, and its forms start
again each time it closes, so an old notice is not what the host finds on the
next open. An invited member's "You're invited" notice with Decline is a prompt
they must see, so it stays inline on the page; Decline hands focus to the Room
title (`e2e/room-invite-dialog.e2e.ts`).

## Round room

A debater's live round (`/rounds/[id]/room`, ADR 0054, ADR 0097) has no app
shell: a full-width section with the round bar, the video and the
three-column controls, then the workspace on one line below it. Files is on
the left, the open documents are in the centre, and a sidebar on the right
switches between Transcript, Channels and AI chat, the same in every Round.
Below 901px one panel shows at a time behind bottom tabs. Leave is alone in the round bar's far corner; every step of
its confirm is a link, so it works without script. Mics follow the server:
the room shows `Mic live` or `Mic closed` and never a Mute control. A
human judge appears only as `Judge present`; the judge's name never
reaches the debaters' browsers. Tile height follows the phase. Controls with no
backend are shown disabled, never faked.

After the last speech the room is in its judging window (30 minutes,
ADR 0053): the clock counts the window down, the controls offer Report a
problem instead of Tech issue, a Ballots section lists each ballot with its
status (the deciding ballot `Writing`, any AI ballot beside a human judge
`Ready` or `Writing`), Room lists the judge as `Judge · Writing
ballot`, and the sidebar's Transcript tab shows the completed transcript. The judge's
ballot completes the round (DEC-80), so round sync hands the
debaters to the receipt at `/rounds/[id]`, which shows the result and keeps
a human judge's seat unnamed.

## Judge's room

An assigned human judge's live round (`/rounds/[id]/room`, `ui/judging-room`)
follows every step as well as the debaters do, from the same position reader:
`observedRoundOf` (`features/round-runtime/observed-round.ts`) is the Round as
anyone without a debater's seat sees it, and the spectator view reads it too.
A Now panel names the stage (the strike, the prep before the round, each
speech and cross-examination by code and full name, in-round prep, the end of
the speeches), runs its clock with the same `RoundClock` every seat uses, says
who has the floor and what comes next, and shows each side's prep left. Steps
that run on their own say so, because the judge has no control that starts
them. The speech order lists every speech with its length and Done, Now or
Next. Each new stage is announced once, politely, and takes focus to the Now
heading only when nothing else holds focus. Once the speeches end, the
judging window counts down to the persisted deadline and Open your ballot is
the primary action. The room renders no `main` of its own: the bare layout
owns the landmark.

The ballot page says how the ballot works before the form (one winner and no
draws, 1 to 5 in every category, a low-point win confirmed, a reason both
debaters read, private feedback, the limits and the 30-minute window with its
time left). Each rubric category has a visible disclosure of what a 1, 3 and
5 look like. What the judge has entered is kept in this tab's sessionStorage
until the ballot is recorded, so a reload never loses it; a refusal's posted
values win over it.

## Document manager

One manager opens at `/prep` and inside a Round (ADR 0111, ADR 0113): `ui/documents`
draws the tree, search, tabs and editor, fills the frame a page gives it and draws
none of its own. At `/prep` the frame is the whole middle section. Files holds compact
rows, Recent and My drive. `+` opens a palette in the middle of the screen to choose
Document or Folder, search opens the same palette, and another `+` ends the tabs. A
row's actions are one flat menu. A document has no page layout and no ring while
someone types. Rows and tools take a dense target under a fine pointer and the 44px
target under a finger. Below 901px one panel shows at a time, and a row opens the
document itself (DEC-141).

## Spectator view

The audience's view of a Round (`/watch/[roundId]`) stays inside the app
shell. The speaker is large with the other debater inset, using the round
room's video tile, and the phase and clock sit in a strip under the stage;
once the debate ends both debaters show side by side. The header carries
Live, the spectator delay and the audience count, with Report and Leave.
The live column has two tabs, Transcript and Chat, chosen by `?pane=` so
they work without script, over the chat composer; reactions sit at the top
of Chat. The report dialog opens from `?report=`. Spectators never see a
debater's flow document.

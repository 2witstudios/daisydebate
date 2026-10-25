# Local demo

Play a whole Round on one machine with real people in real browsers. `bun demo`
serves the production build through the same composition the Round browser
proofs use ([Round browser proof](round-browser-proof.md)). That composition
includes the web app with every Round worker, apps/realtime, TLS edges for the
app, realtime and LiveKit, a mail capture for sign-in links, and the attendance
probe. `bun dev` cannot do this: the Round workers that open speeches, freeze
the transcript, judge and finish a Round start only in the production server.

## Set up once

```sh
bun install --frozen-lockfile
cp .env.example .env        # skip if you already have one
bun slot:up                 # Postgres, Redis and LiveKit; this checkout's databases
bun doctor                  # should pass, including the LiveKit check
bun run build               # the demo serves this production build
```

You need Docker, Bun, and Google Chrome.

## Start the demo

```sh
bun slot:reset-e2e          # optional: start from empty demo data
bun demo
```

`bun demo` uses this checkout's e2e database, so `bun slot:reset-e2e` erases
earlier demo accounts and Rounds. When it is ready it prints the address
(`https://localhost:<E2E_PORT+1>`) and one Chrome command per person. Each
command opens an isolated profile that trusts only this demo's certificate. Run
one command per person and allow the camera and microphone when asked.
Ctrl-C stops everything and deletes the certificate.

For a bot opponent or an AI judge, start it with a real OpenRouter key instead:

```sh
E2E_OPENROUTER_API_KEY=<key> bun demo
```

Without a key, a bot cannot speak, and an AI judge is refused by OpenRouter. The
judge then gives no ruling, and the Round ends "Judges did not rule" at the
ballot deadline, 30 minutes after the transcript freezes.

## Sign in

In each browser:

1. Enter any address (for example `ann@demo.test`) and choose **Continue**.
2. In a terminal, print that address's sign-in link and open it in the same
   browser:

   ```sh
   bun demo:link ann@demo.test
   ```

3. Choose **Sign in to Daisy Debate**, pick a username, and choose **Not now**
   for the passkey. You can skip the welcome tour by going straight to **Play**.

All local browsers share one address, and sign-in links are rate limited. If a
link does not arrive, wait a minute and ask again.

## Two people: human against human

The **Foundation** template has two speeches and no judge. It finishes
"Unjudged".

1. Host: **Play**, then **Open a casual room**. Choose the Foundation
   template, a Room name and topic, **Who can find the room: Public**, then
   **Create room**.
2. Host: **Edit settings**, set each constructive speech to 1:00 so the demo is
   short, and **Save settings**.
3. Second person: open the same Room address, or find it under **Join a room**.
4. Everyone takes a seat first: **Take Affirmative 1** and **Take Negative 1**.
   Taking a seat or saving settings clears everyone's Ready, so seat everyone
   before anyone readies.
5. Each person: **Check camera**, **Check microphone**, then **I am ready**.
6. Host: **Launch**. The other person's Room page shows **View Round**; open it.
7. Host: **Start round**. Each speech runs its full time (Foundation has no
   early end). About two minutes after the last speech, the transcript freezes
   and both pages show **Result · Unjudged**.

## Three people: a judged Round

Use the **One-on-one** template. It has seven turns, cross-examination,
interruption and yielding, plus one judge seat.

- A third person takes **Judge 1**. The judge does no device check, but must be
  Ready.
- The speaker holding the floor can end a speech early (**End speech**, then
  **Confirm end speech**). A debater can interrupt the other side's
  cross-examination (**Interrupt**), and use prep before their own speech (**Use
  prep**, then **Start …**).
- About two minutes after the last speech, the judge's ballot opens from the
  Judge page. Submitting it shows **Result · … won** to everyone.

## Human against a bot, with the AI judge

Start the demo with `E2E_OPENROUTER_API_KEY`. The host creates a One-on-one
Room, opens **Manage seats**, assigns an eligible bot to **Negative 1** and an
AI judge to **Judge 1** (choose each from **Assign …**, then **Assign**), then
takes Affirmative 1, readies, and launches. The bot speaks through TTS on its
turns. The demo runs no capture worker, so the transcript freezes
`incomplete` and no AI judging is dispatched (DEC-208): with no human judge,
the Round completes at the freeze as **transcript incomplete**, with no winner.

This path has not been followed on a machine without a provider key. The
automated journey, `round-journeys.e2e.ts` ('actual human against a bot…'),
still expects an AI ruling; ISSUE-488 tracks reconciling it with DEC-208.

## Limits

- **Localhost only.** Two machines on a LAN are not supported yet. The demo
  certificate names `localhost`, and local LiveKit offers loopback ICE
  candidates only (see ISSUE-479). Every listener binds 127.0.0.1: the
  plaintext web app and realtime answer only the loopback TLS edges in front
  of them (ISSUE-480).
- **Local LiveKit only.** There is no production media, TURN or real-network
  delivery. Two profiles on one machine share its camera and microphone.
- **No capture worker.** Speech is not transcribed, so every transcript freezes
  `incomplete`. Human judges still rule; an AI judge never rules on an
  incomplete transcript (DEC-208).
- **Fixture settings.** The Room policy and the AI busy cap of 4 come from the
  browser-proof fixture, not product policy.
- **Demo data lives in the e2e database.** `bun slot:reset-e2e` and the browser
  suites erase it.

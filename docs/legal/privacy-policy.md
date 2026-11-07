# Privacy Policy — draft for counsel

**DRAFT, not in force.** Version `draft-3`. This file is the source of truth for the draft (WAIT-6.1); the PageSpace page of the same name mirrors it. It is not served by the app. Publishing this broader draft still waits on WAIT-6.2 (owner and counsel) and WAIT-6.3, together with the clickwrap version. The separately owner-authorized analytics notice update to the served `/privacy` is described under “Analytics publication scope” below; it does not publish this draft.

Placeholders: **[OWNER: …]** is a business fact the owner supplies; **[COUNSEL: …]** is a legal judgment for counsel. Neither may remain in a published version.

What Daisy Debate collects during the beta, why, how long we keep it, who processes it for us, and how to see or delete it.

## Who we are

Daisy Debate is operated by [OWNER: legal entity name], [OWNER: registered postal address]. We decide how and why your personal data is used, which makes us the controller of it.

For privacy questions and requests, write to privacy@daisydebate.com. [COUNSEL: confirm whether an EU or UK representative or a data protection officer is required, and add their contact if so.]

## What we collect

Your email address, which you give to sign in. Sign-in is by an emailed link or a passkey; we never ask for a password. For a passkey we store its public key, its name and technical details your device reports, never anything that would let us sign in as you.

Your birth month and year (for example 2008-05), never a full date of birth. We use it to check you meet the age requirement and to work out your age band.

Your username, which you choose after signing in, and the date your account was created.

The answers you give to the optional onboarding questions: what you want to do on Daisy (debate, coach, judge or watch), the topics you like, whether you are joining, starting or running a debate club, your experience and the formats you prefer.

For each signed-in session, the browser user agent, so you can recognise and end your sessions in Settings, and the IP address it was created from, so we can protect accounts from misuse. We never show the IP address to you or anyone else.

What you do in debates: the rooms you host or join, your side, the arguments you write, the results, ballots and written reasons, and the AI feedback on your rounds. When a round uses live audio, a written transcript of what each debater said.

Documents and folders you create, the friends you add, the challenges you send and receive, the status you choose, reports you file or that name you, and the record of your beta access (when you asked and when it was approved or withdrawn).

Records that an email was sent and delivered or bounced. These hold a keyed one-way hash of the address, not the address itself.

When error tracking is on: technical details of unexpected software failures — the failing operation's name, an error code, and the code path that failed — joined to the random account identifier only. Error reports never contain your email address, username, IP address, what you typed or said, or the content of any request. [OWNER: applies from the first deployment that sets the error tracker's keys; scrubbing is enforced in code (ADR 0037).]

## Why we use it, and our lawful basis

To provide the account and the service you asked for: signing you in, running rounds, judging and rating them, and showing your record. Lawful basis: performance of our contract with you (the terms of service).

Your birth month: to apply the age requirement in the terms and to offer age-appropriate features and safeguards. Lawful basis: our contract with you, compliance with legal obligations that protect young people, and our legitimate interest in safeguarding. [COUNSEL: confirm this combination; the owner decision (DEC-244) names legal obligation and contract, and the waitlist plan names contract and legitimate interests.]

Your session IP address and user agent: to keep accounts secure and let you review your sessions. Lawful basis: our legitimate interest in security.

Your optional onboarding answers: to personalise what we suggest to you. Lawful basis: our contract with you. You can skip them.

Operational logs: to run, secure and fix the service. Our application’s logs record what happened (for example a refused sign-in), never your email, username, IP address or what you said. Our hosting platform and our live audio and video relay keep their own technical logs, which can include IP addresses. [OWNER: confirm what those technical logs contain and how long they are kept.] Lawful basis: our legitimate interest in a secure, working service.

When error tracking is on: technical failure reports, so we can find and fix faults in the service. They carry the random account identifier and the technical details of the failure, and nothing that identifies you personally. Lawful basis: our legitimate interest in a secure, working service.

We do not sell your personal data or use it for advertising. When a round is judged by AI, the AI decides its result, which can change your rating in a ranked round. [OWNER: state how a member can ask for an AI result to be reviewed by a person.] [COUNSEL: confirm whether AI judging and ratings are automated decision-making that needs further disclosure or safeguards.]

## Speech, transcripts and AI

When a round uses live audio, short clips of your speech are sent to our AI provider to be turned into text. For transcription we do not keep the audio: it is held in memory only until it is transcribed. Recording a round is a separate thing, described under “Ranked rounds and recordings”.

To judge a round, give feedback, or let an AI opponent reply, the AI provider receives the resolution and the transcript, labelled by side and seat only, never with your name, username or email.

Transcripts of casual rounds and AI feedback are deleted 180 days after they are created; ranked transcripts are kept with ranked video, and an AI ballot still awaiting a result is discarded 180 days after it arrives. [COUNSEL: confirm the disclosure of AI processing and whether the provider’s zero-retention terms need to be named here.]

## Who can see it

Public to anyone, signed in or not, from the moment you choose a username (even while your beta access is pending): your profile page with your username, when you joined, your record of wins, losses and draws, and your completed public debates (the resolution, your side, the result and whether the judging was human or AI). Your username also appears in the public debate history of the people you debated.

Debates whose host made them unlisted or private appear only on your own view of your profile. Other people in a debate see your username, your side and what you say in it, and any signed-in member can open a public or unlisted debate’s room and read what was said there.

Other signed-in members see your username in the list of members, whether or not you are online, unless you have blocked them or they have blocked you. They also see whether you are online, away, busy, in a room or in a round; if you appear offline, you show as offline. Your card shows your record and your Freestyle rating, and your Policy and Value ratings if you turn them on; ladders show them regardless. Never shown to other members: your email address, birth month, sessions, IP address and onboarding answers.

People who run Daisy can see the beta access list (username, request and decision dates) through a separate, private administration app, so that they can approve testers. It does not show email addresses. They also see reports members file there: who reported whom, the reason and where it was made, never a copy of any conversation. A report's outcome can be a warning, a suspension or a ban.

## Ranked rounds and recordings

Ranked rounds are always public, and are broadcast with a delay and recorded when capture has capacity. Before you can be Ready for one you sign the ranked content waiver once per season, and each ranked round shows you a notice first. We keep a record of each: your account, the version and the time. Lawful basis: our contract with you, and our legitimate interest in being able to show what you agreed to. [COUNSEL: confirm.]

We keep ranked video, with the results and ballots, as Daisy’s content for as long as Daisy runs ranked seasons, including after you close your account, because ranked season rounds are qualifying artifacts for tournaments: the results and the video stand as the evidence behind qualification, disputes and integrity review. Lawful basis: our contract with you, and our legitimate interest in the integrity of qualification. Moderation can still take a recording down. [COUNSEL: this purpose, basis and period are proposed and not yet reviewed (COMP-4, docs/operations/compliance.md).]

On any other round, recording happens only if the host opts in, and you are told before you are Ready. A casual recording is kept until any participant removes it, and then the whole recording goes.

A subscriber can download a recording they can watch. A copy outside Daisy is beyond our reach, so neither erasure nor takedown can remove it.

## Service providers and international transfers

Fly.io hosts the service, its databases and the live audio and video relay, in [OWNER: hosting region, for example the United States]. Everything we hold is stored there. Tigris stores broadcast and recorded video, on Fly.io. [OWNER: confirm the Tigris region and contract (PRIV-H).]

Resend sends our email: sign-in links, security notices and beta access emails. It receives your email address and the message.

Sentry receives our error reports, when error tracking is on: the technical details of unexpected software failures described above, joined to your random account identifier, never your email address, username or IP address.

OpenRouter routes speech-to-text and AI requests to the AI models we use. It receives speech clips and anonymised transcripts as described above. [COUNSEL: confirm whether the model providers OpenRouter routes to must be listed individually.]

When optional analytics is enabled and you opt in, PostHog processes bounded product usage and playback-quality facts in the United States, using a random browser identifier or your account identifier. These facts cover product areas visited, Room creation and rematches, analytics consent changes, and broadcast or recording player type, time to start, buffering time, time watched and video height. They do not include names, usernames, emails, debate content, the identity of what you watched, raw URLs, referrers or form contents. PostHog receives connection metadata; location enrichment and automatic click capture are disabled. Session replay stays disabled. We use analytics to understand product use and playback quality, on your consent, which you can refuse or withdraw at /analytics or in Settings. Not answering counts as no.

The owner selected the existing 2witstudios Default project 699106, US Cloud, Free plan (1M events/month), with one-year event retention, on 2026-11-06. On 2026-11-07 the owner authorized signing and enabling PostHog; the DPA signature was completed, PostHog Legal shows Signed, and the signed agreement includes DPF and applicable standard contractual clauses. The focused served notice was verified live before capture was enabled. This factual status update does not publish or approve this broader draft. [COUNSEL: review this draft’s processing disclosures; the executed vendor agreement does not constitute approval of this draft. Global PRIV-H remains open.]

We do not use advertising, session-replay or newsletter providers during the beta.

These providers are based in the United States, so your data is transferred to and processed in the United States. [COUNSEL: name the transfer safeguard relied on for each provider, such as the EU-US Data Privacy Framework or standard contractual clauses, and confirm data processing agreements are in place.]

## How long we keep it

Your account data (email, username, birth month, onboarding answers, terms acceptance, friends and debate record) is kept while your account exists. Reports are kept while open and [COUNSEL: confirm: 12 months] after they close, and a moderation action is kept with the account. If you close your account, reports and moderation actions about it stay for that same period, and your name comes off reports you filed.

A sign-in session lasts up to 7 days of inactivity and its record is deleted 24 hours after it expires, or straight away when you sign it out. Sign-in links expire after 5 minutes and are deleted within a day.

Email delivery records are deleted after 30 days. A record that an address bounced or complained, kept only as a one-way hash, is kept so we do not email it again.

Our application’s logs are kept no longer than 30 days. The hosting platform’s and the live audio and video relay’s technical logs follow their own retention, as stated under “Why we use it”.

Transcripts of casual rounds and AI feedback are deleted after 180 days; ranked transcripts are kept with ranked video, and an AI ballot still awaiting a result is discarded 180 days after it arrives.

[OWNER: decide and state how long an account that never finishes sign-up is kept; today it is not deleted automatically.]

## Age requirements and children

You must be 16 or older to use Daisy. Optional onboarding questions are only ever asked of members 16 or older.

When you sign up we ask your birth month and year. If you are under 13, or under the beta minimum age, we tell you so in neutral words and keep nothing you entered: the account that started to be created is deleted immediately, with its sign-in links and sessions.

To stop the age answer being retried at once, your browser keeps a cookie for 24 hours that records only whether sign-up was refused for being under 13 or for being under the beta minimum age. It holds no name, email or identifier. [COUNSEL: confirm whether that age bracket is personal data on a shared device.]

We do not knowingly collect personal data from children under 13. If you believe a child under 13 has given us data, contact privacy@daisydebate.com and we will delete it. [COUNSEL: confirm COPPA and age-appropriate design obligations for 13 to 17 year olds once the minimum age drops to 13.]

## Cookies

Session cookie: keeps you signed in. Strictly necessary, httpOnly, lasts up to 7 days.

Passkey cookie: holds the one-time challenge while you sign in or add a passkey. Strictly necessary, lasts 5 minutes.

Age-refusal cookie: set only when sign-up is refused for age, as described above. Lasts 24 hours and records only which age rule refused it.

Theme cookie: remembers whether you chose the light, dark or system theme. Lasts one year.

Unlisted Round link cookie: set when you open a link to an unlisted Round, so that you and its video can return to it. Strictly necessary, httpOnly, lasts 7 days, and holds that link alone.

Navigation rail cookies: remember whether you collapsed the navigation rail and whether you opened or closed the list of who is online. Each lasts one year and is read only by our servers.

Note-erasing cookie: set when you confirm closing your account, so the next page can erase the note copies kept in this browser. Lasts 60 seconds and holds no name, email or identifier.

For as long as a tab stays open, your browser keeps the ids of challenge rooms that tab has already taken you to, so it does not take you back.

Your browser also keeps copies of unsaved edits to your documents in its local storage, not in a cookie, so unsaved work can be recovered. Each copy is deleted seven days after it was saved, or sooner when you sign out, close your account from this browser, or another account signs in here. If your session simply expires the copies stay in this browser, hidden, until you return or they expire. [COUNSEL: confirm this description and the retention for a shared computer; the owner's decision is DEC-290.]

Consent cookie: records this browser's analytics answer. Strictly necessary, HttpOnly, lasts 180 days. Account consent is stored until account erasure. Analytics identity cookies are set only after opt-in, with a one-year SDK expiry; browser storage also holds consent/identity synchronization and SDK session state. Signing out resets analytics identity but preserves this browser's consent. A newly signed-in account without a recorded choice adopts the browser choice; an existing account choice takes priority. [COUNSEL: review device-scoped consent adoption before activation (PRIV-H).]

We use no advertising cookies. Withdrawing analytics stops future capture and clears browser analytics identity. Signed-in withdrawal or account closure queues deletion of linked PostHog data; outages are retried and physical deletion is asynchronous. Earlier unlinked anonymous events expire under the selected one-year vendor retention. PostHog may retain expired events longer and deletes them in batches; that period is not a guaranteed physical-deletion deadline. Local account erasure does not wait for the vendor.

## Your rights

You can ask to access, correct, export or delete your personal data, to restrict or object to how we use it, and to withdraw consent where we rely on it. You can also complain to your data protection authority.

In Settings you can end sessions, manage passkeys and your sign-in email, export your data records and close your account. An export holds data records, not video: downloading a recording is a paid feature. For anything else, write to privacy@daisydebate.com. We will answer within [COUNSEL: response period, for example one month].

When an account is closed we delete your email address, name and image, sessions, passkeys, birth month, onboarding answers, terms acceptance, beta access record, documents and folders, friends, messages, audience chat and reactions, follows, watch history and the transcripts of what you said in casual rounds. Your username stays on the results, rounds, ballots and ratings you took part in, marked closed, and is never given to anyone else; room titles, topics and resolutions stay with the rounds they were debated in. Ranked rounds also keep their video, and your signed waiver and notice records stay as the evidence of what you agreed to. We keep them because other members’ records and tournament qualification depend on them (legitimate interest). You can object, and we will review your objection. [COUNSEL: confirm the legitimate-interest basis and the objection procedure (COMP-4, docs/operations/compliance.md).] Documents you created in debate rooms are not yet removed with the account; you can ask us to remove them.

While your beta access is pending or withdrawn you can still reduce your own footprint, as the terms of service describe under “The beta and the waiting list”.

## Changes to this policy

When we change this policy we update the version at the top of the page and, for a material change, tell you before it applies. [COUNSEL: confirm the notice period and method for material changes.]

---

## Notes for the owner and counsel (not part of the policy)

The draft describes the beta as the code behaves on main after #471, not as a plan describes it. These notes are for the owner and counsel and are never published. Gaps found while drafting, each tracked:

- **No deletion or export entry point.** Erasure and export are implemented in `packages/db/src/privacy` but nothing calls them, so requests must go by email until [ISSUE-833](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/sjd7whfx0gua2orgd508j5rd) ships an operator or self-service path. Erasure keeps the username and competitive record (ADR 0087, DEC-261); the policy must say so. The draft says so in an [OWNER] placeholder.
- **No re-acceptance on a new version, and the privacy version is not recorded:** [ISSUE-720](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/ka7qt1wj6nwde0k8agw3ok4c).
- **Provisional accounts are never purged:** [ISSUE-721](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/bz2ejqkv8jkreve7ow1ywq70). The retention section has an [OWNER] placeholder for the period.
- **Settings privacy, newsletter and ladder controls save nothing:** [ISSUE-722](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/xsj3wvnwe385a3ouh3zabvqw).
- **Not in the beta, so not in the policy:** a newsletter (beehiiv), direct messages and file attachments (built but switched off). Each needs a policy update before it is turned on. PostHog product analytics was activated with owner authorization on 2026-11-07; session replay stays disabled.
- **Error tracking (Sentry) is wired in code, inert without its keys** (ADR 0037), and the draft above now describes it (scrubbed events, `user.id` only). Keys stay off until PRIV-H records the account, region and DPA; the processor row in [compliance](../operations/compliance.md) says the same.
- **Lawful basis for birth month:** DEC-244 (owner) names legal obligation and contract; the waitlist plan names contract and legitimate interests. The draft states all three with a [COUNSEL] placeholder.
- **Clickwrap wording:** the sign-up checkbox reads "I agree to the Terms and the Privacy notice", but the terms draft says the privacy policy is not a contract. WAIT-6.3 should make the checkbox "I agree to the Terms of Service and have read the Privacy Policy", and link the page title "Privacy policy" consistently.
- **Publishing is a material change:** WAIT-6.3 raises the beta floor in the text to 16, adds a content licence, beta withdrawal and username reclaiming. Existing members accepted `draft-0`, so re-acceptance ([ISSUE-720](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/ka7qt1wj6nwde0k8agw3ok4c)) should ship before or with publication.
- **Build prerequisites before WAIT-6.3 publishes** (moved out of the text; each is tracked):
  - Direct messages, groups and file attachments are built but switched off in the beta; the policy must describe them, with their retention, before they are switched on.
  - Any newsletter (beehiiv) or session replay needs a policy update before it is configured. PostHog product analytics and Sentry error tracking have disclosure text in this draft. PostHog-specific signing and activation are recorded in the operational runbook; Sentry activation and other global PRIV-H obligations remain separately gated.
  - An operator or self-service entry point for deletion and export (PRIV-4), and the Settings controls the rights section should then point to.
  - Erasure of room titles, topics and resolutions, debate-room documents (ISSUE-383) and judge reasons, so the rights section can promise full deletion.
  - Re-acceptance of a new terms version (ISSUE-720); the terms promise it under “Changes to these terms”.
  - Pending members cannot yet remove a friend or cancel a friend request ([ISSUE-726](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/lgf98lco05ycbwn1gi2xgv2l)); the terms list only what the code admits today (leaving a room and forfeiting a round; blocking is also admitted but is switched off with messaging in the beta).
  - The terms reserve the right to reserve and reclaim usernames and to correct results; neither has a mechanism yet.
  - The documents.test.ts guard (every placeholder is OWNER or COUNSEL, none survives a non-draft version) should come back when WAIT-6.3 imports this text into the app.

## Analytics publication scope (owner-authorized 2026-11-06)

The focused served analytics notice is maintained separately in `apps/web/src/features/legal/documents.ts`, originally with privacy version `draft-0.3`; `draft-0.4` clarifies expiry versus physical deletion. It covers the existing adapter and event registry, including playback quality, and must be published before keys enable capture. Owner authorization of that notice does not approve or publish this broader counsel draft. The operational selection and remaining human obligations are recorded in [product analytics](../operations/product-analytics.md) and [compliance](../operations/compliance.md). PRIV-H remains open; no keys or live capture are enabled by the documentation change.

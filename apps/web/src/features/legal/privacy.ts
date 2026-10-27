import type { LegalDocument } from './documents';
import { PRIVACY_VERSION } from './versions';

/**
 * The privacy policy draft for counsel (WAIT-6.1), written from what the
 * beta actually collects and sends today (docs/operations/privacy.md,
 * ADR 0036, DEC-42, DEC-106, DEC-126, DEC-244, DEC-248, DEC-251, DEC-252).
 * Not in force until WAIT-6.2 approves it and WAIT-6.3 publishes it.
 */
export const privacyDocument: LegalDocument = {
  title: 'Privacy policy',
  version: PRIVACY_VERSION,
  lede: 'Draft for counsel review, not yet in force. What Daisy Debate collects during the beta, why, how long we keep it, who processes it for us, and how to see or delete it.',
  sections: [
    {
      id: 'who-we-are',
      heading: 'Who we are',
      paragraphs: [
        'Daisy Debate is operated by [OWNER: legal entity name], [OWNER: registered postal address]. We decide how and why your personal data is used, which makes us the controller of it.',
        'For privacy questions and requests, write to [OWNER: privacy contact email]. [COUNSEL: confirm whether an EU or UK representative or a data protection officer is required, and add their contact if so.]',
      ],
    },
    {
      id: 'what-we-collect',
      heading: 'What we collect',
      paragraphs: [
        'Your email address, which you give to sign in. Sign-in is by an emailed link or a passkey; we never ask for a password. For a passkey we store its public key, its name and technical details your device reports, never anything that would let us sign in as you.',
        'Your birth month and year (for example 2008-05), never a full date of birth. We use it to check you meet the age requirement and to work out your age band.',
        'Your username, which you choose after signing in, and the date your account was created.',
        'The answers you give to the optional onboarding questions: what you want to do on Daisy (debate, coach, judge or watch), the topics you like, your club, your experience and the formats you prefer.',
        'For each signed-in session, the IP address and the browser user agent it was created from, so you can see and end your sessions and so we can protect accounts from misuse.',
        'What you do in debates: the rooms you host or join, your side, the arguments you write, the results, ballots and written reasons, and the AI feedback on your rounds. When a round uses live audio, a written transcript of what each debater said.',
        'Documents you create in a debate room, the friends you add and whether you show as online, and the record of your beta access (when you asked and when it was approved or withdrawn).',
        'Records that an email was sent and delivered or bounced. These hold a keyed one-way hash of the address, not the address itself.',
        '[OWNER: direct messages, groups and file attachments are built but switched off during the beta. Describe them here, with their retention, before switching them on.]',
      ],
    },
    {
      id: 'why-and-lawful-basis',
      heading: 'Why we use it, and our lawful basis',
      paragraphs: [
        'To provide the account and the service you asked for: signing you in, running rounds, judging and rating them, and showing your record. Lawful basis: performance of our contract with you (the terms of service).',
        'Your birth month: to apply the age requirement in the terms and to offer age-appropriate features and safeguards. Lawful basis: our contract with you, compliance with legal obligations that protect young people, and our legitimate interest in safeguarding. [COUNSEL: confirm this combination; the owner decision (DEC-244) names legal obligation and contract, and the waitlist plan names contract and legitimate interests.]',
        'Your session IP address and user agent: to keep accounts secure and let you review your sessions. Lawful basis: our legitimate interest in security.',
        'Your optional onboarding answers: to personalise what we suggest to you. Lawful basis: our contract with you. You can skip them.',
        'Operational logs: to run, secure and fix the service. They record what happened (for example a refused sign-in), never your email, username, IP address or what you said. Lawful basis: our legitimate interest in a secure, working service.',
        'We do not sell your personal data, use it for advertising, or make decisions about you that have legal or similarly significant effects by automated means alone. AI judging decides the result of a practice debate only. [COUNSEL: confirm the automated decision-making statement covers AI judging and ratings.]',
      ],
    },
    {
      id: 'ai',
      heading: 'Speech, transcripts and AI',
      paragraphs: [
        'When a round uses live audio, short clips of your speech are sent to our AI provider to be turned into text. We do not record or keep the audio: it is held in memory only until it is transcribed.',
        'To judge a round, give feedback, or let an AI opponent reply, the AI provider receives the resolution and the transcript, labelled by side and seat only, never with your name, username or email.',
        'Transcripts, AI ballots awaiting a result and AI feedback are deleted 180 days after they are created. [COUNSEL: confirm the disclosure of AI processing and whether the provider’s zero-retention terms need to be named here.]',
      ],
    },
    {
      id: 'who-sees-it',
      heading: 'Who can see it',
      paragraphs: [
        'Public to anyone, signed in or not: your profile page with your username, when you joined, your win and loss record and your completed public debates (the resolution, your side, the result and whether the judging was human or AI).',
        'Debates whose host made them unlisted or private appear only on your own view of your profile. Other people in a debate see your username, your side and what you say in it.',
        'Never shown to other members: your email address, birth month, sessions, IP address and onboarding answers.',
        'People who run Daisy can see the beta access list (username, request and decision dates) through a separate, private administration app, so that they can approve testers. It does not show email addresses.',
      ],
    },
    {
      id: 'processors',
      heading: 'Service providers and international transfers',
      paragraphs: [
        'Fly.io hosts the service, its databases and the live audio and video relay, in [OWNER: hosting region, for example the United States]. Everything we hold is stored there.',
        'Resend sends our email: sign-in links, security notices and beta access emails. It receives your email address and the message.',
        'OpenRouter routes speech-to-text and AI requests to the AI models we use. It receives speech clips and anonymised transcripts as described above. [COUNSEL: confirm whether the model providers OpenRouter routes to must be listed individually.]',
        'We do not use advertising, analytics, session-replay or newsletter providers during the beta. [OWNER: update this section before adding any, including the beehiiv newsletter, Sentry or PostHog.]',
        'These providers are based in the United States, so your data is transferred to and processed in the United States. [COUNSEL: name the transfer safeguard relied on for each provider, such as the EU-US Data Privacy Framework or standard contractual clauses, and confirm data processing agreements are in place.]',
      ],
    },
    {
      id: 'retention',
      heading: 'How long we keep it',
      paragraphs: [
        'Your account data (email, username, birth month, onboarding answers, terms acceptance, friends and debate record) is kept while your account exists.',
        'A sign-in session lasts up to 7 days of inactivity and its record is deleted 24 hours after it expires, or straight away when you sign it out. Sign-in links expire after 5 minutes and are deleted within a day.',
        'Email delivery records are deleted after 30 days. A record that an address bounced or complained, kept only as a one-way hash, is kept so we do not email it again.',
        'Operational logs are kept no longer than 30 days.',
        'Transcripts, AI ballots awaiting a result and AI feedback are deleted after 180 days.',
        '[OWNER: decide and state how long an account that never finishes sign-up is kept; today it is not deleted automatically.]',
      ],
    },
    {
      id: 'children',
      heading: 'Age requirements and children',
      paragraphs: [
        'You must be 16 or older to use Daisy during the beta. After the beta the minimum age will be 13. [OWNER: confirm the post-beta minimum age.] Optional onboarding questions are only ever asked of members 16 or older.',
        'When you sign up we ask your birth month and year. If you are under 13, or under the beta minimum age, we tell you so in neutral words and keep nothing you entered: the account that started to be created is deleted immediately, with its sign-in links and sessions.',
        'To stop the age answer being retried at once, your browser keeps a cookie for 24 hours that only records that sign-up was refused. It does not identify you.',
        'We do not knowingly collect personal data from children under 13. If you believe a child under 13 has given us data, contact [OWNER: privacy contact email] and we will delete it. [COUNSEL: confirm COPPA and age-appropriate design obligations for 13 to 17 year olds once the minimum age drops to 13.]',
      ],
    },
    {
      id: 'cookies',
      heading: 'Cookies',
      paragraphs: [
        'Session cookie: keeps you signed in. Strictly necessary, httpOnly, lasts up to 7 days.',
        'Passkey cookie: holds the one-time challenge while you sign in or add a passkey. Strictly necessary, lasts 5 minutes.',
        'Age-refusal cookie: set only when sign-up is refused for age, as described above. Lasts 24 hours and holds no personal data.',
        'Theme cookie: remembers whether you chose the light, dark or system theme. Lasts one year.',
        'We use no advertising or analytics cookies and no other tracking technologies, and we do not set a cookie that carries a chosen username between pages. [COUNSEL: confirm that no consent banner is required for this set of cookies.]',
      ],
    },
    {
      id: 'your-rights',
      heading: 'Your rights',
      paragraphs: [
        'You can ask to access, correct, export or delete your personal data, to restrict or object to how we use it, and to withdraw consent where we rely on it. You can also complain to your data protection authority.',
        'Today you can end sessions and manage passkeys and your sign-in email in Settings. For anything else, including deleting your account or getting a copy of your data, write to [OWNER: privacy contact email]. We will answer within [COUNSEL: response period, for example one month]. [OWNER: replace with the Settings controls once self-service export and deletion ship.]',
        'When an account is deleted we remove your email, username and everything that identifies you, and the transcripts of what you said. Results you took part in remain as an anonymous entry so other people’s records stay correct. [OWNER: account deletion is implemented but has no operator or self-service entry point yet; provide one before the beta opens publicly.]',
        'Even while your beta access is pending or withdrawn, you can always reduce your own footprint: leave a room, remove a friend, cancel your own requests and forfeit a round.',
      ],
    },
    {
      id: 'changes',
      heading: 'Changes to this policy',
      paragraphs: [
        'When we change this policy we update the version at the top of the page and, for a material change, tell you before it applies. [COUNSEL: confirm the notice period and method for material changes.]',
      ],
    },
  ],
};

import { PRIVACY_CONTACT } from './contact';
import { PRIVACY_VERSION, TERMS_VERSION } from './versions';

type LegalSection = {
  /** Anchor id, unique within the document. */
  readonly id: string;
  readonly heading: string;
  readonly paragraphs: readonly string[];
};

export type LegalDocument = {
  readonly title: string;
  readonly version: string;
  readonly lede: string;
  readonly sections: readonly LegalSection[];
};

/** The terms of service as the product states them today. */
export const termsDocument: LegalDocument = {
  title: 'Terms of service',
  version: TERMS_VERSION,
  lede: 'The rules for using Daisy Debate: who may join, how we expect people to debate, and what each side can count on.',
  sections: [
    {
      id: 'who-can-join',
      heading: 'Who can join',
      paragraphs: [
        'You must be 16 or older to make an account.',
        'One person holds one account. You sign in with an email link or a passkey, and you keep the sign-in methods you use private.',
      ],
    },
    {
      id: 'debating-here',
      heading: 'How we expect you to debate',
      paragraphs: [
        'Argue the resolution, not the person. You may use any help you like during a round, including notes, other people and AI. Harassment, threats, hate speech, doxxing, and cheating (a second account or arranged results) end a round and can end an account.',
        'Judges decide on what was said in the round. A judge may give a written reason, and both debaters can see it.',
      ],
    },
    {
      id: 'ratings-and-results',
      heading: 'Ratings and results',
      paragraphs: [
        'Ranked results change your rating. Casual, practice and unrated tournament rounds never do, and the room says which kind it is before you start.',
        'We may correct a result or a rating when a round was disrupted by a technical fault or by a rule breach. We record the correction and show it as an amended result.',
      ],
    },
    {
      id: 'your-content',
      heading: 'What you post',
      paragraphs: [
        'In a ranked round, Daisy owns what is said and shown, under the ranked content waiver you sign once per season. Ranked rounds are always public, broadcast and recorded, and their video and transcript stay after you close your account. Anyone may stream and post them under the ranked content policy.',
        'In any other round, your content stays with you and the other participants. You give Daisy Debate permission to store it, show it to the people in the round and to the audience where the room allows, and keep a recording when the host opted in and the room says so.',
        'Prep material and drives stay yours on every kind of round, and are private to you until you share them with a person or a team you choose.',
      ],
    },
    {
      id: 'tournaments',
      heading: 'Tournaments',
      paragraphs: [
        'An organizer runs a tournament under these terms and the rules they publish on its page. Daisy assigns judges, and organizers cannot choose them.',
        'Honours and certificates are recognition only and never change a rating.',
      ],
    },
    {
      id: 'ending-an-account',
      heading: 'Leaving, and being removed',
      paragraphs: [
        'You can close your account at any time. Your username stays on the results you took part in, marked closed, so other people’s results remain accurate, and nobody else can take it. Ranked video and transcripts stay too, because Daisy owns them.',
        'We may suspend or remove an account that breaks these terms. We tell you why, and you can answer.',
      ],
    },
    {
      id: 'limits',
      heading: 'What we do not promise',
      paragraphs: [
        'Daisy Debate is provided as it is. We work to keep rounds running and fair, but we cannot promise the service will never be interrupted, and we are not liable for losses that follow an interruption.',
      ],
    },
    {
      id: 'changes',
      heading: 'Changes to these terms',
      paragraphs: [
        'When these terms change, the version number at the top of this page changes with them.',
      ],
    },
  ],
};

/** The privacy policy as the product states it today. */
export const privacyDocument: LegalDocument = {
  title: 'Privacy policy',
  version: PRIVACY_VERSION,
  lede: 'What Daisy Debate keeps about you, why, for how long, and how to see it, correct it or have it deleted.',
  sections: [
    {
      id: 'what-we-keep',
      heading: 'What we keep',
      paragraphs: [
        'Your email address and username, your sign-in methods, the sessions and devices you are signed in on, and your age band (we keep the month and year you gave, not a date of birth we do not need).',
        'Your debate record: the rooms you joined, the results and ballots, your ratings, and recordings of rounds that were recorded. Ranked rounds also keep a transcript.',
        'Your prep library and anything you chose to share, and your settings. If you take part in an audience: your chat messages and reactions, who you follow, and what you have watched.',
      ],
    },
    {
      id: 'why',
      heading: 'Why we keep it',
      paragraphs: [
        'To run your account and the rounds you take part in, to keep ratings and standings correct, to keep the service safe, and to send the email you ask for.',
        'Where we rely on your consent, such as the newsletter and optional analytics and replay, you can say no and you can change your mind at any time. Not answering counts as no.',
      ],
    },
    {
      id: 'who-sees-it',
      heading: 'Who sees it',
      paragraphs: [
        'Your username and ratings are public on the ladder unless you hide them. Your email is never shown to other members.',
        'Other people in a round see what they need to take part: your username, your side, and what you say in it. The audience of a public or unlisted round sees and hears its debaters, on a delay, and reads its chat. Nobody needs an account to watch.',
        'We use a small number of service providers: to run the service and hold its data (Fly.io), to store video (Tigris), to send email, to run the newsletter, to turn speech into text and run AI judging, and to find and fix errors. They process data for us and may not use it for their own purposes.',
      ],
    },
    {
      id: 'watching',
      heading: 'Watching, and cookies',
      paragraphs: [
        'You can watch with no account. We then keep no profile of you: a random token in your browser counts viewers, your network address is only used briefly to limit abuse, and opening an unlisted link sets one cookie for that round.',
        'Signed in, necessary cookies keep your session. Optional analytics and replay stay off unless you say yes.',
      ],
    },
    {
      id: 'how-long',
      heading: 'How long we keep it',
      paragraphs: [
        'Account data is kept while the account is open. Sign-in sessions and verification links expire on their own. Prep material follows the visibility you chose, and you can delete it. A casual recording is kept until any participant removes it, and then the whole recording goes. Transcripts of casual rounds are deleted after 180 days. Ranked video and transcripts are kept for as long as Daisy runs ranked seasons. Your watch history is kept for a year, and audience chat and reactions for 180 days.',
        'When you close your account we delete your email, sign-in, private profile, messages, audience chat and reactions, follows, watch history and what you said in casual rounds, and any casual recording you took part in goes whole. Your username, results and the rounds you played stay on the public record, marked closed, so other people’s standings do not change. Ranked video and transcripts, and your signed ranked content waiver, stay too: Daisy owns ranked content. One exception: a recording taken down under an open report is kept hidden until the report closes or 90 days pass, then deleted.',
      ],
    },
    {
      id: 'your-rights',
      heading: 'Your choices and rights',
      paragraphs: [
        `From Settings you can export your data records and close your account. An export holds your data records, not video: downloading a recording is a paid feature, for those who can watch it. To correct something, object to how we use your data, or make any other request, write to ${PRIVACY_CONTACT}.`,
        'You can decline optional analytics and replay, and you can unsubscribe from the newsletter from any issue.',
      ],
    },
    {
      id: 'young-members',
      heading: 'Members under 18',
      paragraphs: [
        'You must be 16 or older to have an account. We do not target schools, and we do not sell personal data.',
      ],
    },
    {
      id: 'contact',
      heading: 'Contact',
      paragraphs: [
        `Questions about privacy, or any request about your data: ${PRIVACY_CONTACT}.`,
      ],
    },
  ],
};

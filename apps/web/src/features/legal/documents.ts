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
        'You must be 13 or older to make an account. Members under 18 debate in a youth band and can be paired with adults in unrated and casual rooms only where a parent or guardian has agreed to these terms for them.',
        'One person holds one account. You sign in with an email link or a passkey, and you keep the sign-in methods you use private.',
      ],
    },
    {
      id: 'debating-here',
      heading: 'How we expect you to debate',
      paragraphs: [
        'Argue the resolution, not the person. Harassment, threats, hate speech, doxxing, and cheating (outside help during a round, a second account, or arranged results) end a round and can end an account.',
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
        'You own what you write and say. You give Daisy Debate permission to store it, show it to the people in the round and to spectators where the room allows, and keep a recording of a debate when the room says it is being recorded.',
        'Prep material you save is private to you until you share it with a person or a team you choose.',
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
        'You can delete your account at any time from settings. Your past results stay in standings and records as an anonymous entry so other people’s results remain accurate.',
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
        'When a change is material we show the new version and ask you to accept it before you debate again. The version number at the top of this page changes with it.',
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
        'Your debate record: the rooms you joined, the results and ballots, your ratings, and recordings of rounds that were recorded.',
        'Your prep library and anything you chose to share, and your settings.',
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
        'Other people in a round see what they need to take part: your username, your side, and what you say in it. Spectators see only what the room allows.',
        'We use a small number of service providers to send email, to run the newsletter, and to find and fix errors. They process data for us and may not use it for their own purposes.',
      ],
    },
    {
      id: 'how-long',
      heading: 'How long we keep it',
      paragraphs: [
        'Account data is kept while the account is open. Sign-in sessions and verification links expire on their own. Recordings and prep material follow the visibility you chose, and you can delete them.',
        'When you delete your account we remove what identifies you. Results you took part in stay as an anonymous entry so other people’s standings do not change.',
      ],
    },
    {
      id: 'your-rights',
      heading: 'Your choices and rights',
      paragraphs: [
        'You can see, correct, export and delete your data from settings. If something is missing there, write to us and we will do it.',
        'You can decline optional analytics and replay, and you can unsubscribe from the newsletter from any issue.',
      ],
    },
    {
      id: 'young-members',
      heading: 'Members under 18',
      paragraphs: [
        'Members aged 13 to 15 are not offered the newsletter or the optional interests step. We do not target schools, and we do not sell personal data.',
      ],
    },
    {
      id: 'contact',
      heading: 'Contact',
      paragraphs: [
        'Questions about privacy, or a request to see or delete your data, can be sent from Settings, under Privacy.',
      ],
    },
  ],
};

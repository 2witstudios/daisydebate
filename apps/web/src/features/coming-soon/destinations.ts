/** The eight product destinations, in landing order. */
export const destinationSlugs = [
  'ranked',
  'lobby',
  'watch',
  'judge',
  'tournaments',
  'leaderboard',
  'train',
  'prep',
] as const;

export type DestinationSlug = (typeof destinationSlugs)[number];

type DestinationStep = {
  readonly title: string;
  readonly body: string;
};

/** What the public explainer says about one destination that is not open yet. */
export type Destination = {
  readonly slug: DestinationSlug;
  readonly title: string;
  /** One line, shown on the landing tile and under the explainer title. */
  readonly tagline: string;
  readonly what: string;
  readonly steps: readonly DestinationStep[];
  readonly abilities: readonly string[];
};

/**
 * Explainer copy for every destination, taken from the coming-soon boards.
 * The mocks' format names are dropped on purpose: Daisy has one debate,
 * called Ranked, with one rating per player per season.
 */
export const destinations: Readonly<Record<DestinationSlug, Destination>> = {
  ranked: {
    slug: 'ranked',
    title: 'Ranked',
    tagline: 'Climb the ladder. Prove yourself.',
    what: 'Ranked is where your rating is earned. There is one ladder per season, and every ranked debate runs the standard rules, so a rating means the same thing everywhere.',
    steps: [
      {
        title: 'Find a match',
        body: 'Press Find a match, or host a ranked table in the lobby.',
      },
      {
        title: 'Get paired',
        body: 'You are matched with someone close to your rating, and a judge is assigned for you.',
      },
      {
        title: 'Debate',
        body: 'Both sides speak under the standard rules and clocks.',
      },
      {
        title: 'Move the ladder',
        body: 'Ballots come in, your rating updates, and the season ladder moves.',
      },
    ],
    abilities: [
      'Matchmaking by rating',
      'Season ladders and decay rules',
      'Eligibility and conduct rules',
    ],
  },
  lobby: {
    slug: 'lobby',
    title: 'Lobby',
    tagline: 'Find a debate. Any topic. Any skill level.',
    what: 'The lobby lists open tables that players have hosted and live rooms you can watch. Anyone can host a casual or a ranked table, and you can filter by rating and more.',
    steps: [
      {
        title: 'Browse',
        body: 'Search and filter by ranked or casual, and rating range.',
      },
      {
        title: 'Take a seat or host',
        body: 'Take an open seat, or host your own table and set who may join.',
      },
      {
        title: 'Start when ready',
        body: 'Once both seats are filled and ready, the debate begins.',
      },
      {
        title: 'Or get matched',
        body: 'Press Find a match and Daisy pairs you automatically.',
      },
    ],
    abilities: [
      'Open tables and live rooms in one list',
      'Filters, search and sort by rating',
      'Ranked tables with a rating band',
    ],
  },
  watch: {
    slug: 'watch',
    title: 'Watch',
    tagline: 'Live debates and recordings, all in one place.',
    what: 'Watch lets you follow any public debate as it happens, and replay finished ones. You see the phase, the clock and the speeches, with moderated chat alongside.',
    steps: [
      {
        title: 'Pick a live room',
        body: 'See who is speaking, the phase and how many are watching.',
      },
      {
        title: 'Follow along',
        body: 'A phase timeline and clock keep you oriented.',
      },
      {
        title: 'React',
        body: 'Send quick reactions and join the moderated chat.',
      },
      {
        title: 'Replay later',
        body: 'Every finished debate joins the recordings archive with its timeline.',
      },
    ],
    abilities: [
      'Spectator rooms with delayed state',
      'Live phase and clock display',
      'Reactions and moderated chat',
      'Recordings archive',
    ],
  },
  judge: {
    slug: 'judge',
    title: 'Judge',
    tagline: 'Help uphold fair play. Be a judge.',
    what: 'Judges decide debates. You never pick your rounds: the system assigns you, so nobody can steer who judges whom, and ratings stay hidden while you judge.',
    steps: [
      {
        title: 'Mark yourself available',
        body: 'Tell Daisy when you can judge.',
      },
      {
        title: 'Get assigned',
        body: 'You are matched to a debate that fits, after conflicts are checked.',
      },
      {
        title: 'Score the round',
        body: 'Fill in a structured ballot and explain your reasons.',
      },
      {
        title: 'Submit your decision',
        body: 'Ballots are reviewed under the conflict policy.',
      },
    ],
    abilities: [
      'Assignment and availability',
      'Structured ballot submission',
      'Conflict and review policy',
    ],
  },
  tournaments: {
    slug: 'tournaments',
    title: 'Tournaments',
    tagline: 'Compete in events. Win recognition.',
    what: 'Tournaments are organized bracket and round-robin events. Organizers run them on Daisy, and players register, get paired each round and advance on results. Tournament debates are unrated.',
    steps: [
      {
        title: 'Organizer creates it',
        body: 'Pick a schedule and the size.',
      },
      {
        title: 'Players register',
        body: 'Entries fill, with waitlists if needed.',
      },
      {
        title: 'Pairings each round',
        body: 'Daisy pairs entrants and assigns judges.',
      },
      {
        title: 'Advance and win',
        body: 'Results move the bracket and set the final standings.',
      },
    ],
    abilities: [
      'Creation and registration',
      'Pairings and advancement',
      'Organizer and moderator tooling',
    ],
  },
  leaderboard: {
    slug: 'leaderboard',
    title: 'Leaderboard',
    tagline: 'See the top debaters in the world.',
    what: 'One ladder, refreshed every season. New players show as provisional until they have played enough ranked debates for the rating to settle.',
    steps: [
      {
        title: 'Play ranked',
        body: 'Every ranked debate counts toward the season ladder.',
      },
      {
        title: 'Start provisional',
        body: 'Your rating moves quickly while it settles.',
      },
      {
        title: 'Become established',
        body: 'After enough debates your rating is marked established.',
      },
      {
        title: 'Season snapshots',
        body: 'Each season closes with a snapshot of the final ladder.',
      },
    ],
    abilities: [
      'A season rating ladder',
      'Seasonal snapshots',
      'Provisional and established display',
    ],
  },
  train: {
    slug: 'train',
    title: 'Train',
    tagline: 'Practice arguments. Sharpen your mind.',
    what: 'Train is for getting better between debates. Practice against a paced prompt, run short drills that check your structure, and review what you saved.',
    steps: [
      {
        title: 'Choose a mode',
        body: 'Guided practice, argument drills or spaced review.',
      },
      {
        title: 'Practice',
        body: 'Debate a paced prompt, or write one argument at a time.',
      },
      {
        title: 'Get feedback',
        body: 'See instantly whether your claim, warrant and impact are there.',
      },
      {
        title: 'Review later',
        body: 'Saved arguments return on a schedule so they stick.',
      },
    ],
    abilities: [
      'Guided practice against paced prompts',
      'Argument drills with instant structure feedback',
      'Spaced review of saved arguments',
    ],
  },
  prep: {
    slug: 'prep',
    title: 'Prep',
    tagline: 'Briefs, cases, and evidence cards.',
    what: 'Prep is your debate library. Keep evidence with its citation, assemble briefs and cases, and find anything fast.',
    steps: [
      {
        title: 'Collect evidence',
        body: 'Save cards with the source, author and date attached.',
      },
      {
        title: 'Build briefs',
        body: 'Structure contentions and framing in one file.',
      },
      {
        title: 'Assemble cases',
        body: 'Version a case and share it with your team.',
      },
      {
        title: 'Find it fast',
        body: 'Search and filter across the whole library.',
      },
    ],
    abilities: [
      'Briefs with contentions and framing',
      'Evidence cards with citation provenance',
      'Cases: versions and sharing',
      'Search and filter everything',
    ],
  },
};

/** The destination for an untrusted route segment, or null when unknown. */
export const findDestination = (slug: string): Destination | null =>
  (destinationSlugs as readonly string[]).includes(slug)
    ? destinations[slug as DestinationSlug]
    : null;

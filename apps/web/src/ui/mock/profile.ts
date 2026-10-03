type Honour = {
  readonly title: string;
  readonly detail: string;
};

type Achievement = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
};

/** What a profile shows beyond the ladder: since when, verified, region. */
export type ProfileExtras = {
  /** `October 2025`. */
  readonly memberSince: string;
  readonly verified: boolean;
  readonly region: string | null;
  readonly honours: readonly Honour[];
  readonly achievements: readonly Achievement[];
};

const hash = (text: string): number =>
  [...text].reduce((sum, char) => sum + char.charCodeAt(0), 0);

const regions = ['Europe', 'North America', 'Asia-Pacific', null] as const;

const allAchievements: readonly Achievement[] = [
  {
    id: 'first-win',
    label: 'First win',
    description: 'Won a first debate.',
  },
  {
    id: 'ten-ranked',
    label: 'Ten ranked debates',
    description: 'Finished ten ranked debates.',
  },
  {
    id: 'judge-25',
    label: 'Judged 25 rounds',
    description: 'Submitted 25 ballots.',
  },
  {
    id: 'streak-5',
    label: 'Five in a row',
    description: 'Won five debates in a row.',
  },
  {
    id: 'tournament',
    label: 'Tournament debut',
    description: 'Entered a first tournament.',
  },
];

/**
 * Sample extras for a profile, derived from the username so the same name
 * always reads the same. The backend read of the account replaces this
 * function and nothing else.
 */
export function sampleProfileExtras(
  username: string,
  now: string,
): ProfileExtras {
  const seed = hash(username);
  const joined = new Date(Date.parse(now));
  joined.setUTCMonth(joined.getUTCMonth() - ((seed % 18) + 2));
  return {
    memberSince: joined.toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }),
    verified: seed % 3 === 0,
    region: regions[seed % regions.length] ?? null,
    honours:
      seed % 2 === 0
        ? [
            { title: 'Champion', detail: 'Spring Open' },
            { title: 'Runner-up', detail: 'Summer Invitational' },
          ]
        : seed % 5 === 0
          ? []
          : [{ title: 'Semifinalist', detail: 'Winter Open' }],
    achievements: allAchievements.slice(0, 2 + (seed % 4)),
  };
}

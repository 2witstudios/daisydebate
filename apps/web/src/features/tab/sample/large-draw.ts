import type {
  DrawView,
  DrawViewFixture,
} from '@daisy/protocol/lobby/draw-read';
import { sampleId } from './fixture';
import { largeJudge, largeSurname, largeEntrySchool } from './large-names';

/**
 * Autumn Open's round 4 draft at scale: 200 entries in 100 fixtures, in four
 * record groups. The ordinary draft's fixtures lead their groups under the
 * same addresses; seven fixtures in all carry a finding.
 */
type Finding = DrawViewFixture['findings'][number];

/** How many fixtures each record group holds, most wins first. */
const groupSizes: readonly (readonly [number, number])[] = [
  [3, 13],
  [2, 37],
  [1, 37],
  [0, 13],
];

/** The generated fixtures that carry a finding, by group and place. */
const flagged: ReadonlyMap<string, Finding> = new Map([
  [
    '2:4',
    { severity: 'preference_bent', text: 'same school, preference bent' },
  ],
  [
    '2:5',
    {
      severity: 'preference_bent',
      text: 'judged one of them in round 2, preference bent',
    },
  ],
  [
    '1:0',
    {
      severity: 'preference_bent',
      text: 'takes Affirmative a third time, preference bent',
    },
  ],
  ['1:1', { severity: 'note', text: 'pulled up from 0 wins' }],
] as const);

const fixture = (
  id: string,
  title: string,
  judge: string,
  findings: readonly Finding[],
): DrawViewFixture => {
  const [affirmative = '', negative = ''] = title.split(' v ');
  return {
    fixtureId: id,
    kind: 'pairing',
    status: 'draft',
    entries: [
      {
        entryId: sampleId(`entry${affirmative}`),
        name: affirmative,
        school: largeEntrySchool(affirmative),
        side: 'affirmative',
      },
      {
        entryId: sampleId(`entry${negative}`),
        name: negative,
        school: largeEntrySchool(negative),
        side: 'negative',
      },
    ],
    judges: [
      {
        tournamentJudgeId: sampleId(`judge${judge}`),
        name: judge,
        chair: true,
      },
    ],
    findings: [...findings],
    reasons: [
      `${affirmative} and ${negative} are on the same record and have not met.`,
    ],
    alternative: null,
  };
};

const slugOf = (title: string) =>
  title.toLowerCase().replaceAll(' v ', '-').replaceAll(' ', '-');

/**
 * The ordinary draft grown to 100 fixtures, with the address slug of every
 * fixture (the ordinary ones keep theirs).
 */
export function largeDrawView(ordinary: DrawView): {
  readonly read: DrawView;
  readonly slugs: ReadonlyMap<string, string>;
} {
  const known = ordinary.recordGroups.filter((group) => group.wins >= 2);
  const used = new Set(
    known.flatMap((group) =>
      group.fixtures.flatMap((one) => one.entries.map((entry) => entry.name)),
    ),
  );
  const names = Array.from({ length: 220 }, (_, n) => largeSurname(n))
    .filter((name) => !used.has(name))
    .values();
  const next = () => names.next().value ?? 'Ellis';
  const slugs = new Map<string, string>();
  let judge = 30;
  const recordGroups = groupSizes.map(([wins, size]) => {
    const kept = known.find((group) => group.wins === wins)?.fixtures ?? [];
    const made = Array.from({ length: size - kept.length }, (_, place) => {
      const title = `${next()} v ${next()}`;
      const id = sampleId(`fixturelarge${wins}n${place}x`);
      const finding = flagged.get(`${wins}:${place}`);
      slugs.set(id, slugOf(title));
      judge += 1;
      return fixture(
        id,
        title,
        largeJudge(judge),
        finding === undefined ? [] : [finding],
      );
    });
    return { wins, fixtures: [...kept, ...made] };
  });
  return {
    read: {
      ...ordinary,
      recordGroups,
      spareJudges: [9, 10, 11, 12, 13].map((n) => ({
        tournamentJudgeId: sampleId(`judge${largeJudge(n)}`),
        name: largeJudge(n),
      })),
    },
    slugs,
  };
}

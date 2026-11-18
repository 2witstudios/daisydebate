import type {
  PoolResolution,
  ResolutionPoolView,
  RoundResolutionRule,
} from '@daisy/protocol/lobby/resolution-read';
import { AUTUMN, reached, VARSITY } from './moment';
import type { SampleScene } from './scene';

/** A sample record's id: its name, as a 24-character cuid2-shaped id. */
const sampleId = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .padEnd(24, '0')
    .slice(0, 24);

const fromLeague = (text: string): PoolResolution => ({
  id: sampleId(`resolution${text}`),
  origin: { kind: 'pool', poolName: "Southeast League's November pool" },
  hold: null,
  text: { kind: 'shown', text },
});

const round = (number: number, name: string | null = null) => ({
  id: sampleId(`tabround${number}`),
  number,
  name,
});

const strikeFive = {
  method: 'strike',
  drawSize: 5,
  strikeWindowMs: 60_000,
  firstStriker: 0,
} as const;

const FINAL_TEXT = 'Public transport should be free in every city.';

export function sampleResolutionPoolView(
  slug: string,
  event: string,
  scene: SampleScene,
): ResolutionPoolView | null {
  if (slug !== AUTUMN || event !== VARSITY) return null;
  const before = !reached(scene, 'prelims');
  const released = reached(scene, 'finished');
  const final = round(7, 'Final');
  const rules: RoundResolutionRule[] = [
    {
      tabRounds: [round(1), round(2), round(3)],
      rule: strikeFive,
      changeable: before,
      releaseLeadMs: null,
    },
    {
      tabRounds: [round(4)],
      rule: strikeFive,
      changeable: true,
      releaseLeadMs: null,
    },
    {
      tabRounds: [round(5, 'Quarterfinals')],
      rule: { method: 'draw', release: 'with_posting' },
      changeable: true,
      releaseLeadMs: null,
    },
    {
      tabRounds: [round(6, 'Semifinals')],
      rule: strikeFive,
      changeable: true,
      releaseLeadMs: null,
    },
    {
      tabRounds: [final],
      rule: { method: 'fixed', release: 'manual' },
      changeable: true,
      releaseLeadMs: 900_000,
    },
  ];
  return {
    lobbyId: sampleId('autumnopen'),
    eventId: sampleId('eventvarsity'),
    counts: { fromPool: 18, addedHere: before ? 0 : 2 },
    shortfall: before ? { drawSize: 5, needed: 20 } : null,
    resolutions: [
      fromLeague('Cities should charge drivers to enter the centre.'),
      fromLeague('Buses should be free for under-18s.'),
      fromLeague('Streets beside schools should be closed to cars.'),
      fromLeague('New housing should be built without parking.'),
      ...(before
        ? []
        : [
            {
              id: sampleId('resolutionescooters'),
              origin: {
                kind: 'lobby',
                addedBy: { name: 'Lena Cho', roleName: 'Topic committee' },
              },
              hold: null,
              text: {
                kind: 'shown',
                text: 'Cities should allow e-scooters on pavements.',
              },
            } as const,
            {
              id: sampleId('resolutionfreetransport'),
              origin: {
                kind: 'lobby',
                addedBy: { name: 'Lena Cho', roleName: 'Topic committee' },
              },
              hold: { tabRoundName: 'Final', released },
              text: { kind: 'shown', text: FINAL_TEXT },
            } as const,
          ]),
    ],
    rules,
    unreleased:
      before || released
        ? []
        : [
            {
              tabRound: final,
              text: { kind: 'shown', text: FINAL_TEXT },
              releasesAt: '2026-11-14T18:15:00.000Z',
              readerRoles: ['Topic committee'],
            },
          ],
    capabilities: { edit: true, release: true },
  };
}

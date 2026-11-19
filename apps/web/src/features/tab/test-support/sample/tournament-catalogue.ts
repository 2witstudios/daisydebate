import type { ListedLobby } from '@daisy/protocol/lobby/lobby-read';
import type { TournamentDivision } from '@daisy/protocol/lobby';
import { LEAGUE, LEAGUE_NAME } from './moment';
import { at, sampleId } from './posting';

type ListedTournament = Extract<ListedLobby, { kind: 'tournament' }>;

/** A place a tournament runs in. */
type SamplePlace = {
  readonly city: string;
  readonly latitude: number;
  readonly longitude: number;
};

type SampleLeague = {
  readonly key: string;
  readonly name: string;
  readonly cities: readonly SamplePlace[];
};

const place = (
  city: string,
  latitude: number,
  longitude: number,
): SamplePlace => ({ city, latitude, longitude });

const leagues: readonly SampleLeague[] = [
  {
    key: LEAGUE,
    name: LEAGUE_NAME,
    cities: [
      place('Atlanta, GA', 33.749, -84.388),
      place('Marietta, GA', 33.953, -84.55),
      place('Athens, GA', 33.951, -83.357),
      place('Jackson, MS', 32.299, -90.185),
      place('Birmingham, AL', 33.519, -86.81),
      place('Savannah, GA', 32.081, -81.091),
    ],
  },
  {
    key: 'gulf-coast',
    name: 'Gulf Coast League',
    cities: [
      place('New Orleans, LA', 29.951, -90.072),
      place('Houston, TX', 29.76, -95.37),
      place('Mobile, AL', 30.695, -88.04),
      place('Baton Rouge, LA', 30.452, -91.187),
    ],
  },
  {
    key: 'capital-debate',
    name: 'Capital Debate League',
    cities: [
      place('Washington, DC', 38.907, -77.037),
      place('Richmond, VA', 37.541, -77.436),
      place('Baltimore, MD', 39.29, -76.612),
      place('Arlington, VA', 38.88, -77.107),
    ],
  },
  {
    key: 'great-lakes',
    name: 'Great Lakes Forensics League',
    cities: [
      place('Chicago, IL', 41.878, -87.63),
      place('Detroit, MI', 42.331, -83.046),
      place('Milwaukee, WI', 43.039, -87.906),
      place('Cleveland, OH', 41.499, -81.694),
    ],
  },
  {
    key: 'pacific-speech',
    name: 'Pacific Speech League',
    cities: [
      place('San Diego, CA', 32.716, -117.161),
      place('Portland, OR', 45.515, -122.679),
      place('Seattle, WA', 47.606, -122.332),
      place('Sacramento, CA', 38.582, -121.494),
    ],
  },
  {
    key: 'mountain-west',
    name: 'Mountain West League',
    cities: [
      place('Phoenix, AZ', 33.448, -112.074),
      place('Denver, CO', 39.739, -104.99),
      place('Salt Lake City, UT', 40.761, -111.891),
      place('Albuquerque, NM', 35.084, -106.65),
    ],
  },
  {
    key: 'lone-star',
    name: 'Lone Star Debate League',
    cities: [
      place('Austin, TX', 30.267, -97.743),
      place('Dallas, TX', 32.777, -96.797),
      place('Cedar Park, TX', 30.505, -97.82),
      place('San Antonio, TX', 29.424, -98.494),
    ],
  },
  {
    key: 'northeast-parli',
    name: 'Northeast Parli League',
    cities: [
      place('Boston, MA', 42.36, -71.058),
      place('Providence, RI', 41.824, -71.413),
      place('Hartford, CT', 41.764, -72.685),
      place('Manchester, NH', 42.995, -71.455),
    ],
  },
];

const prefixes = [
  'Peachtree',
  'Bayou',
  'Capitol Hill',
  'Magnolia',
  'Evergreen',
  'Lakeshore',
  'Kingsbridge',
  'Desert Sun',
  'Lone Star',
  'Granite State',
  'Harbor City',
  'Old Dominion',
  'Cedar Park',
  'Tri-County',
  'Riverbend',
  'Hilltop',
  'Pinecrest',
  'Bluebonnet',
  'Golden Gate',
  'Blue Ridge',
  'Iron Range',
  'Prairie Wind',
  'Silver Lake',
  'Red Rock',
  'Oak Hollow',
  'Summit',
  'Coastal Plains',
  'North Star',
  'Willow Creek',
  'Stonebridge',
  'Heritage',
  'Cypress Bay',
  'Maple Grove',
  'Twin Rivers',
  'Westfield',
  'Juniper',
  'Highland',
  'Founders',
  'Lighthouse',
  'Canyon View',
];

const suffixes = [
  'Invitational',
  'Classic',
  'Open',
  'Swing',
  'Cup',
  'Novice Open',
  'Showcase',
  'Round Robin',
  'Challenge',
  'Speech Festival',
];

const debateFormats = [
  'Lincoln-Douglas',
  'Public Forum',
  'Policy',
  'Parli',
  'British Parliamentary',
  'Congress',
];
const speechFormats = ['Extemp', 'Impromptu', 'Oratory', 'Interp'];

const winners = [
  'Castillo',
  'Okafor',
  'Lindqvist',
  'Ramirez',
  'Nakamura',
  'Adeyemi',
  'Brennan',
  'Holloway',
  'Patel',
  'Whitaker',
];

const hosts = ['mira_k', 'tobias', 'devon.w', 'r_haddad'];

/** mulberry32: a small seeded generator, so the catalogue never changes. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dayMs = 24 * 60 * 60 * 1000;
const FIRST = Date.parse('2026-10-10T00:00:00.000Z');
const LAST_DAY = 82;
/** The sample's today: Autumn Open's day. */
export const CATALOGUE_TODAY = '2026-11-14';
const TODAY_INDEX =
  (Date.parse(`${CATALOGUE_TODAY}T00:00:00.000Z`) - FIRST) / dayMs;
const LIVE_TODAY = 5;
const CATALOGUE_SIZE = 320;

const dayOf = (index: number): string =>
  new Date(FIRST + index * dayMs).toISOString().slice(0, 10);
const shiftDay = (day: string, by: number): string =>
  new Date(Date.parse(`${day}T00:00:00.000Z`) + by * dayMs)
    .toISOString()
    .slice(0, 10);

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const divisionOrder: readonly TournamentDivision[] = [
  'novice',
  'jv',
  'varsity',
  'open',
];

function generate(): readonly ListedTournament[] {
  const random = seeded(20261114);
  const pick = <T>(from: readonly T[]): T =>
    from[Math.floor(random() * from.length)] as T;
  const some = <T>(from: readonly T[], most: number): T[] => {
    const wanted = 1 + Math.floor(random() * most);
    const chosen = new Set<T>();
    while (chosen.size < wanted) chosen.add(pick(from));
    return from.filter((one) => chosen.has(one));
  };
  const names = new Set<string>();
  const out: ListedTournament[] = [];
  for (let n = 0; out.length < CATALOGUE_SIZE; n += 1) {
    const league = pick(leagues);
    const suffix = pick(suffixes);
    const base = `${pick(prefixes)} ${suffix}`;
    if (names.has(base)) continue;
    names.add(base);
    // The first few run today; the rest fall mostly on weekends.
    const live = out.length < LIVE_TODAY;
    let index = live ? TODAY_INDEX : Math.floor(random() * LAST_DAY);
    if (!live && random() < 0.75) {
      const weekday = new Date(FIRST + index * dayMs).getUTCDay();
      index += weekday === 0 ? 0 : 6 - weekday - (random() < 0.3 ? 1 : 0);
    }
    if (!live && index === TODAY_INDEX) index += 1;
    const day = dayOf(Math.min(index, LAST_DAY));
    const speech = suffix === 'Speech Festival';
    const online = random() < 0.3;
    const personal = online && random() < 0.2;
    const city = pick(league.cities);
    const startsAt = at(day, online ? pick(['16:00', '18:00']) : '09:00');
    const status =
      day < CATALOGUE_TODAY
        ? 'completed'
        : day === CATALOGUE_TODAY
          ? 'running'
          : 'open';
    const closesAt = at(shiftDay(day, -3), '17:00');
    const roll = random();
    const capacity = roll < 0.5 ? null : 16 + Math.floor(random() * 6) * 16;
    const full = status === 'open' && capacity !== null && roll > 0.85;
    const opensLater =
      status === 'open' && roll > 0.4 && roll < 0.5 && day > '2026-12-01';
    const school = random() < 0.4 ? `${pick(prefixes)} High` : null;
    const handle = slug(base);
    out.push({
      kind: 'tournament',
      lobbyId: sampleId(`catalogue/${handle}`),
      handle,
      name: base,
      owner: personal
        ? {
            kind: 'person',
            actorId: sampleId(`catalogue/person/${n % hosts.length}`),
            username: hosts[n % hosts.length] ?? 'mira_k',
          }
        : {
            kind: 'organization',
            organizationId: sampleId(league.key),
            organizationKind: 'league',
            name: league.name,
          },
      hostedBy: personal ? null : school,
      status,
      startsAt,
      events: speech
        ? some(speechFormats, 3)
        : some(debateFormats, 2).concat(
            random() < 0.2 ? [pick(speechFormats)] : [],
          ),
      concurrentEvents: random() < 0.5,
      divisions:
        suffix === 'Novice Open'
          ? ['novice']
          : some(divisionOrder, 2).sort(
              (a, b) => divisionOrder.indexOf(a) - divisionOrder.indexOf(b),
            ),
      venue: online
        ? { place: 'online' }
        : {
            place: 'in_person',
            city: city.city,
            latitude: city.latitude,
            longitude: city.longitude,
          },
      entry: {
        opensAt: opensLater ? at('2026-11-20', '09:00') : null,
        closesAt,
        capacity,
        taken:
          capacity === null
            ? 8 + Math.floor(random() * 60)
            : full
              ? capacity
              : Math.floor(random() * capacity),
        eligibility: 'anyone',
        limit: null,
      },
      part: null,
      now:
        status === 'running'
          ? { kind: 'live', tabRoundName: `Round ${1 + (n % 4)}` }
          : null,
      finish:
        status === 'completed' ? { winner: pick(winners), viewer: null } : null,
    });
  }
  return out;
}

/**
 * A few hundred tournaments across the country, from 10 October to the end
 * of December, around the sample's today. Generated once from a fixed seed.
 */
export const sampleCatalogue: readonly ListedTournament[] = generate();

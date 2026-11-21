import { hostRoutes, tabRoutes } from '../../routes';
import type { AddressOf, TabPlace } from '../../tournament';
import { AUTUMN, CHAMPIONSHIP, SCRIMMAGE, VARSITY, WINTER } from './moment';
import { at, sampleId } from './posting';
import { sampleRoomIds } from './rooms';

const BP = { key: 'british-parliamentary', name: 'British Parliamentary' };

// Where the sample's places live.

/** The sample's events, by the key its addresses use. */
const eventKeys = new Map(
  [
    [AUTUMN, [VARSITY, 'novice-debate', 'impromptu']],
    [
      WINTER,
      [
        'varsity-ld',
        'novice-ld',
        'varsity-pf',
        'parli',
        'impromptu',
        'oratory',
        'extemp',
        'interp',
      ],
    ],
    [CHAMPIONSHIP, [BP.key]],
  ].flatMap(([lobby, keys]) =>
    (keys as readonly string[]).map((key) => [
      sampleId(`${String(lobby)}/${key}`),
      key,
    ]),
  ),
);
const roomKeys = new Map(sampleRoomIds.map((key) => [sampleId(key), key]));
/** The sample's pages: which tournaments and host pages it has. */
const tournamentPages = new Set([AUTUMN, WINTER, SCRIMMAGE, CHAMPIONSHIP]);
const hostPages: Readonly<Record<string, readonly string[]>> = {
  [AUTUMN]: ['setup', 'events', 'entries', 'people', 'standings', 'results'],
  [WINTER]: ['events', 'people'],
};
const winterSlot = sampleId(`${WINTER}/slot/${at('2026-12-12', '12:00')}`);

/** Where each place the sample has a page for lives; null where it has none. */
export const sampleAddressOf: AddressOf = (place: TabPlace) => {
  switch (place.kind) {
    case 'tournament':
      return tournamentPages.has(place.handle)
        ? tabRoutes.tournament(place.handle)
        : null;
    case 'round': {
      const event = eventKeys.get(place.eventId);
      return event === undefined
        ? null
        : tabRoutes.round(place.handle, event, String(place.number));
    }
    case 'standings':
      return tabRoutes.standings(place.handle);
    case 'bracket':
      return tabRoutes.bracket(place.handle);
    case 'entries':
      return tabRoutes.entries(place.handle);
    case 'room': {
      const room = roomKeys.get(place.roomId);
      return room === undefined ? null : tabRoutes.room(room);
    }
    case 'live_room': {
      const room = roomKeys.get(place.roomId);
      return room === 'impromptu-section-c' ? tabRoutes.liveRoom(room) : null;
    }
    case 'ballot': {
      const room = roomKeys.get(place.roomId);
      return room === undefined ? null : tabRoutes.ballot(room);
    }
    case 'host':
      if (!(hostPages[place.handle] ?? []).includes(place.page)) return null;
      switch (place.page) {
        case 'setup':
          return hostRoutes.setup(place.handle);
        case 'events':
          return hostRoutes.events(place.handle);
        case 'entries':
          return hostRoutes.entries(place.handle);
        case 'people':
          return hostRoutes.people(place.handle);
        case 'standings':
          return hostRoutes.standings(place.handle);
        case 'results':
          return hostRoutes.results(place.handle);
      }
      return null;
    case 'host_round': {
      const event = eventKeys.get(place.eventId);
      return event === undefined || place.handle !== AUTUMN
        ? null
        : hostRoutes.round(place.handle, event, String(place.number));
    }
    case 'host_slot':
      return place.timeSlotId === winterSlot
        ? hostRoutes.slot(place.handle, '1200')
        : null;
    case 'past_tournaments':
      return null;
  }
};

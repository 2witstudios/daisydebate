import type {
  GuardianView,
  WardAccountView,
  WardEntryRequestView,
} from '@daisy/protocol/lobby/guardian-read';
import type { WardPronouns } from '../guardian';
import { AUTUMN, WINTER } from './moment';
import type { SampleScene } from './scene';

/** A sample record's id: its name, as a 24-character cuid2-shaped id. */
const sampleId = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .padEnd(24, '0')
    .slice(0, 24);

const CAPITAL = 'capital-city-classic';

/** The sample's wards are referred to as she and her. */
export const samplePronouns: WardPronouns = {
  subject: 'she',
  object: 'her',
  possessive: 'her',
};

const ada = { id: sampleId('userada'), handle: 'ada', name: 'Ada', age: 13 };
const chidi = {
  id: sampleId('userchidi'),
  handle: 'chidi',
  name: 'Chidi',
  age: 16,
};
const lobby = (handle: string, name: string) => ({
  id: sampleId(`lobby${handle}`),
  handle,
  name,
});
const autumn = lobby(AUTUMN, 'Autumn Open');
const winter = lobby(WINTER, 'Winter Classic');
const capital = lobby(CAPITAL, 'Capital City Classic');

const capitalStarts = '2026-12-05T09:00:00.000Z';
const winterStarts = '2026-12-12T09:00:00.000Z';

/** Only a guardian has a family page. */
export function sampleGuardianView(scene: SampleScene): GuardianView | null {
  if (scene.viewer !== 'parent') return null;
  return {
    requests: [
      {
        entryId: sampleId('entryadacapital'),
        ward: { id: ada.id, handle: ada.handle, name: ada.name },
        lobby: capital,
        startsAt: capitalStarts,
        enteredBy: { name: 'Marta Silva', relation: 'coach' },
      },
    ],
    wards: [
      {
        ward: ada,
        linkStatus: 'active',
        allowedLobbyCount: 2,
        capabilities: { manageAccount: true },
        entries: [
          {
            id: sampleId('entryadaautumn'),
            lobby: autumn,
            eventName: 'Impromptu',
            partnerNames: [],
            awaitingGuardian: false,
            timing: { kind: 'today', now: 'Round 3, Section B opens 17:10' },
          },
          {
            id: sampleId('entryadawinter'),
            lobby: winter,
            eventName: 'Impromptu',
            partnerNames: [],
            awaitingGuardian: false,
            timing: { kind: 'upcoming', startsAt: winterStarts },
          },
          {
            id: sampleId('entryadacapital'),
            lobby: capital,
            eventName: 'Impromptu',
            partnerNames: [],
            awaitingGuardian: true,
            timing: { kind: 'upcoming', startsAt: capitalStarts },
          },
        ],
      },
      {
        ward: chidi,
        linkStatus: 'active',
        allowedLobbyCount: 3,
        // Chidi's account page is not drawn in the sample.
        capabilities: { manageAccount: false },
        entries: [
          {
            id: sampleId('entrychidiautumn'),
            lobby: autumn,
            eventName: 'Varsity debate',
            partnerNames: [],
            awaitingGuardian: false,
            timing: {
              kind: 'today',
              now: 'quarterfinal v Haddad, speaking now',
            },
          },
          {
            id: sampleId('entrychidiwinter'),
            lobby: winter,
            eventName: 'Parli',
            partnerNames: ['Leo Brandt'],
            awaitingGuardian: false,
            timing: { kind: 'upcoming', startsAt: winterStarts },
          },
        ],
      },
    ],
  };
}

/** Only a guardian manages a minor's account. */
export function sampleWardAccount(
  minor: string,
  scene: SampleScene,
): WardAccountView | null {
  if (minor !== ada.handle || scene.viewer !== 'parent') return null;
  return {
    ward: ada,
    consentedAt: '2026-09-02T10:00:00.000Z',
    lobbies: [
      {
        id: sampleId('lobbysoutheast'),
        name: 'Southeast League',
        description: null,
        allowed: true,
      },
      {
        id: sampleId('lobbyhomeschool'),
        name: 'Homeschool Forensics Circle',
        description: null,
        allowed: true,
      },
      {
        id: sampleId('lobbydaisypublic'),
        name: "Daisy's public lobby",
        description: 'Anyone on Daisy, 13 and over',
        allowed: false,
      },
    ],
    videoAudienceCap: 'officials',
    capabilities: { manage: true },
  };
}

export function sampleWardEntryRequest(
  minor: string,
  slug: string,
  scene: SampleScene,
): WardEntryRequestView | null {
  if (minor !== ada.handle || slug !== CAPITAL) return null;
  if (scene.viewer !== 'parent') return null;
  return {
    entryId: sampleId('entryadacapital'),
    ward: { id: ada.id, handle: ada.handle, name: ada.name },
    tournament: {
      ...capital,
      startsAt: capitalStarts,
      place: 'online',
      organizerName: 'Capital Debate League',
      recordedFor: 'officials',
    },
    enteredBy: {
      name: 'Marta Silva',
      relation: 'coach',
      organizationName: 'Homeschool Forensics Circle',
    },
    event: {
      name: 'Impromptu',
      summary: 'Three rounds and a final, in rooms of six with two judges',
    },
    videoAudienceCap: 'officials',
    capabilities: { decide: true },
  };
}

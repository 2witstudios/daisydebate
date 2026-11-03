import type { SourceFailureKind } from '../source-failure';
import {
  admissionReconnects,
  type LiveConnection,
  type MediaState,
  type Source,
  type SourceState,
} from './media-state';
import { SOURCES } from './media-state';

export type MediaConnectionLabel =
  | 'connecting'
  | 'reconnecting'
  | 'live'
  | 'out-of-date'
  | 'unavailable'
  | 'ended';

export function connectionOf(state: MediaState): MediaConnectionLabel {
  const { link } = state;
  switch (link.phase) {
    case 'waiting':
      return 'connecting';
    case 'admitting':
      return admissionReconnects(link) ? 'reconnecting' : 'connecting';
    case 'connecting':
      return link.reconnecting ? 'reconnecting' : 'connecting';
    case 'live':
      if (link.establishment.stage === 'establishing')
        return link.establishment.reconnecting ? 'reconnecting' : 'connecting';
      if (link.transport === 'resuming') return 'reconnecting';
      return link.establishment.freshness.status === 'stale'
        ? 'out-of-date'
        : 'live';
    case 'released':
      return 'unavailable';
    case 'ended':
      return 'ended';
  }
}

type EstablishedLive = LiveConnection & {
  readonly establishment: Extract<
    LiveConnection['establishment'],
    { readonly stage: 'established' }
  >;
};
const established = (state: MediaState): EstablishedLive | null =>
  state.link.phase === 'live' &&
  state.link.establishment.stage === 'established'
    ? (state.link as EstablishedLive)
    : null;

type IllHealth = readonly [
  Source,
  SourceFailureKind | 'removal' | 'waiting' | 'stuck',
];

const illHealthOf = (live: LiveConnection): readonly IllHealth[] =>
  SOURCES.flatMap((source): IllHealth[] => {
    const state: SourceState = live.sources[source];
    if (state.phase === 'failed') return [[source, state.kind]];
    if (state.phase === 'stale-publication') return [[source, 'removal']];
    if (state.phase === 'capturing' && state.waiting)
      return [[source, 'waiting']];
    if (
      (state.phase === 'publishing' || state.phase === 'unpublishing') &&
      state.stuck
    )
      return [[source, 'stuck']];
    return [];
  });

const missingOf = (live: LiveConnection): readonly Source[] =>
  SOURCES.filter((source) => {
    const state = live.sources[source];
    return (
      state.phase === 'missing' ||
      (state.phase === 'published' && state.swapped)
    );
  });

const illHealthWord = {
  permission: 'access is denied',
  absence: 'is unavailable',
  failure: 'could not start',
  removal: 'could not be removed from the call',
  waiting: 'is waiting for your browser’s permission',
  stuck: 'is not responding. Retry reconnects everything',
  'preference-unreadable': 'could not be read',
  'preference-invalid': 'is invalid',
} as const;

const isPreferenceFailure = (kind: IllHealth[1]) =>
  kind === 'preference-unreadable' || kind === 'preference-invalid';

const sourceFailureMessage = ([source, kind]: IllHealth) =>
  `${isPreferenceFailure(kind) ? `Your saved ${source} choice` : `Your ${source}`} ${illHealthWord[kind]}.`;

/** Claims nothing about a source without its own evidence; a grant never implies publication. */
const illHealthMessage = (
  bad: readonly IllHealth[],
  live: EstablishedLive,
  ownMuted: boolean,
): string => {
  const [first, second] = bad;
  if (!first) return '';
  if (second)
    return bad.some(([, kind]) => isPreferenceFailure(kind)) ||
      first[1] !== second[1]
      ? bad.map(sourceFailureMessage).join(' ')
      : `Your camera and microphone ${illHealthWord[first[1]].replace(/^is /, 'are ')}.`;
  if (first[0] === 'microphone') return sourceFailureMessage(first);
  const cameraSentence = sourceFailureMessage(first);
  const own = live.tracks.find(
    (track) => track.local && track.source === 'microphone',
  );
  if (!own)
    return live.establishment.media.grants.publish.includes('microphone')
      ? `${cameraSentence} Your microphone is not publishing.`
      : cameraSentence;
  return own.muted || ownMuted
    ? `${cameraSentence} Your microphone is muted.`
    : `${cameraSentence} Your microphone stays live.`;
};

const missingMessage = (missing: readonly Source[], stale: boolean) =>
  `Connected, but ${stale ? 'camera and sound status may be out of date, and ' : ''}your checked ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} missing. Reconnect ${missing.length > 1 ? 'them' : 'it'}, or retry to use your default.`;

const releasedMessages = {
  transient: 'Camera and sound are unavailable. Trying again…',
  definite: 'Camera and sound are unavailable. Retry to reconnect.',
  replaced:
    'This seat connected from another tab or device. Retry here to take it back, which disconnects that one.',
  refused:
    'Camera and sound were refused for this Round. A fresh admission is needed; refresh the page or leave and return once admitted.',
} as const;

const connectingMessage = {
  connecting: 'Connecting camera and sound…',
  reconnecting: 'Reconnecting camera and sound…',
} as const;

/** What the Round media bar says, and whether it offers Retry (ISSUE-573). */
export function statusOf(state: MediaState): {
  readonly message: string;
  readonly retry: boolean;
} {
  const { link } = state;
  if (link.phase === 'released')
    return {
      message: releasedMessages[link.why],
      retry: link.why !== 'refused',
    };
  if (link.phase === 'ended')
    return { message: 'The call has ended.', retry: false };
  const live = established(state);
  if (!live) {
    const reconnecting =
      link.phase === 'admitting'
        ? admissionReconnects(link)
        : link.phase === 'connecting'
          ? link.reconnecting
          : link.phase === 'live' &&
            link.establishment.stage === 'establishing' &&
            link.establishment.reconnecting;
    return {
      message: connectingMessage[reconnecting ? 'reconnecting' : 'connecting'],
      retry: false,
    };
  }
  if (live.transport === 'resuming')
    return { message: connectingMessage.reconnecting, retry: false };
  const stale = live.establishment.freshness.status === 'stale';
  const missing = missingOf(live);
  const bad = illHealthOf(live);
  return {
    message: [
      missing.length > 0
        ? missingMessage(missing, stale)
        : stale
          ? 'Connected, but camera and sound status may be out of date. Retry if this lasts.'
          : 'Connected',
      live.sound === 'blocked'
        ? 'Sound is blocked by your browser. Press Enable sound to play it.'
        : '',
      illHealthMessage(bad, live, state.microphoneMuted),
    ]
      .filter((part) => part !== '')
      .join(' '),
    retry: stale || missing.length > 0 || bad.length > 0,
  };
}

/** The other controls the bar offers. */
export function controlsOf(state: MediaState) {
  const live = established(state);
  const grants = live?.establishment.media.grants.publish ?? [];
  return {
    enableSound: live !== null,
    /** Offered only to a seat that may publish; muting needs a microphone grant. */
    muteOffered: grants.includes('camera'),
    muteEnabled:
      live !== null &&
      !live.changingMicrophone &&
      grants.includes('microphone'),
  };
}

/** What the stage renders. Handles to attach come separately and decide nothing. */
export function stageOf(state: MediaState) {
  const { link } = state;
  const live = link.phase === 'live' ? link : null;
  const settled = established(state);
  return {
    connection: connectionOf(state),
    media: settled?.establishment.media ?? null,
    microphoneConfirmed:
      settled === null || settled.establishment.freshness.status === 'current',
    tracks: live?.tracks ?? [],
    remotePeers: live?.peers ?? [],
    ownIdentity: live?.identity ?? null,
    ownMuted: state.microphoneMuted,
  };
}

export const tabOf = (state: MediaState): 'owned' | 'checking' | 'elsewhere' =>
  state.link.phase === 'waiting' ? state.link.tab : 'owned';

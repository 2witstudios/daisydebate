import type { StageAnswer } from './stage-answer';
import type { StageRoomHandle } from './stage-connection';
import { createStageConnection } from './stage-connector';
import { mayStartRecording } from './stage-fonts';
import { startStagePoll } from './stage-poll';
import {
  applyStageSubscriptions,
  subscribesTo,
  type StageParticipant,
} from './stage-subscriptions';
import { stageWatchStart, watchedStage } from './stage-watch';
import type { StageLink } from './stage-view';

/** One read of the stage: its HTTP status (null for no answer) and its snapshot, if readable. */
export type StageRead = {
  readonly status: number | null;
  readonly next: StageAnswer | null;
};

/** A media room the stage joins: a connection and the people in it now. */
export type StageMediaRoom = StageRoomHandle & {
  readonly participants: () => readonly StageParticipant[];
};

/** What a media room reports, by the stage's own names. */
export type StageMediaEvents<T> = {
  readonly subscribed: (identity: string, track: T, video: boolean) => void;
  readonly unsubscribed: (identity: string, track: T, video: boolean) => void;
  readonly resuming: () => void;
  readonly resumed: () => void;
  readonly disconnected: () => void;
};

/** What the stage draws. */
export type StageRoomSnapshot<T> = {
  readonly stage: StageAnswer | null;
  readonly link: StageLink;
  /** Each debater's camera, by identity. */
  readonly cameras: ReadonlyMap<string, T>;
  readonly participants: readonly StageParticipant[];
};

/** Before the first read: nothing drawn, no room joined. */
export const stageRoomStart = <T>(): StageRoomSnapshot<T> => ({
  stage: null,
  link: 'reconnecting',
  cameras: new Map(),
  participants: [],
});

/** The lines Egress waits for on the console. */
export type EgressSignal = 'START_RECORDING' | 'END_RECORDING';

/**
 * The broadcast stage of one capture. It reads the stage every second under
 * the observer credential, joins the Round's media room when a read offers
 * one and rejoins when it rotates or cannot be reached (the link shows
 * reconnecting until a room is joined), subscribes only to the debaters a
 * phase shows, and tells Egress when to start (once the stage is drawn and
 * its faces have settled) and when to end (the control plane said so, or
 * the web tier has been gone too long for anyone to say).
 */
export function createStageRoomDriver<T>(ports: {
  readonly read: () => Promise<StageRead>;
  readonly every: (tick: () => void, ms: number) => () => void;
  /** A monotonic clock, for how long reads have failed. */
  readonly now: () => number;
  /** A fresh media room, under the observer token, that reports to `events`. */
  readonly createRoom: (events: StageMediaEvents<T>) => StageMediaRoom;
  /** Plays a debater's voice; `release` stops any voice track. */
  readonly play: (track: T) => void;
  readonly release: (track: T) => void;
  /** Settles once the frame's faces have loaded or their wait is over. */
  readonly fontsSettled: () => Promise<void>;
  readonly signal: (line: EgressSignal) => void;
}) {
  const listeners = new Set<() => void>();
  let snapshot = stageRoomStart<T>();
  let watch = stageWatchStart;
  let identities: readonly string[] = [];
  let starting = false;
  let disposed = false;
  const publish = (next: Partial<StageRoomSnapshot<T>>) => {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener();
  };
  const cameras = (change: (all: Map<string, T>) => void) => {
    const next = new Map(snapshot.cameras);
    change(next);
    publish({ cameras: next });
  };

  const connection = createStageConnection<StageMediaRoom>({
    createRoom: () => {
      const media: StageMediaRoom = ports.createRoom({
        subscribed: (identity, track, video) => {
          if (!subscribesTo(identities, identity)) return;
          if (video) cameras((all) => all.set(identity, track));
          else ports.play(track);
        },
        unsubscribed: (identity, track, video) => {
          // A room the stage let go may still unsubscribe; the tiles belong to the held one.
          if (!video) ports.release(track);
          else if (connection.joinedRoom() === media)
            cameras((all) => all.delete(identity));
        },
        resuming: () => connection.on({ type: 'resuming', room: media }),
        resumed: () => connection.on({ type: 'resumed', room: media }),
        disconnected: () => {
          if (connection.dropped(media)) publish({ cameras: new Map() });
        },
      });
      return media;
    },
    onLink: (link) => publish({ link }),
  });

  const startRecording = () => {
    if (starting) return;
    starting = true;
    void ports.fontsSettled().then(() => {
      if (mayStartRecording({ mounted: !disposed, ended: watch.ended }))
        ports.signal('START_RECORDING');
    });
  };
  const show = (next: StageAnswer) => {
    identities = next.debaterIdentities;
    const present = connection.joinedRoom();
    const participants = present?.participants() ?? [];
    publish({ stage: next, participants });
    startRecording();
    if (present)
      applyStageSubscriptions(participants, next.debaterIdentities, next.phase);
    // Not awaited: a connect may take seconds, and the watch must keep reading.
    if (next.room) void connection.offer(next.room);
  };
  const apply = ({ status, next }: StageRead) => {
    watch = watchedStage(watch, status, ports.now());
    if (watch.ended) {
      // Egress stops on exactly this line. Nothing else can stop it with the web gone.
      ports.signal('END_RECORDING');
      stopPoll();
      connection.close();
      return;
    }
    if (next) show(next);
  };
  // apply() runs only after a read settles, so the poll has returned by then.
  const stopPoll = startStagePoll({
    read: ports.read,
    apply,
    every: ports.every,
  });

  return {
    readSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
      stopPoll();
      connection.close();
      listeners.clear();
    },
  };
}

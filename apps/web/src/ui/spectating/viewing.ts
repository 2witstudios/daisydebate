import type { BroadcastStream } from '@daisy/protocol';

/** One mounted player: a stream on one attempt. A report from any other is stale. */
type ViewingPlayer = {
  readonly manifestUrl: string;
  readonly attempt: number;
};

/**
 * One tab's viewing of a Broadcast. The stream is kept once the screen showed
 * it, so a normal end can let its final seconds play out; how its player
 * fared is said of that stream and attempt alone.
 */
export type Viewing =
  | { readonly kind: 'unseen' }
  | {
      /** `finished`: the video reached the stream's end. `unplayable`: the engine gave up, or this browser has none. */
      readonly kind: 'playing' | 'finished' | 'unplayable';
      readonly stream: BroadcastStream;
      /** Counts Try again, so each one mounts a new player. */
      readonly attempt: number;
    };

export type ViewingEvent =
  /** The screen shows a player on this stream. */
  | { readonly kind: 'shown'; readonly stream: BroadcastStream }
  | { readonly kind: 'finished'; readonly player: ViewingPlayer }
  | { readonly kind: 'failed'; readonly player: ViewingPlayer }
  /** The viewer asked for the stream that could not be played again. */
  | { readonly kind: 'retried' };

export const firstViewing: Viewing = { kind: 'unseen' };

export const attemptOf = (viewing: Viewing): number =>
  viewing.kind === 'unseen' ? 0 : viewing.attempt;

type Seen = Exclude<Viewing, { kind: 'unseen' }>;

const shown = (viewing: Viewing, stream: BroadcastStream): Viewing =>
  viewing.kind !== 'unseen' && viewing.stream.manifestUrl === stream.manifestUrl
    ? viewing
    : { kind: 'playing', stream, attempt: attemptOf(viewing) };

/** The outcome a mounted player may report from each kind of viewing. */
const reported = (
  viewing: Viewing,
  player: ViewingPlayer,
  from: readonly Seen['kind'][],
  outcome: 'finished' | 'unplayable',
): Viewing =>
  viewing.kind !== 'unseen' &&
  from.includes(viewing.kind) &&
  viewing.stream.manifestUrl === player.manifestUrl &&
  viewing.attempt === player.attempt
    ? { ...viewing, kind: outcome }
    : viewing;

/**
 * Moves the viewing. A rejected event returns the viewing it was given. A
 * different stream starts over as playing, since how one stream's player
 * fared says nothing of the next; the attempt carries over, so showing a
 * stream never changes which player is mounted for it. A player that finished
 * can still give up while the Broadcast is on air and it stays mounted; one
 * that gave up is gone, so it reports nothing more.
 */
export const reduceViewing = (
  viewing: Viewing,
  event: ViewingEvent,
): Viewing => {
  switch (event.kind) {
    case 'shown':
      return shown(viewing, event.stream);
    case 'finished':
      return reported(viewing, event.player, ['playing'], 'finished');
    case 'failed':
      return reported(
        viewing,
        event.player,
        ['playing', 'finished'],
        'unplayable',
      );
    case 'retried':
      return viewing.kind === 'unplayable'
        ? { ...viewing, kind: 'playing', attempt: viewing.attempt + 1 }
        : viewing;
  }
};

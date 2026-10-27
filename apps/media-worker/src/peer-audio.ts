/** One seat's live 10 ms audio frame as the media session delivers it. */
export type PeerAudioFrame = {
  readonly identity: string;
  readonly trackId: string;
  readonly sequence: number;
  readonly pcm: Int16Array;
  readonly beforeMs: number;
  readonly afterMs: number;
};
type Reader = {
  readonly frame: (frame: PeerAudioFrame) => void;
  /** The track ended; a reader drops whatever it kept for it. */
  readonly closed: (trackId: string) => void;
};

/**
 * The session's subscribed audio as a named, read-only input (ISSUE-764).
 * The process's one LiveKit subscription publishes into it; capture and the
 * bot listener each read it without seeing the other's types or state. A
 * reader's failure never reaches the publisher or another reader.
 */
export function createPeerAudioTap() {
  const readers = new Set<Reader>();
  const each = (deliver: (reader: Reader) => void) => {
    for (const reader of readers)
      try {
        deliver(reader);
      } catch {
        // A heuristic reader's fault is its own.
      }
  };
  return {
    publish: (frame: PeerAudioFrame) => each((reader) => reader.frame(frame)),
    close: (trackId: string) => each((reader) => reader.closed(trackId)),
    /** Starts reading; the returned function stops. */
    read(reader: Reader) {
      readers.add(reader);
      return () => {
        readers.delete(reader);
      };
    },
  };
}
type PeerAudioTap = ReturnType<typeof createPeerAudioTap>;
export type PeerAudioInput = Pick<PeerAudioTap, 'read'>;

import { worthTranscribing } from '@daisy/ai-voice';

/**
 * A speech recorded in segments the transcriber can read on their own: each
 * segment is sent as it ends, side by side with the next one recording, and
 * finishing sends the open segment so no words are lost to the end of the
 * turn. Used by every debate whose speeches are transcribed live.
 */

export type Clip = {
  readonly blob: Blob;
  /** How long the microphone heard a voice while recording. */
  readonly voicedMs: number;
};

export type Recording = {
  /** Stops and resolves to the recorded clip (empty when nothing was captured). */
  stop(): Promise<Clip>;
};

export type SegmentedSpeech = {
  /** Sends the open segment and resolves once every upload is done. */
  finish(): Promise<void>;
  /** Settles when the speech is over: finished, or its signal aborted. */
  readonly done: Promise<void>;
};

export function recordInSegments({
  record,
  upload,
  segmentMs,
  wait,
  signal,
}: {
  readonly record: () => Recording;
  /** Stops a segment and sends it; its own failures are its own to report. */
  readonly upload: (recording: Recording) => Promise<void>;
  readonly segmentMs: number;
  /** Resolves after `ms`, or as soon as `signal` aborts. */
  readonly wait: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly signal: AbortSignal;
}): SegmentedSpeech {
  const uploads = new Set<Promise<void>>();
  const send = (recording: Recording) => {
    const sent = upload(recording);
    uploads.add(sent);
    void sent.finally(() => uploads.delete(sent));
  };
  let current: Recording | null = null;
  let wrapUp: () => void = () => undefined;
  const wrappingUp = new Promise<void>((resolve) => (wrapUp = resolve));
  let finishing: Promise<void> | null = null;
  const finish = () =>
    (finishing ??= (async () => {
      wrapUp();
      if (current) send(current);
      current = null;
      await Promise.all([...uploads]);
    })());
  const done = (async () => {
    while (!signal.aborted && !finishing) {
      current = record();
      await Promise.race([wait(segmentMs, signal), wrappingUp]);
      if (current) send(current);
      current = null;
    }
    await finish();
  })();
  return { finish, done };
}

/**
 * Stops a recording and hands its clip to `send` when someone was speaking
 * in it, so the transcriber is never asked to invent words from silence.
 * Answers whether it was sent.
 */
export async function sendIfVoiced(
  recording: Recording,
  send: (blob: Blob) => Promise<void>,
): Promise<boolean> {
  const clip = await recording.stop();
  if (!worthTranscribing(clip)) return false;
  await send(clip.blob);
  return true;
}

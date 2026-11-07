import { FrameProcessor, type AudioFrame } from '@livekit/rtc-node';
/** Bounded diagnostic callback observation, never source timestamps/readiness/coverage or PCM retention. */
export class NativeCallbackCount extends FrameProcessor<AudioFrame> {
  count = 0;
  private closed = false;
  private pending: {
    target: number;
    resolve: () => void;
    reject: (error: Error) => void;
  } | null = null;
  isEnabled() {
    return !this.closed;
  }
  setEnabled(enabled: boolean) {
    if (!enabled) this.close();
  }
  close() {
    this.closed = true;
    this.pending?.reject(new Error('Diagnostic stream closed'));
  }
  async next(frames: number) {
    if (
      this.closed ||
      this.pending ||
      !Number.isSafeInteger(frames) ||
      frames < 1 ||
      frames > 100
    )
      throw new Error('Invalid diagnostic wait');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        this.pending = { target: this.count + frames, resolve, reject };
        timer = setTimeout(
          () => reject(new Error('Diagnostic callback timeout')),
          5000,
        );
      });
    } finally {
      clearTimeout(timer);
      this.pending = null;
    }
  }
  process(frame: AudioFrame) {
    if (this.closed) return frame;
    if (
      frame.sampleRate !== 48000 ||
      frame.channels !== 1 ||
      frame.samplesPerChannel !== 480 ||
      this.count >= 10000
    ) {
      this.close();
      return frame;
    }
    this.count++;
    if (this.pending && this.count >= this.pending.target)
      this.pending.resolve();
    return frame;
  }
}

import { FrameProcessor, type AudioFrame } from '@livekit/rtc-node';

export type RawCaptureFrame = {
  readonly identity: string;
  readonly trackId: string;
  readonly sequence: number;
  readonly pcm: Int16Array;
  readonly beforeMs: number;
  readonly afterMs: number;
};
/** Public SDK callback before its readable queue; never a reader-drain timestamp. */
export class CaptureFrameProcessor extends FrameProcessor<AudioFrame> {
  private closed = false;
  private sequence = 0;
  constructor(
    private readonly input: {
      readonly identity: string;
      readonly trackId: string;
      readonly nowMs: () => number;
      readonly onFrame: (frame: RawCaptureFrame) => void;
      readonly onFault: () => void;
    },
  ) {
    super();
  }
  isEnabled() {
    return !this.closed;
  }
  setEnabled(enabled: boolean) {
    if (!enabled) this.close();
  }
  close() {
    this.closed = true;
  }
  process(frame: AudioFrame) {
    if (this.closed) return frame;
    try {
      const beforeMs = this.input.nowMs();
      if (
        frame.sampleRate !== 16000 ||
        frame.channels !== 1 ||
        frame.samplesPerChannel !== 160
      )
        throw new Error('Invalid native capture frame');
      const pcm = new Int16Array(frame.data),
        afterMs = this.input.nowMs();
      if (
        !Number.isFinite(beforeMs) ||
        !Number.isFinite(afterMs) ||
        afterMs < beforeMs
      )
        throw new Error('Invalid native capture clock');
      this.input.onFrame({
        identity: this.input.identity,
        trackId: this.input.trackId,
        sequence: this.sequence,
        pcm,
        beforeMs,
        afterMs,
      });
      this.sequence++;
    } catch {
      this.closed = true;
      this.input.onFault();
    }
    return frame;
  }
}

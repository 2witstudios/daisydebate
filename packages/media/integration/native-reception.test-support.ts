import { FrameProcessor, type AudioFrame } from '@livekit/rtc-node';

type Window = {
  readonly samples: number;
  readonly energy: number;
  readonly toneAmplitude: number;
};
type State =
  | { readonly kind: 'prelude'; readonly samples: number }
  | {
      readonly kind: 'window';
      readonly samples: number;
      readonly energy: number;
      readonly sine: number;
      readonly cosine: number;
    }
  | { readonly kind: 'complete' }
  | { readonly kind: 'closed' };
const target = 9600;
const bounded = async <T>(work: Promise<T>) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Native receive observation timed out')),
          5000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
/** Native subscriber PCM only. Callback order, not reader-drain time, bounds this observation; never source credit or semantic hearing. */
export class NativeReception extends FrameProcessor<AudioFrame> {
  private state: State = { kind: 'prelude', samples: 0 };
  private readonly prelude = Promise.withResolvers<void>();
  private readonly window = Promise.withResolvers<Window>();
  constructor() {
    super();
    void this.prelude.promise.catch(() => undefined);
    void this.window.promise.catch(() => undefined);
  }
  isEnabled() {
    return this.state.kind !== 'closed';
  }
  setEnabled(enabled: boolean) {
    if (!enabled) this.close();
  }
  close() {
    this.state = { kind: 'closed' };
    this.prelude.reject(new Error('Native receive stream closed'));
    this.window.reject(new Error('Native receive stream closed'));
  }
  /** Test control: positive callback count only, never a production readiness or silence assertion. */
  waitForPrelude() {
    return bounded(this.prelude.promise);
  }
  /** Idempotent: later handoffs cannot reset the window to search for an audible frame. */
  begin() {
    if (this.state.kind === 'closed')
      throw new Error('Native receive stream closed');
    if (this.state.kind === 'prelude')
      this.state = {
        kind: 'window',
        samples: 0,
        energy: 0,
        sine: 0,
        cosine: 0,
      };
  }
  read() {
    return bounded(this.window.promise);
  }
  process(frame: AudioFrame) {
    if (this.state.kind === 'closed' || this.state.kind === 'complete')
      return frame;
    if (
      frame.sampleRate !== 48000 ||
      frame.channels !== 1 ||
      frame.samplesPerChannel !== 480
    ) {
      this.close();
      return frame;
    }
    if (this.state.kind === 'prelude') {
      this.state = {
        kind: 'prelude',
        samples: Math.min(target, this.state.samples + frame.samplesPerChannel),
      };
      if (this.state.samples === target) this.prelude.resolve();
      return frame;
    }
    const samples = this.state.samples + frame.samplesPerChannel;
    const energy =
      this.state.energy +
      frame.data.reduce((sum, value) => sum + value * value, 0);
    // The fixture source is a 600Hz square wave (80 samples/period). Phase-independent
    // amplitude distinguishes that signal from codec dither on a zero source.
    let sine = this.state.sine,
      cosine = this.state.cosine;
    for (let index = 0; index < frame.data.length; index++) {
      const phase = (2 * Math.PI * (this.state.samples + index)) / 80;
      sine += frame.data[index]! * Math.sin(phase);
      cosine += frame.data[index]! * Math.cos(phase);
    }
    if (samples === target) {
      this.state = { kind: 'complete' };
      this.window.resolve({
        samples,
        energy,
        toneAmplitude: (2 * Math.hypot(sine, cosine)) / samples,
      });
    } else this.state = { kind: 'window', samples, energy, sine, cosine };
    return frame;
  }
}

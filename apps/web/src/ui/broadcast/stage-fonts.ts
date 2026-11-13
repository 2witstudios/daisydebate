/**
 * Settles once the frame's faces have loaded, or after a limit: the first recorded
 * frame should be in the brand's type, and a font that never arrives must not keep
 * a Round from being recorded. The faces start loading when the frame first lays
 * out, so the wait begins a frame after it is shown.
 */
export const whenFontsSettle = (deps: {
  readonly ready: () => Promise<unknown>;
  readonly frame: (run: () => void) => void;
  readonly wait: (ms: number) => Promise<void>;
  readonly limitMs: number;
}): Promise<void> =>
  Promise.race([
    new Promise<void>((settle) =>
      deps.frame(
        () =>
          void deps.ready().then(
            () => settle(),
            () => settle(),
          ),
      ),
    ),
    deps.wait(deps.limitMs),
  ]);

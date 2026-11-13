/**
 * Settles once the frame's faces have loaded, or after a limit: the first recorded
 * frame should be in the brand's type, and a font that never arrives or cannot be
 * asked for must not keep a Round from being recorded.
 */
export const whenFontsSettle = (deps: {
  /** Asks for the faces by name, so nothing depends on when the frame first lays out. */
  readonly load: () => Promise<unknown>;
  readonly wait: (ms: number) => Promise<void>;
  readonly limitMs: number;
}): Promise<void> =>
  Promise.race([
    Promise.resolve()
      .then(deps.load)
      .then(
        () => undefined,
        () => undefined,
      ),
    deps.wait(deps.limitMs),
  ]);

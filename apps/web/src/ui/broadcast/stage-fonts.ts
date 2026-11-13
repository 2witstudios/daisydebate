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

/**
 * Whether the start signal may still go out once the faces have settled. A stage that
 * ended, or whose page is gone, while they loaded must not ask Egress to start: the
 * end signal has already been given, and a start after it would record a dead stage.
 */
export const mayStartRecording = (stage: {
  readonly mounted: boolean;
  readonly ended: boolean;
}) => stage.mounted && !stage.ended;

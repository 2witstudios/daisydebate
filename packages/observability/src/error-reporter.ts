/** ADR0037: implementations scrub before vendor delivery; never log raw errors. */
export type ErrorReporter = {
  readonly capture: (
    error: unknown,
    context: {
      readonly requestId: string;
      readonly route: string;
      readonly userId?: string;
      readonly errorCode: string;
    },
  ) => void;
};

/** No keys or vendor adapter: inert by construction, with no network or console fallback. */
export const noopErrorReporter: ErrorReporter = Object.freeze({
  capture: () => undefined,
});

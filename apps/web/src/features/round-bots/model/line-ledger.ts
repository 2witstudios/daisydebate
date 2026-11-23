/** Authored-line facts, independent of native queues, clocks and database calls. */
type Handoff = {
  readonly sentSamples: number;
  readonly phraseSamples: number;
  readonly playsUntilMs: number;
  readonly cutAtMs: number | null;
  readonly order: number;
  readonly receipt: 'handed' | 'reported';
};
/** A line's end as the store takes it: whole, or cut to the words that played. */
export type LineEnd =
  | { readonly kind: 'whole' }
  | {
      readonly kind: 'cut';
      readonly spoken: string;
      readonly playedMs: number;
    };
type Ending =
  | { readonly status: 'open' }
  | {
      readonly status: 'ending' | 'retry' | 'closed';
      readonly end: LineEnd;
    };
type Line = {
  readonly phraseId: string;
  readonly revealed: boolean;
  readonly handoff: Handoff | null;
  readonly ending: Ending;
};
type LineLedger = { readonly lines: readonly Line[] };
export type LineEvent =
  | { readonly type: 'reveal' | 'reported'; readonly phraseId: string }
  | ({ readonly type: 'handed'; readonly phraseId: string } & Omit<
      Handoff,
      'cutAtMs' | 'order' | 'receipt'
    >)
  | { readonly type: 'clear'; readonly atMs: number }
  | { readonly type: 'end'; readonly phraseId: string; readonly end: LineEnd }
  | {
      readonly type: 'end-result';
      readonly phraseId: string;
      readonly retry: boolean;
    }
  | { readonly type: 'retry' };
export type LineEffect = {
  readonly type: 'end';
  readonly phraseId: string;
  readonly end: LineEnd;
};
export const emptyLineLedger = (): LineLedger => ({ lines: [] });
const lineAt = (state: LineLedger, phraseId: string) =>
  state.lines.find((line) => line.phraseId === phraseId);
export const lineClosed = (state: LineLedger, phraseId: string) => {
  const line = lineAt(state, phraseId);
  return line !== undefined && line.ending.status !== 'open';
};
export const lineRevealed = (state: LineLedger, phraseId: string) =>
  lineAt(state, phraseId)?.revealed ?? false;
export const lineCutAt = (state: LineLedger, phraseId: string) =>
  lineAt(state, phraseId)?.handoff?.cutAtMs ?? null;
export const lineTailCut = (state: LineLedger, phraseId: string) => {
  const handed = state.lines
    .filter((line) => line.handoff?.receipt === 'reported')
    .sort((a, b) => (a.handoff?.order ?? 0) - (b.handoff?.order ?? 0))
    .at(-1);
  return handed?.phraseId === phraseId && handed.handoff?.cutAtMs !== null;
};
export function playedFraction(input: {
  readonly sentSamples: number;
  readonly phraseSamples: number;
  readonly playsUntilMs: number;
  readonly cutAtMs: number | null;
}): number {
  const dropped =
    input.cutAtMs === null
      ? 0
      : ((input.playsUntilMs - input.cutAtMs) * 24000) / 1000;
  return Math.min(
    1,
    Math.max(0, input.sentSamples - dropped) / input.phraseSamples,
  );
}
export const lineCredit = (state: LineLedger, phraseId: string) => {
  const handoff = lineAt(state, phraseId)?.handoff;
  return handoff ? playedFraction(handoff) : 0;
};
export function nextLineLedger(
  state: LineLedger,
  event: LineEvent,
): { state: LineLedger; effects: readonly LineEffect[] } {
  if (event.type === 'clear')
    return {
      state: {
        lines: state.lines.map((line) => {
          const handoff = line.handoff;
          return handoff &&
            handoff.cutAtMs === null &&
            event.atMs < handoff.playsUntilMs
            ? { ...line, handoff: { ...handoff, cutAtMs: event.atMs } }
            : line;
        }),
      },
      effects: [],
    };
  if (event.type === 'retry') {
    const effects: LineEffect[] = state.lines
      .filter((line) => line.ending.status === 'retry')
      .map((line) => ({
        type: 'end',
        phraseId: line.phraseId,
        end:
          line.ending.status === 'open' ? { kind: 'whole' } : line.ending.end,
      }));
    return {
      state: {
        lines: state.lines.map((line) =>
          line.ending.status === 'retry'
            ? { ...line, ending: { ...line.ending, status: 'ending' } }
            : line,
        ),
      },
      effects,
    };
  }
  const line = lineAt(state, event.phraseId) ?? {
    phraseId: event.phraseId,
    revealed: false,
    handoff: null,
    ending: { status: 'open' } as const,
  };
  let next: Line = line;
  const effects: LineEffect[] = [];
  switch (event.type) {
    case 'reveal':
      next = { ...line, revealed: true };
      break;
    case 'handed':
      next = {
        ...line,
        handoff: {
          sentSamples: event.sentSamples,
          phraseSamples: event.phraseSamples,
          playsUntilMs: event.playsUntilMs,
          cutAtMs: null,
          receipt: 'handed',
          order:
            Math.max(
              0,
              ...state.lines.map((entry) => entry.handoff?.order ?? 0),
            ) + 1,
        },
      };
      break;
    case 'reported':
      next = line.handoff
        ? { ...line, handoff: { ...line.handoff, receipt: 'reported' } }
        : line;
      break;
    case 'end':
      if (line.ending.status !== 'open') break;
      next = { ...line, ending: { status: 'ending', end: event.end } };
      effects.push({ type: 'end', phraseId: event.phraseId, end: event.end });
      break;
    case 'end-result':
      if (line.ending.status === 'ending')
        next = {
          ...line,
          ending: { ...line.ending, status: event.retry ? 'retry' : 'closed' },
        };
      break;
  }
  return {
    state: {
      lines: [
        ...state.lines.filter((entry) => entry.phraseId !== next.phraseId),
        next,
      ],
    },
    effects,
  };
}

import type { RoomView } from '@daisy/protocol';

type Yielding = NonNullable<RoomView['config']['yielding']>;
type YieldCapability = NonNullable<
  RoomView['definition']['configurable']['interaction']['yield']
>;
/** Ending a speech early as one choice: off, or on with unused time dropped or returned to prep. */
type YieldChoice = 'off' | 'drop' | 'return';

/** The choices the format permits, each with the config it saves. */
export function yieldChoices(
  capability: YieldCapability,
  saved: Yielding | null,
): readonly (readonly [YieldChoice, Yielding])[] {
  const returns = capability.returnsTimeChoices;
  const offReturns =
    saved && returns.includes(saved.returnsTime)
      ? saved.returnsTime
      : returns[0]!;
  return [
    ...(capability.enabledChoices.includes(false)
      ? [['off', { allowed: false, returnsTime: offReturns }] as const]
      : []),
    ...(capability.enabledChoices.includes(true)
      ? returns.map((returnsTime) =>
          returnsTime
            ? (['return', { allowed: true, returnsTime }] as const)
            : (['drop', { allowed: true, returnsTime }] as const),
        )
      : []),
  ];
}

/** The saved yielding config as its one choice. */
export function yieldChoiceOf(saved: Yielding): YieldChoice {
  if (!saved.allowed) return 'off';
  return saved.returnsTime ? 'return' : 'drop';
}

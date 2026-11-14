const radioClass = 'size-5 shrink-0 accent-accent';

/**
 * Where a ballot definition allows more than a win: whether the round was
 * won, tied, or lost by both. Native radios the browser owns, so a refusal
 * restores the posted choice; a winner is named only for a win.
 */
export function DecisionChoice({
  tie,
  doubleLoss,
  initial,
}: {
  readonly tie: boolean;
  readonly doubleLoss: boolean;
  readonly initial: string;
}) {
  const options = [
    ['win', 'A win'],
    ...(tie ? [['tie', 'A tie']] : []),
    ...(doubleLoss ? [['double_loss', 'A loss for both']] : []),
  ] as const;
  return (
    <fieldset className="flex flex-wrap gap-x-6 gap-y-2">
      <legend className="sr-only">The decision</legend>
      {options.map(([value, label]) => (
        <label
          key={value}
          className="flex min-h-10 items-center gap-3 font-strong text-ink"
        >
          <input
            type="radio"
            name="decision"
            value={value}
            defaultChecked={initial === value}
            className={radioClass}
          />
          {label}
        </label>
      ))}
    </fieldset>
  );
}

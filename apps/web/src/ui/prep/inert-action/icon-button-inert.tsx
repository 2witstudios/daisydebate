import { PrepIcon, type PrepIconName } from '../prep-icon/prep-icon';

/** An icon-only control the backend will bring to life: disabled, named. */
export function IconButtonInert(props: {
  readonly label: string;
  readonly symbol: PrepIconName;
}) {
  return (
    <button
      type="button"
      disabled
      aria-label={props.label}
      className="inline-flex size-12 shrink-0 items-center justify-center rounded-sm text-ink-muted disabled:cursor-not-allowed disabled:opacity-60"
    >
      <PrepIcon name={props.symbol} size={18} />
    </button>
  );
}

import { SampleAction } from '../../components/sample-action/sample-action';
import { PrepIcon, type PrepIconName } from '../prep-icon/prep-icon';

/** An icon-only control with no backend: it answers with the shell banner. */
export function IconButtonInert(props: {
  readonly label: string;
  readonly symbol: PrepIconName;
}) {
  return (
    <SampleAction
      label={props.label}
      ariaLabel={props.label}
      className="inline-flex size-12 shrink-0 items-center justify-center rounded-sm text-ink-muted hover:text-ink"
    >
      <PrepIcon name={props.symbol} size={18} />
    </SampleAction>
  );
}

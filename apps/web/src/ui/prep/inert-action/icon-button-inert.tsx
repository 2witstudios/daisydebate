import { SampleAction } from '../../components/sample-action/sample-action';
import { Icon, type IconName } from '../../components/icon/icon';

/** An icon-only control with no backend: it answers with the shell banner. */
export function IconButtonInert(props: {
  readonly label: string;
  readonly symbol: IconName;
}) {
  return (
    <SampleAction
      label={props.label}
      ariaLabel={props.label}
      className="inline-flex size-12 shrink-0 items-center justify-center rounded-sm text-ink-muted hover:text-ink"
    >
      <Icon name={props.symbol} size={18} />
    </SampleAction>
  );
}

import { Icon } from '../components/icon/icon';
import { cn } from '../cn';

const layouts = {
  // A card's column of inclusions.
  column: 'flex flex-col gap-2',
  // The Free, always band: two columns that fold to one on a phone.
  band: 'grid flex-2 basis-pricing-free-list grid-cols-2 gap-x-6 gap-y-2 max-narrow:grid-cols-1',
} as const;

/** A plan's inclusions, each behind a check mark. */
export function FeatureList({
  items,
  layout = 'column',
  checkClassName = 'text-online',
}: {
  readonly items: readonly string[];
  readonly layout?: keyof typeof layouts;
  readonly checkClassName?: string;
}) {
  return (
    <ul className={cn('list-none', layouts[layout])}>
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2">
          <Icon
            name="check"
            size={18}
            strokeWidth={2.2}
            className={checkClassName}
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

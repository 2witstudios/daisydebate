import { Icon } from '../../components/icon/icon';

/** A short list of things that hold, each with a check mark. */
export function CheckList({ items }: { readonly items: readonly string[] }) {
  return (
    <ul className="flex flex-col gap-2 text-base text-ink-muted">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2">
          <span className="mt-1 text-accent">
            <Icon name="check" size={16} />
          </span>
          {item}
        </li>
      ))}
    </ul>
  );
}

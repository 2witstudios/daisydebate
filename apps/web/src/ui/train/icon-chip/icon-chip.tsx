import { Icon, type IconName } from '../../components/icon/icon';

/** The soft square that carries a plan or mode icon. */
export function IconChip({ name }: { readonly name: IconName }) {
  return (
    <span
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent"
      aria-hidden="true"
    >
      <Icon name={name} size={20} />
    </span>
  );
}

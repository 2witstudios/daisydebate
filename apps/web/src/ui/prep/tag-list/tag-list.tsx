/** A quiet chip row of the owner's own tags. */
export function TagList({ tags }: { readonly tags: readonly string[] }) {
  if (tags.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Tags">
      {tags.map((tag) => (
        <li
          key={tag}
          className="rounded-sm bg-surface-overlay px-2 py-1 text-xs font-semibold text-ink-muted"
        >
          {tag}
        </li>
      ))}
    </ul>
  );
}

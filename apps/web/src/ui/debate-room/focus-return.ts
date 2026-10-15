/** The DOM a focus return reads: containment and whether a box is drawn. */
type Region = {
  readonly contains: (node: Node | null) => boolean;
  readonly getClientRects: () => { readonly length: number };
};

const shown = (node: Region) => node.getClientRects().length > 0;

/** The first target still drawn; null when none is. */
export function firstShown<T extends Region>(
  targets: readonly (T | null)[],
): T | null {
  return (
    targets.find((target): target is T => !!target && shown(target)) ?? null
  );
}

/**
 * Where focus goes when a region holding it stops being drawn (the drawer
 * closes, a phone tab hides the document): the first target still drawn.
 * Null while the focus is elsewhere or its region is still shown. Read the
 * active element before any layout read, which can blur a hidden node.
 */
export function focusReturnTarget<T extends Region>(
  active: Node | null,
  regions: readonly (Region | null)[],
  targets: readonly (T | null)[],
): T | null {
  const holder = regions.find((region) => region?.contains(active));
  if (!holder || shown(holder)) return null;
  return firstShown(targets);
}

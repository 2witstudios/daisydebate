// Repository gate for token-locked Tailwind (ADR 0028): styling lives in
// utilities in the markup and in CSS-only theme config, so a CSS Module or a
// JS Tailwind config file must never reappear. Popovers go through the
// primitive, which owns their display (ADR 0153).

import { ownedUtilitiesIn } from '../apps/web/src/ui/components/popover/popover-classes';

const forbidden: readonly (readonly [RegExp, string])[] = [
  [/\.module\.css$/, 'CSS Modules were replaced by Tailwind utilities'],
  [
    /(^|\/)tailwind\.config\.[cm]?[jt]s$/,
    'Tailwind v4 is configured in CSS (globals.css), not in a config file',
  ],
];

export const stylingIssues = (paths: readonly string[]): readonly string[] =>
  paths.flatMap((path) =>
    forbidden
      .filter(([pattern]) => pattern.test(path))
      .map(([, reason]) => `${path}: ${reason}`),
  );

const primitiveDirectory = 'apps/web/src/ui/components/popover/';
const scannedMarkup = /\.[jt]sx$/;

/** A raw popover attribute in markup, not `popoverTarget` and friends. */
const rawPopover = /\bpopover\s*=/g;

/**
 * A primitive's opening tag up to its literal className. `[^<>]` keeps the
 * match inside one opening tag; a `>` inside an arrow prop ends it early,
 * which only shortens what is checked.
 */
const primitiveClassName =
  /<Popover(?:Dialog|Menu)\b[^<>]*?\bclassName=\{?\s*(["'`])([^"'`]*)\1/g;

const lineOf = (source: string, index: number): number =>
  source.slice(0, index).split('\n').length;

/**
 * A popover outside the primitives, or a display or direction class passed
 * to one, would let a closed popover lay itself out (SEAT-14a).
 */
export const popoverIssues = (
  path: string,
  source: string,
): readonly string[] => {
  if (!scannedMarkup.test(path) || path.startsWith(primitiveDirectory))
    return [];
  const raw = [...source.matchAll(rawPopover)].map(
    (match) =>
      `${path}:${lineOf(source, match.index)}: a raw popover attribute; use PopoverDialog or PopoverMenu, which own its display (ADR 0153)`,
  );
  const owned = [...source.matchAll(primitiveClassName)].flatMap((match) => {
    const words = ownedUtilitiesIn(match[2] ?? '');
    return words.length === 0
      ? []
      : [
          `${path}:${lineOf(source, match.index)}: ${words.join(' ')} on a popover primitive; it owns display and direction, pass layout (ADR 0153)`,
        ];
  });
  return [...raw, ...owned];
};

const trackedAndNew = async (): Promise<readonly string[]> => {
  const listing = Bun.spawnSync([
    'git',
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
  ]);
  return listing.stdout
    .toString()
    .split('\n')
    .filter((path) => path !== '');
};

if (import.meta.main) {
  const paths = await trackedAndNew();
  const markup = paths.filter((path) => scannedMarkup.test(path));
  const sources = await Promise.all(
    markup.map(async (path) => {
      const file = Bun.file(path);
      return (await file.exists())
        ? popoverIssues(path, await file.text())
        : [];
    }),
  );
  const issues = [...stylingIssues(paths), ...sources.flat()];
  for (const issue of issues) console.error(issue);
  process.exitCode = issues.length === 0 ? 0 : 1;
}

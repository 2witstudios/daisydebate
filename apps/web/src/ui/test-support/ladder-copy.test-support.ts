/**
 * Owner copy rule: outside the lobby switch, no view
 * names a ladder, a style or a division, so copy never changes as styles are
 * added. A format name stays only where it is a Room's own format (a lobby
 * row, the create form's format choice, a style filter's options).
 */
const divisionWords =
  /Open – |Youth – | ladders\.|Freestyle ladder|Open and Youth|Youth and Open|under 18|18 and over|Open lobby|Youth lobby/;
const styleWords =
  />Freestyle<|Freestyle ·|· Freestyle|Freestyle \+|Freestyle −/;

/** Markup without the controls that may list the lobbies or a format. */
const withoutControls = (html: string) =>
  html
    .replaceAll('&#x27;', "'")
    .replace(/<select[\s\S]*?<\/select>/g, '')
    .replace(/<nav aria-label="Lobby"[\s\S]*?<\/nav>/g, '');

/**
 * The ladder words a rendered view carries outside its lobby switch and
 * selects, or null when it names none. `format: true` lets a Room's own format
 * name stand.
 */
export const ladderCopyIn = (
  html: string,
  { format = false }: { readonly format?: boolean } = {},
): string | null => {
  const text = withoutControls(html);
  return (
    divisionWords.exec(text)?.[0] ??
    (format ? null : (styleWords.exec(text)?.[0] ?? null))
  );
};

/** Text helpers shared by the deploy config verifiers. */

export const uncommented = (text: string) =>
  text
    .split('\n')
    .filter((line) => !/^\s*(#|\/\/)/.test(line))
    .join('\n');

/** Seconds Fly must wait past the drain deadline before it SIGKILLs. */
/** The body of `[table]`, up to the next table header. */
export const tableBody = (toml: string, table: string): string[] | null => {
  const lines = toml.split('\n');
  const start = lines.findIndex((line) => line.trim() === table);
  if (start === -1) return null;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\[/.test(line.trim())) break;
    body.push(line);
  }
  return body;
};

export const KILL_TIMEOUT_MARGIN_S = 10;

/** A top-level kill_timeout in seconds, or Fly's 5 s default. */
export const killTimeoutSeconds = (toml: string) => {
  const topLevel = uncommented(toml).split(/^\s*\[/m)[0] ?? '';
  const setting = topLevel.match(
    /^\s*kill_timeout\s*=\s*(?:(\d+)|"(\d+)s")\s*$/m,
  );
  return Number(setting?.[1] ?? setting?.[2] ?? 5);
};

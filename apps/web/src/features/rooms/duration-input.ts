/** UI units only: the portable Room contract remains integer milliseconds. */
function durationParts(ms: number) {
  const remainder = ms % 60000;
  const fraction = remainder % 1000;
  return {
    minutes: String(Math.floor(ms / 60000)),
    seconds: String(Math.floor(remainder / 1000)).padStart(2, '0'),
    fraction: fraction
      ? String(fraction).padStart(3, '0').replace(/0+$/, '')
      : '',
  };
}

const clockText = /^(\d{1,6}):([0-5]\d)(?:\.(\d{1,3}))?$/;

/** Reads one `m:ss` field (an exact `.mmm` remainder is kept); NaN when malformed. */
export function readDuration(form: FormData, name: string): number {
  const text = form.get(`duration.${name}`);
  if (typeof text !== 'string') return NaN;
  const match = clockText.exec(text.trim());
  if (!match) return NaN;
  const [, minutes = '', seconds = '', fraction = ''] = match;
  return (
    Number(minutes) * 60000 +
    Number(seconds) * 1000 +
    Number(fraction.padEnd(3, '0'))
  );
}

/** "5:00": the round clock's own reading, keeping any exact remainder. */
export function clockDuration(ms: number): string {
  const { minutes, seconds, fraction } = durationParts(ms);
  return `${minutes}:${seconds}${fraction ? `.${fraction}` : ''}`;
}

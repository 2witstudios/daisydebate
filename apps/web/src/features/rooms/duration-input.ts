/** UI units only: the portable Room contract remains integer milliseconds. */
export function durationParts(ms: number | null) {
  if (ms === null) return { minutes: '', seconds: '' };
  const remainder = ms % 60000;
  return {
    minutes: String(Math.floor(ms / 60000)),
    seconds: `${Math.floor(remainder / 1000)}${
      remainder % 1000
        ? `.${String(remainder % 1000)
            .padStart(3, '0')
            .replace(/0+$/, '')}`
        : ''
    }`,
  };
}

export function readDuration(form: FormData, name: string): number {
  const minutes = form.get(`duration.${name}.minutes`);
  const seconds = form.get(`duration.${name}.seconds`);
  if (
    typeof minutes !== 'string' ||
    !/^\d+$/.test(minutes) ||
    typeof seconds !== 'string' ||
    !/^\d+(?:\.\d{1,3})?$/.test(seconds)
  )
    return NaN;
  const [whole = '', fraction = ''] = seconds.split('.');
  if (Number(whole) >= 60) return NaN;
  const ms =
    Number(minutes) * 60000 +
    Number(whole) * 1000 +
    Number(fraction.padEnd(3, '0'));
  return Number.isSafeInteger(ms) ? ms : NaN;
}

export function formatDuration(ms: number): string {
  const parts = durationParts(ms);
  return [
    Number(parts.minutes) ? `${parts.minutes} min` : '',
    Number(parts.seconds) || !Number(parts.minutes)
      ? `${parts.seconds} sec`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** "5:00": the round clock's own reading, keeping any exact remainder. */
export function clockDuration(ms: number): string {
  const parts = durationParts(ms);
  const [whole = '0', fraction] = parts.seconds.split('.');
  return `${parts.minutes}:${whole.padStart(2, '0')}${fraction ? `.${fraction}` : ''}`;
}

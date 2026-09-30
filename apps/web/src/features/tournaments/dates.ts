const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const pad = (value: number): string => String(value).padStart(2, '0');

/** "1 Oct": a date without weekday, in UTC. */
export const formatDate = (iso: string): string => {
  const at = new Date(iso);
  return `${at.getUTCDate()} ${months[at.getUTCMonth()]}`;
};

/** "Sat 10 Oct", in UTC. */
export const formatDay = (iso: string): string =>
  `${days[new Date(iso).getUTCDay()]} ${formatDate(iso)}`;

/** "14:00", in UTC. */
export const formatTime = (iso: string): string => {
  const at = new Date(iso);
  return `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`;
};

/** "Sat 10 Oct, 14:00 UTC". Every time on the screens is UTC. */
export const formatWhen = (iso: string): string =>
  `${formatDay(iso)}, ${formatTime(iso)} UTC`;

/** The instant `minutes` before or after an ISO timestamp. */
export const shiftMinutes = (iso: string, minutes: number): string =>
  new Date(Date.parse(iso) + minutes * 60_000).toISOString();

const longDays = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
const longMonths = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** "Saturday 29 August 2026", in UTC. */
export const formatLongDate = (iso: string): string => {
  const at = new Date(iso);
  return `${longDays[at.getUTCDay()]} ${at.getUTCDate()} ${longMonths[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
};

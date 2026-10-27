/** "2 min" for a whole number of minutes, otherwise "90 s". */
export const windowLabel = (seconds: number): string =>
  seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} s`;

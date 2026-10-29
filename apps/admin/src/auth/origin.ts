/** Exact configured origin: request headers never choose the relying party. */
export function readAdminOrigin(
  value: string | undefined,
  mode: string,
): string {
  const origin =
    value ?? (mode === 'production' ? '' : 'http://localhost:4800');
  try {
    const url = new URL(origin);
    const local = origin === 'http://localhost:4800' && mode !== 'production';
    const https =
      url.protocol === 'https:' &&
      /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(url.hostname) &&
      !/^[0-9.]+$/.test(url.hostname);
    if (
      url.origin !== origin ||
      url.username ||
      url.password ||
      !(local || https)
    )
      throw new Error('Invalid origin');
    return origin;
  } catch {
    throw new Error('Invalid admin configuration: ADMIN_ORIGIN');
  }
}

export const MISDIRECTED_STATUS = 421;
export const hostAllowed = (
  host: string | null | undefined,
  origin: string,
): boolean => host === new URL(origin).host;
export const sameOrigin = (
  candidate: string | null | undefined,
  origin: string,
): boolean => candidate === origin;

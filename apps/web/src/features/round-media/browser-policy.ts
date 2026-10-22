/** Feature pages only: API, documents and spectator routes receive no capture exception. */
export const roundMediaPages = [
  '/rooms/:id',
  '/rounds/:id',
  '/rounds/:id/room',
] as const;
const isRoundMediaPage = (path: string) =>
  /^\/(rooms\/[^/]+|rounds\/[^/]+(?:\/room)?)$/.test(path);

export function roundMediaOrigins(
  path: string,
  endpoint: string | null | undefined,
  development: boolean,
): readonly string[] {
  if (!isRoundMediaPage(path) || !endpoint) return [];
  try {
    const url = new URL(endpoint);
    if (
      url.username ||
      url.password ||
      !['wss:', ...(development ? ['ws:'] : [])].includes(url.protocol)
    )
      return [];
    const websocket = url.origin;
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    return [websocket, url.origin];
  } catch {
    return [];
  }
}

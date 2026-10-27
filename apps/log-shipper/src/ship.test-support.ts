/** Shared fixtures for the shipper's unit tests: one app, one subject, one logger line. */
export const app = 'daisy-debate-staging';
export const apps = new Set([app]);
export const receivedAt = '2026-10-27T13:01:53.439Z';
export const subject = `logs.${app}.ord.811006b93572d8`;
export const line = {
  level: 40,
  time: Date.parse(receivedAt),
  service: 'web',
  appVersion: '7d94b6b',
  gitCommit: '7d94b6b153b556dabe0346bc2b727f989905e436',
  event: 'auth.rate_limit.denied',
  status: 429,
  msg: 'Rate limit denied',
};
export const encode = (text: string) => new TextEncoder().encode(text);
export const record = (
  message: string,
  placement: { name?: string; region?: string; instance?: string } = {},
) =>
  encode(
    JSON.stringify({
      fly: {
        app: {
          instance: placement.instance ?? '811006b93572d8',
          name: placement.name ?? app,
        },
        region: placement.region ?? 'ord',
      },
      message,
    }),
  );
export const valid = record(JSON.stringify(line));

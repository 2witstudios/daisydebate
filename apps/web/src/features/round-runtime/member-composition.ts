import type { App } from '../../server/app';
import { identify } from '../../lib/identity';
/** One session/origin/actor/rate policy composition for both shared competitive write contracts. */
export const composeRoundMemberDependencies = (app: App) => ({
  logger: app.logger,
  identify: (request: Request) => identify(app.auth(), request.headers),
  origin: () => app.auth().config.PUBLIC_APP_URL,
  getActorByUserId: (id: string) => app.database.getActorByUserId(id),
  limiter: () => app.auth().limiter,
  limits: app.roomPolicy?.limits ?? {
    read: { max: 1, windowSeconds: 1 },
    command: { max: 1, windowSeconds: 1 },
  },
  maxBodyBytes: app.roomPolicy?.maxBodyBytes ?? 0,
  active: () => Boolean(app.roomPolicy),
});

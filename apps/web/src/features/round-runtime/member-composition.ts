import type { App } from '../../server/app';
import { memberHttpBoundary } from '../../server/member-boundary';
import { ROUND_POLICY } from './round-policy';

/** One session, origin and budget composition for every Round route. */
export const composeRoundMemberDependencies = (app: App) => ({
  ...memberHttpBoundary(app),
  ...ROUND_POLICY,
});

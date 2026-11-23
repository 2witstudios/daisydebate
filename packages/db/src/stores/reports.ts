import type { DecisionReleasePolicy } from '@daisy/protocol/round-decision-release';
import type { ContactAuthorizationFence } from '../contacts/fence';
import { moderationReactions } from '../moderation/store';
import { createReportStore, reportOperations } from '../reports/store';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../instrumented';

/**
 * What each capability does when a member is restricted (ADR 0103); the
 * process passes it to the reports store, which runs it in the restriction's
 * transaction.
 */
export { moderationReactions };

/** Reports: the operator's queue on the control lane, a member's own reports on the social lane. */
export const createReportsStore = (
  resources: DatabaseResources,
  {
    reactions,
    decisionRelease,
  }: {
    readonly reactions: typeof moderationReactions;
    readonly decisionRelease?: DecisionReleasePolicy | undefined;
  },
) => {
  const { lane, eventSink } = resourcesOf(resources);
  return namedLaneOperations({
    ...reportOperations({
      database: lane('control').database,
      eventSink,
      moderationReactions: (rules) => reactions(rules, decisionRelease),
    }),
    reportStore: (authorize: ContactAuthorizationFence) =>
      createReportStore({ database: lane('social').database, authorize }),
  });
};
export type ReportsStore = ReturnType<typeof createReportsStore>;
export type { RestrictionRules } from '../moderation/store';

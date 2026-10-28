import { activeRoomMembers, closeRoom, eraseSeats } from '@daisy/debate-engine';
import {
  subjectRightsVerificationBindings,
  type PrivacyExport,
  type PrivacySubject,
} from '@daisy/db/privacy';
import type { App } from '../../../server/app';
import { identify } from '../../../lib/identity';
import { privacyJobVendors } from '../../../server/privacy-jobs';
import { createEraseAccountHandler } from './erase-account';
import { createExportDataHandler } from './export-data';

/**
 * The engine's pure Room closures: what closing an account does to its open
 * hosted Rooms and unbegun seats, inside the erasure transaction.
 */
const roomTransitions = { closeRoom, eraseSeats, activeRoomMembers };

/**
 * One account's whole export (ISSUE-833, ADR 0087): the PostgreSQL
 * composition runs under one lock, then the validated typing port reads the
 * account's own Redis leases — a snapshot outside every database
 * transaction, under the account's own key only. The leases join under
 * their own key; a Redis failure refuses the whole export rather than
 * answering a seemingly complete partial one.
 */
export const exportSubjectData =
  (app: App) =>
  async (subject: PrivacySubject): Promise<PrivacyExport> => {
    const exported = await app.database.exportPrivacySubject(
      subject,
      roomTransitions,
    );
    const typing = await app.database
      .messagingTypingPrivacyPort({
        exportSubject: (actorId) => app.redis.exportSubjectTyping(actorId),
        eraseSubject: (actorId) => app.redis.eraseSubjectTyping(actorId),
      })
      .export(subject);
    return { ...exported, messaging_typing_leases: typing };
  };

/**
 * The account's data-rights routes (ISSUE-833): export and erasure, each a
 * native form post behind the member gates. The erasure runs the whole
 * subject-rights composition — the engine's pure Room-closure transitions,
 * the production verification bindings, and one vendor deletion job per
 * configured vendor (with a fresh id) — in the one transaction the database
 * owns (ADR 0087, DEC-261).
 */
export function composeDataRightsRoutes(app: App) {
  const origin = () => app.auth().config.PUBLIC_APP_URL;
  const identityOf = (request: Request) =>
    identify(app.auth(), request.headers);
  return {
    export: {
      POST: createExportDataHandler({
        logger: app.logger,
        origin,
        identify: identityOf,
        limiter: () => app.limiter,
        exportSubject: exportSubjectData(app),
      }),
    },
    erase: {
      POST: createEraseAccountHandler({
        logger: app.logger,
        origin,
        identify: identityOf,
        limiter: () => app.limiter,
        clock: app.clock,
        eraseSubject: (subject, now) =>
          app.database.erasePrivacySubject(
            {
              subject,
              now,
              vendors: privacyJobVendors,
              jobIds: privacyJobVendors.map(() => app.ids.next()),
            },
            roomTransitions,
            subjectRightsVerificationBindings,
          ),
      }),
    },
  };
}

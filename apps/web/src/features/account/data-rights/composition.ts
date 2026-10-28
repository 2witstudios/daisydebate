import { activeRoomMembers, closeRoom, eraseSeats } from '@daisy/debate-engine';
import { subjectRightsVerificationBindings } from '@daisy/db/privacy';
import type { App } from '../../../server/app';
import { identify } from '../../../lib/identity';
import { privacyJobVendors } from '../../../server/privacy-jobs';
import { createEraseAccountHandler } from './erase-account';
import { createExportDataHandler } from './export-data';

/**
 * The member's data-rights routes (ISSUE-833): export and erasure, each a
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
  // The engine's pure Room closures: what closing an account does to its
  // open hosted Rooms and unbegun seats, inside the erasure transaction.
  const roomTransitions = { closeRoom, eraseSeats, activeRoomMembers };
  return {
    export: {
      POST: createExportDataHandler({
        logger: app.logger,
        origin,
        identify: identityOf,
        limiter: () => app.limiter,
        exportSubject: (subject) =>
          app.database.exportPrivacySubject(subject, roomTransitions),
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

'use client';

import { useEffect, useState } from 'react';
import type { SecurityOutcome } from '../../../features/account/security-client';
import type { PasskeyEnrollment } from '../../auth/onboarding/passkey-enrollment';
import {
  openingSecurityOverview,
  reduceSecurityOverview,
  UNREACHABLE_LISTS,
  type SecurityListsAnswer,
  type SecurityOverview,
  type SecurityOverviewEffect,
  type SecurityOverviewEvent,
} from './security-overview-model';

type World = {
  readonly load: () => Promise<SecurityListsAnswer>;
  readonly revokeOthers: () => Promise<SecurityOutcome>;
  readonly enrol: () => Promise<PasskeyEnrollment>;
};

/**
 * Holds the value events are decided against, so an event sent before React
 * renders the one before it is still decided after it, and does what each
 * decision asks of the world.
 */
function driveSecurityOverview(
  opening: SecurityOverview,
  show: (overview: SecurityOverview) => void,
) {
  let held = opening;
  let world: World | null = null;
  const send = (event: SecurityOverviewEvent) => {
    if (world === null) return;
    const step = reduceSecurityOverview(held, event);
    held = step.state;
    show(held);
    step.effects.forEach(run);
  };
  const run = (effect: SecurityOverviewEffect) => {
    if (world === null) return;
    if (effect.type === 'read')
      void world
        .load()
        .catch(() => UNREACHABLE_LISTS)
        .then((answer) =>
          send({ type: 'read-answered', version: effect.version, answer }),
        );
    else if (effect.type === 'sign-out-others')
      void world
        .revokeOthers()
        .catch((): SecurityOutcome => ({ kind: 'unavailable' }))
        .then((outcome) =>
          send({ type: 'sign-out-answered', request: effect.request, outcome }),
        );
    else
      void world
        .enrol()
        .catch((): PasskeyEnrollment => ({ kind: 'failed' }))
        .then((outcome) =>
          send({
            type: 'enrolment-answered',
            request: effect.request,
            outcome,
          }),
        );
  };
  return {
    send,
    /** The screen is up, or its world changed: nothing is sent or shown before this. */
    reach: (next: World) => {
      world = next;
    },
    /** The screen is gone: answers still on their way change nothing. */
    close: () => {
      world = null;
    },
  };
}

/**
 * The account's passkeys and sessions as the security screen holds them: read
 * from the server, then changed here as each row's own action lands. A read
 * still in flight when a change lands here began before it and is stale, so the
 * change discards it and reads again; it can never put a removed row back.
 * What a read of the sessions said and what a sign-out said are two notices,
 * shown apart: a read that succeeds does not take back a sign-out that failed,
 * and a read that fails does not hide one. Saving a passkey is held here too,
 * and one that saved reads the lists again.
 *
 * Every decision is the model's; this holds its one value and runs what it asks.
 */
export function useSecurityOverview({
  load,
  revokeOthers,
  enrol,
  signOutNotice,
}: World & {
  /** A sign-out that did not happen before this screen opened. */
  readonly signOutNotice?: string | undefined;
}) {
  const [overview, show] = useState(() =>
    openingSecurityOverview(signOutNotice),
  );
  const [driver] = useState(() => driveSecurityOverview(overview, show));

  useEffect(() => {
    driver.reach({ load, revokeOthers, enrol });
  }, [driver, load, revokeOthers, enrol]);
  useEffect(() => {
    driver.send({ type: 'read-asked' });
    return driver.close;
  }, [driver, load]);

  return {
    overview,
    renamePasskey: (id: string, name: string) =>
      driver.send({ type: 'passkey-renamed', id, name }),
    removePasskey: (id: string) => driver.send({ type: 'passkey-removed', id }),
    removeSession: (id: string) => driver.send({ type: 'session-removed', id }),
    signOutOthers: () => driver.send({ type: 'sign-out-asked' }),
    addPasskey: () => driver.send({ type: 'enrolment-asked' }),
  };
}

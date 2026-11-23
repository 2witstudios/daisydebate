import { createOnboardingStore } from '../src/stores/onboarding';
import { openDatabaseResources } from '../src/resources';
import { requireTestServices } from '@daisy/config';
import { admitsOptionalAnswers } from '@daisy/auth/account-age';
import { withDatabase as onPool, type Fixture } from './constraint-helpers';
import type { OnboardingStepWrite } from '../src/onboarding-operations';
/** This file's database: the area stores it reads, over one set of resources. */
const openStores = (
  options: Parameters<typeof openDatabaseResources>[0] & {
    readonly nextActorId: () => string;
  },
) => {
  const resources = openDatabaseResources(options);
  return {
    ...createOnboardingStore(resources, { nextId: options.nextActorId }),
    close: resources.close,
  };
};

export const { databaseUrl: url } = requireTestServices(process.env);

/** This suite's database, over its own pool for each test. */
export const withDatabase = <T>(
  run: (database: ReturnType<typeof openStores>) => Promise<T>,
): Promise<T> => onPool(url, run);

export const now = '2026-10-15T12:00:00.000Z';

/**
 * A verified member with an actor and, when given, a canonical birth month;
 * `run` gets the ids, and the age source is removed afterwards so the
 * fixture's user cleanup is not restricted by it.
 */
export async function member<T>(
  fixture: Fixture,
  birthMonth: string | null,
  run: (ids: { userId: string; actorId: string }) => Promise<T>,
): Promise<T> {
  const userId = await fixture.user();
  const actorId = await fixture.actor(userId);
  await fixture.sql`update users set email_verified=true where id=${userId}`;
  if (birthMonth !== null)
    await fixture.sql`insert into account_age(user_id,birth_month,version,recorded_at)
      values(${userId},${birthMonth},1,${now})`;
  try {
    return await run({ userId, actorId });
  } finally {
    await fixture.sql`delete from account_age where user_id=${userId}`;
  }
}

export const save = (
  database: ReturnType<typeof openStores>,
  ids: { userId: string; actorId: string },
  answers: OnboardingStepWrite,
  { completes = false, at = now } = {},
) =>
  database.saveOnboardingStep({
    ...ids,
    answers,
    completes,
    now: at,
    admits: admitsOptionalAnswers,
  });

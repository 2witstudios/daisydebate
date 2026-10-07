import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { asc, eq, sql } from 'drizzle-orm';
import type {
  Club,
  Experience,
  Format,
  Length,
  Topic,
  Want,
} from '@daisy/protocol';
import {
  memberInterests,
  memberOnboarding,
  memberTopics,
} from './schema/onboarding';
import { instrumented, type DatabaseEventSink } from './instrumented';

/** One questionnaire step as stored: the step's whole answer, replaced. */
export type OnboardingStepWrite =
  | {
      readonly step: 'about';
      readonly wants: readonly Want[];
      readonly club: Club | null;
    }
  | {
      readonly step: 'experience';
      readonly experience: Experience | null;
      readonly formats: readonly Format[];
      readonly length: Length | null;
    }
  | { readonly step: 'topics'; readonly topics: readonly Topic[] };

/** A member's stored answers; `completedAt` is a UTC ISO string. */
export type OnboardingRecord = {
  readonly wants: readonly Want[];
  readonly club: Club | null;
  readonly experience: Experience | null;
  readonly formats: readonly Format[];
  readonly length: Length | null;
  readonly topics: readonly Topic[];
  readonly completedAt: string | null;
};

type OnboardingRow = typeof memberOnboarding.$inferSelect;

/** A member with no onboarding row has answered nothing. */
const noRow = {
  club: null,
  experience: null,
  formats: [],
  length: null,
  completedAt: null,
} as const;

const rowAnswers = (row: OnboardingRow) => ({
  club: row.club as Club | null,
  experience: row.experience as Experience | null,
  formats: row.formats as Format[],
  length: row.length as Length | null,
  completedAt: row.completedAt === null ? null : row.completedAt.toISOString(),
});

/** The stored rows as a record. */
const toRecord = (
  row: OnboardingRow | undefined,
  wants: readonly { readonly value: string }[],
  topics: readonly { readonly value: string }[],
): OnboardingRecord => ({
  ...(row === undefined ? noRow : rowAnswers(row)),
  wants: wants.map(({ value }) => value as Want),
  topics: topics.map(({ value }) => value as Topic),
});

const touched = {
  updatedAt: sql`now()`,
  version: sql`${memberOnboarding.version} + 1`,
};

/**
 * Onboarding answers (ONB): each step replaces its own answers in one
 * transaction, so a member never holds half of a step. The CHECKs pin every
 * value to the protocol vocabularies; the caller has already parsed them.
 */
export const onboardingOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink: DatabaseEventSink | undefined;
}) => ({
  async saveOnboardingStep(
    userId: string,
    answers: OnboardingStepWrite,
  ): Promise<void> {
    return instrumented(eventSink, 'saveOnboardingStep', () =>
      database.transaction(async (tx) => {
        const columns =
          answers.step === 'about'
            ? { club: answers.club }
            : answers.step === 'experience'
              ? {
                  experience: answers.experience,
                  formats: [...answers.formats],
                  length: answers.length,
                }
              : {};
        await tx
          .insert(memberOnboarding)
          .values({ userId, ...columns })
          .onConflictDoUpdate({
            target: memberOnboarding.userId,
            set: { ...columns, ...touched },
          });
        if (answers.step === 'about') {
          await tx
            .delete(memberInterests)
            .where(eq(memberInterests.userId, userId));
          if (answers.wants.length > 0)
            await tx
              .insert(memberInterests)
              .values(answers.wants.map((interest) => ({ userId, interest })));
        }
        if (answers.step === 'topics') {
          await tx.delete(memberTopics).where(eq(memberTopics.userId, userId));
          if (answers.topics.length > 0)
            await tx
              .insert(memberTopics)
              .values(answers.topics.map((topic) => ({ userId, topic })));
        }
      }),
    );
  },

  /** Records the first finish (Finish or Skip); a later one keeps it. */
  async completeOnboarding(userId: string, at: Date): Promise<void> {
    return instrumented(eventSink, 'completeOnboarding', async () => {
      await database
        .insert(memberOnboarding)
        .values({ userId, completedAt: at })
        .onConflictDoUpdate({
          target: memberOnboarding.userId,
          set: {
            completedAt: sql`coalesce(${memberOnboarding.completedAt}, ${at.toISOString()}::timestamptz)`,
            ...touched,
          },
        });
    });
  },

  /**
   * One read-only REPEATABLE READ snapshot: each statement under READ
   * COMMITTED sees its own snapshot, so a step saved between them could
   * pair old and new answers that never existed together.
   */
  async readOnboarding(userId: string): Promise<OnboardingRecord> {
    return instrumented(eventSink, 'readOnboarding', () =>
      database.transaction(
        async (tx) => {
          const [row] = await tx
            .select()
            .from(memberOnboarding)
            .where(eq(memberOnboarding.userId, userId))
            .limit(1);
          const wants = await tx
            .select({ value: memberInterests.interest })
            .from(memberInterests)
            .where(eq(memberInterests.userId, userId))
            .orderBy(asc(memberInterests.interest));
          const topics = await tx
            .select({ value: memberTopics.topic })
            .from(memberTopics)
            .where(eq(memberTopics.userId, userId))
            .orderBy(asc(memberTopics.topic));
          return toRecord(row, wants, topics);
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      ),
    );
  },
});

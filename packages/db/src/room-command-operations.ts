import type { RoundBotAdmission } from './round-bot-admission';
import type { CasualJudgeAdmission } from './casual-judge-admission';
import { roomAuthorizationRead } from './room-authorization-read';
import { commandRetention } from './command-retention';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { DatabaseEventSink } from './instrumented';
import { roomReadOperations } from './room-read-operations';
import { roomCreateOperations } from './room-create-operations';
import { roomWriteOperations } from './room-write-operations';
import { roomLifecycleOperations } from './room-lifecycle-operations';
import { resolutionBankOperations } from './resolution-bank-operations';
import type { roomCommandTransaction } from './room-command-transaction';
import { roomInvitationOperations } from './room-invitations/store';
/** One canonical durable Room command/projection adapter. */
export const roomCommandOperations = (input: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
  readonly botAdmission?: RoundBotAdmission | undefined;
  readonly judgeAdmission?: CasualJudgeAdmission | undefined;
  readonly commandTransaction: ReturnType<typeof roomCommandTransaction>;
}) => ({
  ...commandRetention(input),
  ...roomReadOperations(input),
  ...roomAuthorizationRead(input),
  ...roomLifecycleOperations(input),
  ...resolutionBankOperations(input),

  ...roomCreateOperations({
    transaction: input.commandTransaction,
    eventSink: input.eventSink,
    judgeAdmission: input.judgeAdmission,
  }),
  ...roomInvitationOperations({
    database: input.database,
    transaction: input.commandTransaction,
    eventSink: input.eventSink,
  }),
  ...roomWriteOperations({
    botAdmission: input.botAdmission,
    judgeAdmission: input.judgeAdmission,
    transaction: input.commandTransaction,
    eventSink: input.eventSink,
  }),
});

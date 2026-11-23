import { openWebDatabase } from '../../src/server/database';
import { hostWaits } from '@daisy/worker/host';
import { runPreapprovalCommand } from '../../src/features/operator-api/preapproval-command';
import { sha3Hex } from '@daisy/digest';
import { createId } from '@paralleldrive/cuid2';
import { preapprovalEmailSchema } from '@daisy/protocol/beta-preapproval';
import { betaAccessTarget } from './beta-access-target';
import { z } from 'zod';

const input = z
  .strictObject({ email: preapprovalEmailSchema, invite: z.boolean() })
  .parse(JSON.parse(await Bun.stdin.text()));
const database = openWebDatabase({
  waits: hostWaits,
  url: betaAccessTarget(process.env),
  nextActorId: createId,
});
try {
  const command = {
    v: 1,
    operation: 'add',
    commandId: createId(),
    adminAuditHead: 'a'.repeat(64),
    ...input,
  } as const;
  await runPreapprovalCommand(database, {
    command,
    serviceId: 'daisy-admin',
    operatorRef: 'o'.repeat(24),
    requestDigest: sha3Hex(JSON.stringify(command)),
    nextId: createId,
    live: () => true,
  });
  process.stdout.write(JSON.stringify({ saved: true }));
} finally {
  await database.close();
}

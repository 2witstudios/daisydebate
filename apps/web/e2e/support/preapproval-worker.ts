import { createHash } from 'node:crypto';
import { createId } from '@paralleldrive/cuid2';
import { createDatabase } from '@daisy/db';
import { preapprovalEmailSchema } from '@daisy/protocol/beta-preapproval';
import { betaAccessTarget } from './beta-access-target';
import { z } from 'zod';

const input = z
  .strictObject({ email: preapprovalEmailSchema, invite: z.boolean() })
  .parse(JSON.parse(await Bun.stdin.text()));
const database = createDatabase({
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
  await database.runPreapprovalCommand({
    command,
    serviceId: 'daisy-admin',
    operatorRef: 'o'.repeat(24),
    requestDigest: createHash('sha3-256')
      .update(JSON.stringify(command))
      .digest('hex'),
    nextId: createId,
    live: () => true,
  });
  process.stdout.write(JSON.stringify({ saved: true }));
} finally {
  await database.close();
}

import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { cleanupWork } from '@daisy/protocol/billing';
import { cleanupCandidate } from './billing-cleanup-candidate.test-support';
import { withBillingRefunds } from './billing-refunds.test-support';

requireTestServices(process.env);
setupRitewayBun();
const candidate = new URL(
  '../migrations/20261106110238_stripe_invoice_pass_authority/migration.sql',
  import.meta.url,
);

test('runtime invoice page admission requires durable exact witnesses before retaining its cursor', async () => {
  await withBillingRefunds(async ({ fixture, userId, actorId }) => {
    const rollback = new Error('Owned invoice-page rollback');
    try {
      await fixture.sql.begin(async (tx) => {
        await tx.unsafe(await Bun.file(candidate).text());
        await tx`set local role daisy_web`;
        await tx`select * from public.daisy_authorization_accounts_v2(array[${actorId}]::text[],null::text,true)`;
        const [row] =
          await tx`select id from privacy_jobs where subject_ref=${userId} and vendor='stripe'`;
        const matrix = cleanupCandidate(tx, row!.id);
        for (let step = 0; step < 2; step++) {
          const state = await matrix.claim();
          await matrix.apply({
            kind: 'page',
            claimId: matrix.token(state),
            work: cleanupWork(state)!,
            ids: [],
            more: false,
          });
        }
        const state = await matrix.claim();
        const before = await matrix.read();
        const code = await matrix.probe(() =>
          matrix.apply({
            kind: 'page',
            claimId: matrix.token(state),
            work: cleanupWork(state)!,
            ids: ['in_ownedPageFirst', 'in_ownedPageRemainder'],
            more: false,
          }),
        );
        assert({
          given:
            'a current runtime invoice-page claim with two positively observed identities but no retained witnesses',
          should:
            'refuse cursor progress atomically, preserving the claimed frame',
          actual: [code, await matrix.read()],
          expected: ['23514', before],
        });
        await matrix.retainInvoice('in_ownedPageFirst');
        await matrix.retainInvoice('in_ownedPageRemainder');
        assert({
          given:
            'the same exact current page after both owned owed witnesses are durable',
          should:
            'admit selected identity and remainder without manufacturing enumeration completion',
          actual: await matrix.probe(() =>
            matrix.apply({
              kind: 'page',
              claimId: matrix.token(state),
              work: cleanupWork(state)!,
              ids: ['in_ownedPageFirst', 'in_ownedPageRemainder'],
              more: false,
            }),
          ),
          expected: 'accepted',
        });
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  });
});

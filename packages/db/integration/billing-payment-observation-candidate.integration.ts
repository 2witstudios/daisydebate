import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { withClosedPurchase } from './billing-cleanup-purchases.test-support';
import { sqlStateOf } from './constraint-helpers';
import { exerciseObservedMoney } from './billing-payment-observation-money.test-support';
requireTestServices(process.env);
setupRitewayBun();
const candidate = new URL(
  './fixtures/billing-private-113/20261106000213_billing_payment_observations.sql',
  import.meta.url,
);

test('observation candidate preserves immutable owned evidence and real runtime privileges inside a rollback fixture', async () =>
  withClosedPurchase(true, async ({ fixture, subject, session }) => {
    const rollback = new Error('Observation candidate rollback');
    try {
      await fixture.sql.begin(async (tx) => {
        const [schema] =
          await tx`select to_regclass('public.billing_payment_observations') as relation`;
        // The isolated predecessor proof installs draft DDL in this rollback; normal CI uses its migrated schema.
        if (schema!.relation === null)
          await tx.unsafe(await Bun.file(candidate).text());
        await tx`set local role daisy_web`;
        await tx`select * from public.daisy_authorization_accounts_v2(array[${subject.actorId}]::text[],null::text,true)`;
        const [purchase] =
          await tx`select id,admitted_at from billing_purchases where user_id=${subject.userId} and state->>'kind'='complete'`;
        const [clock] =
          await tx`select date_trunc('milliseconds',deleted_at) as closed,date_trunc('milliseconds',clock_timestamp()) as at from users where id=${subject.userId}`;
        const source = {
          kind: 'purchase',
          purchaseId: purchase!.id,
          vendorSubscriptionId: session.subscriptionId,
          priceId: 'price_fixture',
          admittedAt: purchase!.admitted_at.toISOString(),
        };
        const invoiceId = `in_${createId()}`,
          paymentId = `inpay_${createId()}`,
          id = createId();
        const state = {
          kind: 'owed',
          reason: 'payment_unresolved',
          evidence: {
            kind: 'partial',
            facts: {
              status: null,
              paidAtSeconds: null,
              amountPaidMinor: null,
              charge: { kind: 'unresolved' },
              period: null,
            },
          },
        };
        const insert = (
          rowId: string,
          payment: string | null,
          ownerId = subject.userId,
        ) => tx`insert into billing_payment_observations(id,user_id,mode,vendor_customer_id,vendor_invoice_id,kind,vendor_invoice_payment_id,source,state,closed_at,created_at,observed_at)
          values(${rowId},${ownerId},'test',${session.customerId},${invoiceId},'payment',${payment},${JSON.stringify(source)}::text::jsonb,${JSON.stringify(state)}::text::jsonb,${clock!.closed},${clock!.at},${clock!.at})`;
        const probe = async (work: () => Promise<unknown>) => {
          await tx`savepoint observation_probe`;
          const code = await sqlStateOf(work);
          await tx`rollback to savepoint observation_probe`;
          await tx`release savepoint observation_probe`;
          return code;
        };
        await insert(id, paymentId);
        const [original] =
          await tx`select * from billing_payment_observations where id=${id}`;
        const identityCodes = [
          await probe(
            () =>
              tx`update billing_payment_observations set vendor_invoice_id='in_other' where id=${id}`,
          ),
          await probe(
            () =>
              tx`update billing_payment_observations set source=jsonb_set(source,'{priceId}','"price_current"') where id=${id}`,
          ),
          await probe(
            () =>
              tx`update billing_payment_observations set created_at=created_at-interval '1 second' where id=${id}`,
          ),
          await probe(() => insert(createId(), null)),
          await probe(
            () => tx`delete from billing_payment_observations where id=${id}`,
          ),
        ];
        assert({
          given:
            'actual daisy_web and an owned unknown payment with a corroborated frozen offer',
          should:
            'retain exact original identity/source and reject null payment identity or ordinary deletion',
          actual: [
            identityCodes,
            (
              await tx`select * from billing_payment_observations where id=${id}`
            )[0],
          ],
          expected: [['23514', '23514', '23514', '23514', '42501'], original],
        });
        const witnessId = createId();
        const witnessState = {
          kind: 'owed',
          reason: 'enumeration_unavailable',
        };
        await tx`insert into billing_payment_observations(id,user_id,mode,vendor_customer_id,vendor_invoice_id,kind,source,state,closed_at,created_at,observed_at)
          values(${witnessId},${subject.userId},'test',${session.customerId},${invoiceId},'invoice',${JSON.stringify(source)}::text::jsonb,${JSON.stringify(witnessState)}::text::jsonb,${clock!.closed},${clock!.at},${clock!.at})`;
        const coverage = {
          kind: 'resolved',
          basis: 'enumeration_retained',
          paymentCount: 1,
          lastPaymentId: paymentId,
        };
        const invalidCoverage = { ...coverage, lastPaymentId: 'inpay_absent' };
        const missingIdentity = await probe(
          () =>
            tx`update billing_payment_observations set state=${JSON.stringify(invalidCoverage)}::text::jsonb where id=${witnessId}`,
        );
        const missingPass = await probe(
          () =>
            tx`update billing_payment_observations set state=${JSON.stringify(coverage)}::text::jsonb where id=${witnessId}`,
        );
        assert({
          given:
            'an invoice-only witness and a positively retained exact payment identity',
          should:
            'refuse both absent identity and bare retained identity without current pass authority, leaving independent payment owed',
          actual: [
            missingIdentity,
            missingPass,
            (
              await tx`select state from billing_payment_observations where id=${witnessId}`
            )[0]!.state,
            (
              await tx`select state from billing_payment_observations where id=${id}`
            )[0]!.state,
          ],
          expected: ['23514', '23514', witnessState, state],
        });
        const malformed = {
          ...state,
          evidence: {
            ...state.evidence,
            facts: { ...state.evidence.facts, amountPaidMinor: '0' },
          },
        };
        assert({
          given: 'untrusted raw SQL against the runtime role',
          should:
            'reject malformed known facts, invented refund links, foreign frozen sources and future recognition',
          actual: [
            await probe(
              () =>
                tx`update billing_payment_observations set state=${JSON.stringify(malformed)}::text::jsonb where id=${id}`,
            ),
            await probe(
              () =>
                tx`update billing_payment_observations set refund_action_id=${createId()} where id=${id}`,
            ),
            await probe(
              () =>
                tx`update billing_payment_observations set source=jsonb_set(source,'{purchaseId}',to_jsonb(${createId()}::text)) where id=${id}`,
            ),
            await probe(
              () =>
                tx`update billing_payment_observations set observed_at=clock_timestamp()+interval '1 minute' where id=${id}`,
            ),
          ],
          expected: ['23514', '23514', '23514', '23514'],
        });
        const paidAtSeconds = Math.floor(clock!.closed.getTime() / 1000) - 1;
        const proof = {
          mode: 'test',
          customerId: session.customerId,
          invoiceId,
          invoicePaymentId: paymentId,
          vendorSubscriptionId: session.subscriptionId,
          priceId: 'price_fixture',
          status: 'paid',
          paidAtSeconds,
        };
        const resolved = {
          kind: 'resolved',
          basis: 'pre_closure',
          evidence: {
            kind: 'chronology',
            proof,
            facts: { ...state.evidence.facts, status: 'paid', paidAtSeconds },
          },
        };
        await tx`update billing_payment_observations set state=${JSON.stringify(resolved)}::text::jsonb where id=${id}`;
        const [recognized] =
          await tx`select state from billing_payment_observations where id=${id}`;
        const changed = structuredClone(resolved);
        changed.evidence.proof.paidAtSeconds++;
        changed.evidence.facts.paidAtSeconds++;
        assert({
          given:
            'positive exact pre-closure payment chronology with no charge/amount/period',
          should:
            'retain minimal proof, reject changed chronology and reject loss of known facts',
          actual: [
            recognized!.state,
            await probe(
              () =>
                tx`update billing_payment_observations set state=${JSON.stringify(changed)}::text::jsonb where id=${id}`,
            ),
            await probe(
              () =>
                tx`update billing_payment_observations set state=${JSON.stringify(state)}::text::jsonb where id=${id}`,
            ),
          ],
          expected: [resolved, '23514', '23514'],
        });
        assert({
          given: 'the generated table under actual runtime role',
          should:
            'offer only private bounded read/write privileges without realtime or deletion access',
          actual: (
            await tx`select has_table_privilege('daisy_web','billing_payment_observations','SELECT') as read,has_table_privilege('daisy_web','billing_payment_observations','INSERT') as insert,has_table_privilege('daisy_web','billing_payment_observations','UPDATE') as update,has_table_privilege('daisy_web','billing_payment_observations','DELETE') as delete,has_table_privilege('daisy_realtime','billing_payment_observations','SELECT') as realtime`
          )[0],
          expected: {
            read: true,
            insert: true,
            update: true,
            delete: false,
            realtime: false,
          },
        });
        await exerciseObservedMoney({
          tx,
          userId: subject.userId,
          customerId: session.customerId,
          invoiceId,
          subscriptionId: session.subscriptionId,
          source,
          closedAt: clock!.closed,
          probe,
        });
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }));

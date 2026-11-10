import { assert, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

const specifiers = async (file: string) =>
  [
    ...(await Bun.file(new URL(file, import.meta.url)).text()).matchAll(
      /^(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm,
    ),
  ].map((match) => match[1]);

test('the service lease subpath loads nothing but the error identity', async () => {
  assert({
    given:
      '@daisy/db/service-lease-lapse, which apps/web worker sinks and lease health import',
    should:
      'import only @daisy/errors and the driver-free capacity-refusal module, never the driver, Bun or the schema',
    actual: [
      await specifiers('./service-lease-lapse.ts'),
      await specifiers('./capacity-refusal.ts'),
    ],
    expected: [['@daisy/errors', './capacity-refusal'], ['@daisy/errors']],
  });
});

test('a lapse is recognised through native cause wrappers', async () => {
  const { createAppError, createRefusal } = await import('@daisy/errors');
  const { isServiceLeaseLapse } = await import('./service-lease-lapse');
  const lapse = createRefusal('AUTHORIZATION', 'service-lease-lapsed');
  assert({
    given:
      'the lapse refusal itself, the lapse wrapped by a worker stage error, and an unrelated authorization failure',
    should: 'recognise the first two and not the third (DAISY-WEB-9)',
    actual: [
      isServiceLeaseLapse(lapse),
      isServiceLeaseLapse(
        createAppError('INFRASTRUCTURE', 'stage failed', lapse),
      ),
      isServiceLeaseLapse(createAppError('AUTHORIZATION', 'denied')),
    ],
    expected: [true, true, false],
  });
});

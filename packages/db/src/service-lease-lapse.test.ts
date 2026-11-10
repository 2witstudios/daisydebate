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
    should: 'import only @daisy/errors, never the driver, Bun or the schema',
    actual: await specifiers('./service-lease-lapse.ts'),
    expected: ['@daisy/errors'],
  });
});

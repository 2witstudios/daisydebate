import { assert, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

const specifiers = async (file: string) =>
  [
    ...(await Bun.file(new URL(file, import.meta.url)).text()).matchAll(
      /^(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm,
    ),
  ].map((match) => match[1]);

test('the capacity subpath loads nothing but the error identity', async () => {
  assert({
    given:
      '@daisy/db/capacity, which apps/web reaches from client bundles through server/http.ts',
    should:
      'import only transaction-admission, and it only @daisy/errors, never the driver, Bun or the schema',
    actual: {
      capacity: await specifiers('./capacity.ts'),
      admission: await specifiers('./transaction-admission.ts'),
    },
    expected: {
      capacity: ['./transaction-admission'],
      admission: ['@daisy/errors'],
    },
  });
});

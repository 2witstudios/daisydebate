import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
setupRitewayBun();
requireTestServices(process.env);

test('DEC421 measures one contained pinned native FFI compile on normal Linux CI', async () => {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    process.stdout.write(
      'DEC421 compilation is reserved for its authorized Linux CI pass\n',
    );
    return;
  }
  const { observeNativeCompile } =
    await import('./native-owner-compile.test-support');
  const exit = await observeNativeCompile().catch(() => {
    process.stdout.write(
      JSON.stringify({
        event: 'native.ownerCompile',
        stage: 'refused',
        category: 'ci-budget-toolchain-or-supervisor',
      }) + '\n',
    );
    return 1;
  });
  assert({
    given:
      'one fixed-pin compile after real containment controls, within the remaining CI budget',
    should: 'record its bounded outcome and leave no build descendants',
    actual: exit,
    expected: 0,
  });
}, 1810000);

import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { useSecond } from './use-second';
import { createRoundTime } from '../../features/round-runtime/round-time';

setupRitewayBun();

function Clock({ renderedAtMs }: { readonly renderedAtMs: number }) {
  const clock = createRoundTime({
    monotonicNowMs: () => 0,
    hydrationSeedServerMs: renderedAtMs,
  });
  const now = useSecond(renderedAtMs, clock);
  return <time data-now={now}>{now}</time>;
}

test('useSecond starts from the server render instant so hydration matches', () => {
  const renderedAtMs = 1_778_000_000_000;
  const html = renderToStaticMarkup(<Clock renderedAtMs={renderedAtMs} />);
  assert({
    given: 'a server-rendered live room before any effect runs',
    should: 'seed the display clock from the render instant, never wall time',
    actual: html,
    expected: `<time data-now="${renderedAtMs}">${renderedAtMs}</time>`,
  });
});

function SharedClock() {
  let mono = 0;
  const clock = createRoundTime({
    monotonicNowMs: () => mono,
    hydrationSeedServerMs: 10000,
  });
  mono = 15;
  const now = useSecond(10000, clock);
  return <time>{now}</time>;
}

test('shared owner preserves the exact hydration seed before effects', () => {
  assert({
    given: 'time elapsed during render before useSecond reads the shared clock',
    should: 'render identical seed markup on server and hydrating browser',
    actual: renderToStaticMarkup(<SharedClock />),
    expected: '<time>10000</time>',
  });
});

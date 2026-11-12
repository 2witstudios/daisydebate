import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createPhraseSource, phraseSourceOf } from './phrase-source';

setupRitewayBun();

test('a phrase source gives each phrase once it is produced, then ends', async () => {
  const producer = createPhraseSource();
  const { source } = producer;
  const second = source.at(1);
  producer.push(['One.']);
  assert({
    given: 'one phrase produced',
    should: 'have it ready and the next not yet',
    actual: [source.ready(0), source.ready(1), source.ended()],
    expected: ['One.', undefined, false],
  });
  producer.push(['Two.']);
  producer.end();
  producer.push(['Late.']);
  assert({
    given: 'a second phrase, the end, and a phrase pushed after the end',
    should: 'resolve the waiting read, end after it and add nothing more',
    actual: [await second, await source.at(2), source.ended(), source.cutBy()],
    expected: ['Two.', null, true, null],
  });
});

test('a source cut short keeps what it produced and never rejects', async () => {
  const producer = createPhraseSource();
  const error = new Error('stream broke');
  producer.push(['One.']);
  const next = producer.source.at(1);
  producer.cut(error);
  producer.end();
  assert({
    given: 'a source cut after one phrase',
    should: 'still give that phrase, end the next read and name the cause',
    actual: [
      await producer.source.at(0),
      await next,
      producer.source.cutBy()?.error === error,
    ],
    expected: ['One.', null, true],
  });
});

test('a finished answer is a source that has already ended', async () => {
  const source = phraseSourceOf(['One.', 'Two.']);
  assert({
    given: 'a finished phrase list',
    should: 'give its phrases and end',
    actual: [source.ready(1), await source.at(2), source.ended()],
    expected: ['Two.', null, true],
  });
});

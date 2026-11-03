import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { RecordingPreparationStatus } from './recording-preparation';

setupRitewayBun();

const render = (
  preparation: Parameters<typeof RecordingPreparationStatus>[0]['preparation'],
) =>
  renderToStaticMarkup(
    <RecordingPreparationStatus preparation={preparation} />,
  );

describe('RecordingPreparationStatus', () => {
  test('says where the build really is, in the units of its step', () => {
    const encoding = render({
      stage: 'building',
      delayed: false,
      progress: { step: 'encoding', done: 2_480_000, total: 4_800_000 },
    });
    assert({
      given: 'an encode 41:20 into an 80 minute video',
      should: 'name the step and those figures, with no invented percentage',
      actual: [
        encoding.includes('Step 3 of 5'),
        encoding.includes('Encoding for playback: 41:20 of 1:20:00'),
        encoding.includes('value="2480000"'),
        encoding.includes('%'),
      ],
      expected: [true, true, true, false],
    });
    assert({
      given: 'an upload under way',
      should: 'count files',
      actual: render({
        stage: 'building',
        delayed: false,
        progress: { step: 'uploading', done: 412, total: 3600 },
      }).includes('Saving the video: 412 of 3600 files'),
      expected: true,
    });
  });

  test('never shows a bar for what has no figures', () => {
    assert({
      given: 'a build no worker holds yet',
      should: 'say it is waiting, with no progress bar',
      actual: [
        render({ stage: 'waiting', delayed: false }).includes(
          'Waiting for its turn',
        ),
        render({ stage: 'waiting', delayed: false }).includes('<progress'),
        render({ stage: 'capturing' }).includes('still being captured'),
      ],
      expected: [true, false, true],
    });
  });

  test('tells a viewer it is delayed, and never that it is lost', () => {
    const late = render({ stage: 'waiting', delayed: true });
    assert({
      given: 'a build past its bound, and one within it',
      should: 'say it is late only when it is, and still being worked on',
      actual: [
        late.includes('taking longer than it should'),
        late.includes('still being worked on'),
        render({ stage: 'waiting', delayed: false }).includes('taking longer'),
      ],
      expected: [true, true, false],
    });
  });
});

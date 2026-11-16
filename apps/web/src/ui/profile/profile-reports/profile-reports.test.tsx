import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ProfileReports, profileReportTargets } from './profile-reports';

setupRitewayBun();

const profileId = 'p'.repeat(24);
const photoId = 'f'.repeat(24);
const shown = { profileId, displayName: 'Ada', bio: 'Hi.', photoId };
const nothing = {
  profileId: null,
  displayName: null,
  bio: null,
  photoId: null,
};

describe('profileReportTargets', () => {
  test('what is shown is what may be reported', () => {
    assert({
      given: 'a photo, display name and bio, then a bio alone, then nothing',
      should:
        'report the photo by its id and the text by the profile id, only while each is shown',
      actual: [
        profileReportTargets(shown).map((t) => [t.targetKind, t.targetId]),
        profileReportTargets({ ...nothing, profileId, bio: 'Hi.' }).map(
          (t) => t.targetKind,
        ),
        profileReportTargets(nothing),
      ],
      expected: [
        [
          ['profile_photo', photoId],
          ['profile_display_name', profileId],
          ['profile_bio', profileId],
        ],
        ['profile_bio'],
        [],
      ],
    });
  });
});

describe('ProfileReports', () => {
  test('forms and the answer', () => {
    const html = renderToStaticMarkup(
      <ProfileReports shown={shown} notice="received" action={() => {}} />,
    );
    assert({
      given: 'a full profile and a report that reached moderation',
      should:
        'offer three report forms with the safety reasons and say it was received',
      actual: [
        html.match(/<form /g)?.length,
        html.includes('name="targetKind" value="profile_photo"'),
        html.includes('value="impersonation"'),
        html.includes('value="result_dispute"'),
        html.includes('Your report reached the moderation team'),
      ],
      expected: [3, true, true, false, true],
    });
  });

  test('nothing to report', () => {
    assert({
      given: 'a profile that shows nothing and no answer',
      should: 'render nothing',
      actual: renderToStaticMarkup(
        <ProfileReports shown={nothing} notice={null} action={() => {}} />,
      ),
      expected: '',
    });
  });
});

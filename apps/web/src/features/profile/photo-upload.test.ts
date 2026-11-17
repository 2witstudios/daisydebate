import {
  PROFILE_PHOTO_MAX_BYTES,
  profilePhotoRefusals,
} from '@daisy/protocol/public-profile';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  localPhotoRefusal,
  photoRefusalCopy,
  photoRemovalNotice,
  photoUploadNotice,
  removeProfilePhoto,
  uploadProfilePhoto,
} from './photo-upload';

setupRitewayBun();

const photoId = 'f'.repeat(24);
const profile = {
  version: 1,
  displayName: null,
  bio: null,
  photo: { published: null, inReview: photoId },
  photoUploads: 'available',
};
const png = new Blob([new Uint8Array([137, 80, 78, 71])], {
  type: 'image/png',
});

/** A fetch that answers once and records what it was asked. */
const answering = (response: Response | Error) => {
  const calls: {
    url: string;
    method: string | undefined;
    type: string | null;
    body: unknown;
  }[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method,
      type: new Headers(init.headers).get('content-type'),
      body: init.body,
    });
    if (response instanceof Error) throw response;
    return response;
  };
  return { fetch, calls };
};

describe('photoRefusalCopy', () => {
  test('every refusal word has its own plain sentence', () => {
    const copy = profilePhotoRefusals.map((word) => photoRefusalCopy[word]);
    assert({
      given: 'every word a photo upload may answer with',
      should: 'have distinct, non-empty copy for each and nothing else',
      actual: [
        Object.keys(photoRefusalCopy).sort(),
        copy.every((text) => text.length > 0),
        new Set(copy).size,
      ],
      expected: [
        [...profilePhotoRefusals].sort(),
        true,
        profilePhotoRefusals.length,
      ],
    });
  });
});

describe('localPhotoRefusal', () => {
  test('what the browser can tell before sending', () => {
    assert({
      given: 'a PNG, an SVG, a GIF and a JPEG one byte over the bound',
      should: 'pass the PNG and refuse the others by type or size',
      actual: [
        localPhotoRefusal({ type: 'image/png', size: 4 }),
        localPhotoRefusal({ type: 'image/svg+xml', size: 4 }),
        localPhotoRefusal({ type: 'image/gif', size: 4 }),
        localPhotoRefusal({
          type: 'image/jpeg',
          size: PROFILE_PHOTO_MAX_BYTES + 1,
        }),
      ],
      expected: [
        null,
        'photo-type-unsupported',
        'photo-type-unsupported',
        'photo-too-large',
      ],
    });
  });
});

describe('uploadProfilePhoto', () => {
  test('an accepted upload', async () => {
    const { fetch, calls } = answering(
      Response.json({ version: 1, status: 'in_review', profile }),
    );
    const outcome = await uploadProfilePhoto(fetch, png);
    assert({
      given: 'a PNG the server holds for review',
      should:
        'post the file itself as the body with its own type, and say it is in review',
      actual: [
        outcome,
        calls.map((call) => [
          call.url,
          call.method,
          call.type,
          call.body === png,
        ]),
        photoUploadNotice(outcome),
      ],
      expected: [
        { kind: 'accepted', status: 'in_review' },
        [['/api/profile/photo', 'POST', 'image/png', true]],
        'Photo uploaded. Only you see it until it is reviewed.',
      ],
    });
  });

  test('refusals and lost answers', async () => {
    const upload = (response: Response | Error) =>
      uploadProfilePhoto(answering(response).fetch, png);
    assert({
      given:
        'a refusal word, a rate limit, an unknown refusal, an off-contract success and a dropped call',
      should:
        'name the refusal, the rate limit, and call everything else unavailable',
      actual: await Promise.all([
        upload(Response.json({ refusal: 'photo-malware' }, { status: 422 })),
        upload(new Response(null, { status: 429 })),
        upload(Response.json({ refusal: 'photo-cursed' }, { status: 422 })),
        upload(Response.json({ version: 1, status: 'removed' })),
        upload(new Error('offline')),
      ]),
      expected: [
        { kind: 'refused', refusal: 'photo-malware' },
        { kind: 'rate-limited' },
        { kind: 'unavailable' },
        { kind: 'unavailable' },
        { kind: 'unavailable' },
      ],
    });
  });

  test('a restricted account is told it cannot add a photo', async () => {
    const outcome = await uploadProfilePhoto(
      answering(new Response(null, { status: 403 })).fetch,
      png,
    );
    assert({
      given: 'an upload refused 403 (no participant access)',
      should: 'say the account cannot add one, not to try again',
      actual: [outcome, photoUploadNotice(outcome)],
      expected: [
        { kind: 'not-allowed' },
        'Your account can’t add a photo right now. You can still remove one.',
      ],
    });
  });

  test('an upload rate limit names its hour, not a minute', () => {
    assert({
      given: 'a rate-limited upload (6 an hour)',
      should: 'tell the member to wait an hour',
      actual: photoUploadNotice({ kind: 'rate-limited' }),
      expected:
        'You’ve uploaded several photos recently. Try again in an hour.',
    });
  });

  test('a file the browser refuses', async () => {
    const { fetch, calls } = answering(new Response(null));
    const outcome = await uploadProfilePhoto(
      fetch,
      new Blob(['<svg/>'], { type: 'image/svg+xml' }),
    );
    assert({
      given: 'an SVG',
      should: 'refuse it as unsupported without sending anything',
      actual: [outcome, calls.length, photoUploadNotice(outcome)],
      expected: [
        { kind: 'refused', refusal: 'photo-type-unsupported' },
        0,
        'Choose a JPEG, PNG or WebP image.',
      ],
    });
  });
});

describe('removeProfilePhoto', () => {
  test('clearing the photo', async () => {
    const removed = answering(Response.json(profile));
    const outcomes = await Promise.all([
      removeProfilePhoto(removed.fetch),
      removeProfilePhoto(answering(new Response(null, { status: 429 })).fetch),
      removeProfilePhoto(answering(new Error('offline')).fetch),
    ]);
    assert({
      given: 'an accepted removal, a rate limit and a dropped call',
      should: 'send one DELETE and say what happened to each',
      actual: [
        removed.calls.map((call) => [call.url, call.method]),
        outcomes.map(photoRemovalNotice),
      ],
      expected: [
        [['/api/profile/photo', 'DELETE']],
        [
          'Photo removed.',
          'Too many changes at once. Try again in a minute.',
          'Could not remove the photo. Try again.',
        ],
      ],
    });
  });
});

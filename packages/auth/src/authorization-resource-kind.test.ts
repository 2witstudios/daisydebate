import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { AuthorizationCapability } from '@daisy/protocol/authorization';
import { validResourceKind } from './authorization-resource-kind';

setupRitewayBun();

const ownProfile = { kind: 'public_profile', actorId: 'actor-1' } as const;
const moderation = { kind: 'content_moderation' } as const;
const ownProfileCapabilities: readonly AuthorizationCapability[] = [
  'profile.public.read',
  'profile.public.update',
  'profile.public.withdraw',
];
const profileModeration: readonly AuthorizationCapability[] = [
  'profile_photo.review.read',
  'profile_photo.review',
  'profile_photo.remove',
  'profile_text.remove',
];

test('public profile capabilities (ADR 0143)', () => {
  assert({
    given: "a member's own public profile",
    should: 'admit every own-profile capability',
    actual: ownProfileCapabilities.map((c) => validResourceKind(c, ownProfile)),
    expected: [true, true, true],
  });
  assert({
    given: 'the content moderation resource',
    should: 'refuse every own-profile capability',
    actual: ownProfileCapabilities.map((c) => validResourceKind(c, moderation)),
    expected: [false, false, false],
  });
  assert({
    given: 'the content moderation resource',
    should: 'admit every profile moderation capability',
    actual: profileModeration.map((c) => validResourceKind(c, moderation)),
    expected: [true, true, true, true],
  });
  assert({
    given: "a member's own public profile",
    should: 'refuse every profile moderation capability',
    actual: profileModeration.map((c) => validResourceKind(c, ownProfile)),
    expected: [false, false, false, false],
  });
});

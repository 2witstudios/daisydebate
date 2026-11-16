'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  photoRemovalNotice,
  photoUploadNotice,
  removeProfilePhoto,
  uploadProfilePhoto,
} from '../../../features/profile/photo-upload';
import {
  renderProfilePhotoControl,
  type PhotoControlActivity,
  type ProfilePhotoControlProps,
} from './profile-photo-control.render';

/**
 * The photo control's shell: it sends the chosen file as the request body
 * (server actions cap bodies at 16 KiB, ADR 0143), says what came of it, and
 * refreshes the page so every photo on it is the new one.
 */
export function ProfilePhotoControl(
  props: Pick<ProfilePhotoControlProps, 'name' | 'photo' | 'photoUploads'>,
) {
  const router = useRouter();
  const [activity, setActivity] = useState<PhotoControlActivity>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  return renderProfilePhotoControl({
    ...props,
    activity,
    notice,
    onChoose: (file) => {
      setActivity('uploading');
      setNotice(null);
      void uploadProfilePhoto(fetch, file).then((outcome) => {
        setActivity('idle');
        setNotice(photoUploadNotice(outcome));
        if (outcome.kind === 'accepted') router.refresh();
      });
    },
    onRemove: () => {
      setActivity('removing');
      setNotice(null);
      void removeProfilePhoto(fetch).then((outcome) => {
        setActivity('idle');
        setNotice(photoRemovalNotice(outcome));
        if (outcome.kind === 'removed') router.refresh();
      });
    },
  });
}

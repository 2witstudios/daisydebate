'use client';

import { useState } from 'react';
import { authClient } from '../../../lib/auth-client';
import { requestEmailChange } from '../../../features/account/security-client';
import { Button } from '../../components/button/button';
import { Notice } from '../../auth/notice/notice';
import { OUTCOME_NOTICES } from './security-notices';

export function EmailChangeForm() {
  const [newEmail, setNewEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<
    { readonly tone: 'error' | 'info'; readonly title: string } | undefined
  >();

  const submit = async () => {
    setPending(true);
    setNotice(undefined);
    const outcome = await requestEmailChange(authClient, newEmail.trim());
    setPending(false);
    setNotice(
      outcome.kind === 'ok'
        ? {
            tone: 'info',
            title:
              'Check the inbox for the address currently on file to approve this change.',
          }
        : { tone: 'error', title: OUTCOME_NOTICES[outcome.kind] },
    );
  };

  return (
    <form
      className="flex flex-col items-start gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label htmlFor="new-email">New email address</label>
      <input
        id="new-email"
        type="email"
        required
        value={newEmail}
        onChange={(event) => setNewEmail(event.target.value)}
        disabled={pending}
        className="rounded-md border border-border bg-surface px-2 py-1"
      />
      <Button type="submit" disabled={pending || newEmail.trim() === ''}>
        {pending ? 'Sending…' : 'Change email'}
      </Button>
      {notice ? (
        <Notice
          id="email-change-notice"
          tone={notice.tone}
          title={notice.title}
        />
      ) : null}
    </form>
  );
}

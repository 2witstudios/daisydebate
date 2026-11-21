'use client';

import '../../../lib/zod-jitless';
import { useState } from 'react';
import {
  friendApprovalLimits,
  protectionLevels,
  type ProtectionLevel,
} from '@daisy/protocol/protection-level';
import { protectionLevelLabels } from '../../../features/parental-controls/protection-level-labels';
import { controlClass } from '../../components/form-field/form-field-class';
import { GuardianForm, type GuardianFormAction } from './guardian-form';

const approvalLabels = {
  none: 'None',
  'inbound-adult': 'Incoming requests from adults',
  all: 'All new friends',
};

const descriptions = {
  independent: 'Daisy’s standard teen settings apply.',
  guided: 'Approve incoming friend requests from adults.',
  supervised:
    'Approve all new friends. Message requests come from friends only. Ranked play is off.',
  custom: 'Choose which limits apply.',
} satisfies Record<ProtectionLevel['level'], string>;

export function ProtectionLevelForm({
  action,
  choice,
  child,
}: {
  readonly action: GuardianFormAction;
  readonly choice: ProtectionLevel;
  readonly child: string;
}) {
  const [selected, select] = useState(choice.level);
  return (
    <GuardianForm action={action} label="Save protection level">
      <label className="flex w-full flex-col gap-1 text-sm">
        Protection level for {child}
        <select
          name="level"
          className={controlClass}
          value={selected}
          onChange={(event) =>
            select(
              protectionLevels.find(
                (level) => level === event.currentTarget.value,
              ) ?? choice.level,
            )
          }
        >
          {protectionLevels.map((level) => (
            <option key={level} value={level}>
              {protectionLevelLabels[level]}
            </option>
          ))}
        </select>
      </label>
      <p className="text-sm text-ink-muted">{descriptions[selected]}</p>
      {selected === 'custom' ? (
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="font-semibold">Custom limits</legend>
          <label className="flex flex-col gap-1">
            Friendships you approve
            <select
              className={controlClass}
              name="friendApproval"
              defaultValue={
                choice.level === 'custom'
                  ? choice.friendApproval
                  : 'inbound-adult'
              }
            >
              {friendApprovalLimits.map((approval) => (
                <option key={approval} value={approval}>
                  {approvalLabels[approval]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="friendsOnlyMessages"
              value="yes"
              defaultChecked={
                choice.level === 'custom' && choice.friendsOnlyMessages
              }
            />
            Friends-only message requests
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="rankedAllowed"
              value="yes"
              defaultChecked={choice.level !== 'custom' || choice.rankedAllowed}
            />
            Allow ranked play
          </label>
        </fieldset>
      ) : null}
    </GuardianForm>
  );
}

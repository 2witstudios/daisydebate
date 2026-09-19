import { createAppError } from '@daisy/errors';
export type Permission = 'debate:create' | 'debate:manage';
export type Principal =
  | { readonly kind: 'anonymous' }
  | {
      readonly kind: 'user';
      readonly userId: string;
      readonly permissions: readonly Permission[];
    }
  | {
      readonly kind: 'service';
      readonly serviceId: string;
      readonly permissions: readonly Permission[];
    };
/** Principal permissions must come from a trusted authentication adapter, never request JSON. */
export function requirePermission(
  principal: Principal,
  permission: Permission,
): void {
  if (principal.kind === 'anonymous') throw createAppError('AUTHENTICATION');
  if (!principal.permissions.includes(permission))
    throw createAppError('AUTHORIZATION');
}

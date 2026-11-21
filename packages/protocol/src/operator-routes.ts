type OperatorRouteGroup = 'operator' | 'content-moderation';
type OperatorMethod = 'GET' | 'PUT';

function staticRoute<Group extends OperatorRouteGroup, Route extends string>(
  group: Group,
  route: Route,
  method: OperatorMethod,
  path: RegExp,
  query: readonly string[],
) {
  return (incomingMethod: string, pathname: string) =>
    incomingMethod === method && path.test(pathname)
      ? { group, route, query, id: null }
      : null;
}

function parameterizedRoute<
  Group extends OperatorRouteGroup,
  Route extends string,
>(
  group: Group,
  route: Route,
  method: OperatorMethod,
  path: RegExp,
  query: readonly string[],
) {
  return (incomingMethod: string, pathname: string) => {
    if (incomingMethod !== method) return null;
    const id = path.exec(pathname)?.[1];
    return id === undefined ? null : { group, route, query, id };
  };
}

/** Each row owns the method, path, query keys and matched payload for one route. */
const operatorRoutes = [
  staticRoute(
    'operator',
    'listPreapprovals',
    'GET',
    /^\/operator\/v1\/beta-preapprovals$/,
    ['limit', 'cursor'],
  ),
  staticRoute(
    'operator',
    'updatePreapproval',
    'PUT',
    /^\/operator\/v1\/beta-preapprovals$/,
    [],
  ),
  staticRoute('operator', 'listAccounts', 'GET', /^\/operator\/v1\/accounts$/, [
    'access',
    'cursor',
    'limit',
  ]),
  parameterizedRoute(
    'operator',
    'setBetaAccess',
    'PUT',
    /^\/operator\/v1\/accounts\/([a-z0-9]{24})\/beta-access$/,
    [],
  ),
  staticRoute('operator', 'listReports', 'GET', /^\/operator\/v1\/reports$/, [
    'cursor',
    'limit',
  ]),
  parameterizedRoute(
    'operator',
    'resolveReport',
    'PUT',
    /^\/operator\/v1\/reports\/([a-z0-9]{24})\/resolution$/,
    [],
  ),
  staticRoute(
    'operator',
    'listRestrictions',
    'GET',
    /^\/operator\/v1\/moderation$/,
    ['cursor', 'limit'],
  ),
  parameterizedRoute(
    'operator',
    'liftModeration',
    'PUT',
    /^\/operator\/v1\/moderation\/([a-z0-9]{24})\/lift$/,
    [],
  ),
  parameterizedRoute(
    'operator',
    'readCommand',
    'GET',
    /^\/operator\/v1\/commands\/([a-z0-9]{24})$/,
    [],
  ),
  staticRoute(
    'content-moderation',
    'listContentReports',
    'GET',
    /^\/operator\/v1\/content-reports$/,
    ['queue', 'status', 'cursor', 'limit'],
  ),
  parameterizedRoute(
    'content-moderation',
    'readContentReport',
    'GET',
    /^\/operator\/v1\/content-reports\/([a-z0-9]{24})$/,
    [],
  ),
  parameterizedRoute(
    'content-moderation',
    'resolveContentReport',
    'PUT',
    /^\/operator\/v1\/content-reports\/([a-z0-9]{24})\/resolution$/,
    [],
  ),
  parameterizedRoute(
    'content-moderation',
    'stopBroadcast',
    'PUT',
    /^\/operator\/v1\/broadcasts\/([a-z0-9]{24})\/stop$/,
    [],
  ),
  parameterizedRoute(
    'content-moderation',
    'setChatSlowMode',
    'PUT',
    /^\/operator\/v1\/broadcasts\/([a-z0-9]{24})\/chat-slow-mode$/,
    [],
  ),
  parameterizedRoute(
    'content-moderation',
    'takeDownRecording',
    'PUT',
    /^\/operator\/v1\/recordings\/([a-z0-9]{24})\/takedown$/,
    [],
  ),
  parameterizedRoute(
    'content-moderation',
    'restoreRecording',
    'PUT',
    /^\/operator\/v1\/recordings\/([a-z0-9]{24})\/restoration$/,
    [],
  ),
  parameterizedRoute(
    'content-moderation',
    'removeRecording',
    'PUT',
    /^\/operator\/v1\/recordings\/([a-z0-9]{24})\/removal$/,
    [],
  ),
  parameterizedRoute(
    'content-moderation',
    'legallyRemoveRecording',
    'PUT',
    /^\/operator\/v1\/recordings\/([a-z0-9]{24})\/legal-removal$/,
    [],
  ),
  parameterizedRoute(
    'content-moderation',
    'rebuildRecording',
    'PUT',
    /^\/operator\/v1\/recordings\/([a-z0-9]{24})\/rebuild$/,
    [],
  ),
  staticRoute(
    'content-moderation',
    'listRebuildableRecordings',
    'GET',
    /^\/operator\/v1\/recordings\/rebuildable$/,
    [],
  ),
  parameterizedRoute(
    'content-moderation',
    'removeChatMessage',
    'PUT',
    /^\/operator\/v1\/chat-messages\/([a-z0-9]{24})\/removal$/,
    [],
  ),
  staticRoute(
    'content-moderation',
    'listProfilePhotoReviews',
    'GET',
    /^\/operator\/v1\/profile-photos\/in-review$/,
    [],
  ),
  parameterizedRoute(
    'content-moderation',
    'readProfilePhoto',
    'GET',
    /^\/operator\/v1\/profile-photos\/([a-z0-9]{24})$/,
    [],
  ),
  parameterizedRoute(
    'content-moderation',
    'reviewProfilePhoto',
    'PUT',
    /^\/operator\/v1\/profile-photos\/([a-z0-9]{24})\/review$/,
    [],
  ),
  parameterizedRoute(
    'content-moderation',
    'removeProfilePhoto',
    'PUT',
    /^\/operator\/v1\/profile-photos\/([a-z0-9]{24})\/removal$/,
    [],
  ),
  parameterizedRoute(
    'content-moderation',
    'removeProfileText',
    'PUT',
    /^\/operator\/v1\/profiles\/([a-z0-9]{24})\/text-removal$/,
    [],
  ),
  parameterizedRoute(
    'content-moderation',
    'setAudienceBan',
    'PUT',
    /^\/operator\/v1\/accounts\/([a-z0-9]{24})\/audience-ban$/,
    [],
  ),
  parameterizedRoute(
    'operator',
    'setFlagState',
    'PUT',
    /^\/operator\/v1\/flags\/([a-z][a-z0-9-]{1,63})\/state$/,
    [],
  ),
  parameterizedRoute(
    'operator',
    'setFlagOverride',
    'PUT',
    /^\/operator\/v1\/flags\/([a-z][a-z0-9-]{1,63})\/account-override$/,
    [],
  ),
] as const;

export type MatchedOperatorRoute = NonNullable<
  ReturnType<(typeof operatorRoutes)[number]>
>;

/** The route a method and path name, or null for anything else. */
export function matchOperatorRoute(
  method: string,
  path: string,
): MatchedOperatorRoute | null {
  for (const match of operatorRoutes) {
    const route = match(method, path);
    if (route !== null) return route;
  }
  return null;
}

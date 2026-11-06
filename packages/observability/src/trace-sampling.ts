/** Routine routes are identified by product path, never caller-supplied synthetic identity. */
export const routinePathname = String.raw`(?:/api/rounds/[^/?#\s]+/check-in|/(?:api/)?health(?:/(?:live|ready))?)`;
const routinePath = new RegExp(
  String.raw`(?:^|\s|https?://[^/\s]+)${routinePathname}(?:[/?#\s]|$)`,
);
const routeAttributes = [
  'url',
  'url.full',
  'url.path',
  'http.url',
  'http.target',
  'http.route',
  'next.route',
];

/** Initial SDK child-span filters share root sampling's path vocabulary. */
export const routineSpanFilters = [
  /^(?:attendance\.check-in|health\.readiness)$/,
  routinePath,
  ...routeAttributes.map((key) => ({ attributes: { [key]: routinePath } })),
];

/** Explicit return overrides Sentry's inherited sampling decision, including sampled=true. */
export function sampleTrace(input: {
  readonly name: string;
  readonly attributes?: Readonly<Record<string, unknown>> | undefined;
  readonly normalizedRequest?:
    { readonly url?: string | undefined } | undefined;
  readonly parentSampled?: boolean | undefined;
}): number {
  const candidates = [
    input.name,
    input.normalizedRequest?.url,
    ...Object.entries(input.attributes ?? {})
      .filter(([key]) =>
        [
          'url.full',
          'url.path',
          'http.url',
          'http.target',
          'http.route',
          'next.route',
        ].includes(key),
      )
      .map(([, value]) => value),
  ];
  return input.name === 'attendance.check-in' ||
    input.name === 'health.readiness' ||
    candidates.some(
      (value) => typeof value === 'string' && routinePath.test(value),
    )
    ? 0
    : 0.01;
}

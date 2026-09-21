const ORIGIN = 'http://local.invalid';
const controlOrBackslash = /[\u0000-\u001f\u007f\\]/;

/** Percent-decodes up to three layers so double-encoded bypasses surface. */
function decodeLayers(value: string): string[] | null {
  const layers = [value];
  for (let index = 0; index < 3; index += 1) {
    const last = layers[layers.length - 1] ?? '';
    let decoded: string;
    try {
      decoded = decodeURIComponent(last);
    } catch {
      return null;
    }
    if (decoded === last) break;
    layers.push(decoded);
  }
  return layers;
}

/**
 * Return destinations are local paths only. External URLs, protocol-relative
 * and backslash forms, encoded variants and token-bearing queries all fall
 * back, so a confirmation redirect can never leak or forward a credential.
 */
export function safeLocalDestination(
  value: string | null | undefined,
  fallback = '/lobby',
): string {
  if (!value) return fallback;
  const layers = decodeLayers(value);
  if (!layers) return fallback;
  for (const layer of layers) {
    if (controlOrBackslash.test(layer)) return fallback;
    if (!layer.startsWith('/') || layer.startsWith('//')) return fallback;
  }
  // Every decoding layer must also stay a same-origin path once dot segments
  // are resolved, so `/..%2F..%2F//host` cannot become protocol-relative.
  for (const layer of layers) {
    let url: URL;
    try {
      url = new URL(layer, ORIGIN);
    } catch {
      return fallback;
    }
    if (
      url.origin !== ORIGIN ||
      url.pathname.startsWith('//') ||
      url.searchParams.has('token')
    )
      return fallback;
  }
  return value;
}

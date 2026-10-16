/** Bound provider reads, including response-body consumption, while honoring a caller deadline. */
export function providerFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const timeout = AbortSignal.timeout(10_000);
  return fetch(url, {
    ...init,
    signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
  });
}

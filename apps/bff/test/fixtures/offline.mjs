// Preloaded into the server by offline.test.ts: any request that leaves the
// machine fails, as it would on a laptop with no network.
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    return Promise.reject(new TypeError(`offline: blocked request to ${url.origin}`));
  }
  return realFetch(input, init);
};

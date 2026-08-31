/**
 * Polls until an attempt yields a value or the deadline passes.
 *
 * Used instead of a fixed sleep because the two things being waited on — a
 * verifier receiving a submission and a human scanning a QR code — have wildly
 * different and unpredictable latencies.
 */
export async function pollUntil<T>(options: {
  description: string;
  attempt: () => Promise<T | undefined>;
  timeoutMs: number;
  intervalMs: number;
}): Promise<T | undefined> {
  const deadline = Date.now() + options.timeoutMs;

  while (Date.now() < deadline) {
    const result = await options.attempt();
    if (result !== undefined) return result;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
  return undefined;
}

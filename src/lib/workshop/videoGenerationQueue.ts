/**
 * Video submissions are serialized. A following shot may consume the accepted
 * tail frame of the preceding shot, so Promise.all is not a valid scheduler.
 */
export function enqueueVideoGeneration<T>(
  tail: Promise<unknown>,
  jobs: readonly (() => Promise<T>)[],
): { promise: Promise<void>; count: number } {
  const promise = tail.catch(() => undefined).then(async () => {
    for (const job of jobs) await job();
  });
  return { promise, count: jobs.length };
}

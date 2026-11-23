export const resolvedPromise = Promise.resolve();

export async function waitFor<T>(action: () => T | Promise<T>, checkEveryMilliseconds = 50, tryForMilliseconds = 15000, token?: { isCancellationRequested: boolean }): Promise<T | undefined> {
	let timeRemaining = tryForMilliseconds;
	while (timeRemaining > 0 && !(token?.isCancellationRequested)) {
		try {
			const res = await action();
			if (res)
				return res;
		} catch {
			// Just try again if it throws.
		}
		await new Promise((resolve) => setTimeout(resolve, checkEveryMilliseconds).unref());
		timeRemaining -= checkEveryMilliseconds;
	}
}

/**
 * Maps `items` with an async callback using at most `concurrency` in-flight operations,
 * preserving the original input order in the returned array.
 */
export async function mapWithConcurrency<T, R>(
	items: readonly T[],
	concurrency: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	if (!items.length)
		return [];

	const results = new Array<R>(items.length);
	let nextIndex = 0;
	const normalizedConcurrency = Math.max(1, Math.floor(concurrency) || 1);
	const workerCount = Math.min(normalizedConcurrency, items.length);
	await Promise.all(Array.from({ length: workerCount }, async () => {
		while (nextIndex < items.length) {
			const index = nextIndex++;
			results[index] = await fn(items[index], index);
		}
	}));
	return results;
}

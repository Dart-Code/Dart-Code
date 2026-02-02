export const resolvedPromise = Promise.resolve(true);

export async function waitFor<T>(action: () => T | Promise<T>, checkEveryMilliseconds = 50, tryForMilliseconds = 10000, token?: { isCancellationRequested: boolean }): Promise<T | undefined> {
	let timeRemaining = tryForMilliseconds;
	while (timeRemaining > 0 && !(token?.isCancellationRequested)) {
		try {
			const res = await action();
			if (res)
				return res;
		} catch {
			// Just try again if it throws.
		}
		await new Promise((resolve) => setTimeout(resolve, checkEveryMilliseconds));
		timeRemaining -= checkEveryMilliseconds;
	}
}

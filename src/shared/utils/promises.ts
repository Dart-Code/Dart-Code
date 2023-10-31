export const resolvedPromise = Promise.resolve(true);

export async function waitFor<T>(action: () => T | Promise<T>, checkEveryMilliseconds = 100, tryForMilliseconds = 10000, token?: { isCancellationRequested: boolean }): Promise<T | undefined> {
	let timeRemaining = tryForMilliseconds;
	while (timeRemaining > 0 && !(token && token.isCancellationRequested)) {
		const res = await action();
		if (res)
			return res;
		await new Promise((resolve) => setTimeout(resolve, checkEveryMilliseconds));
		timeRemaining -= checkEveryMilliseconds;
	}
}

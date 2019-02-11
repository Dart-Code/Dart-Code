export async function waitFor<T>(action: () => T, checkEveryMilliseconds: number, tryForMilliseconds: number, token?: { isCancellationRequested: boolean }): Promise<T | undefined> {
	checkEveryMilliseconds = checkEveryMilliseconds || 500;
	tryForMilliseconds = tryForMilliseconds || 10000;
	let timeRemaining = tryForMilliseconds;
	while (timeRemaining > 0 && !(token && token.isCancellationRequested)) {
		const res = action();
		if (res)
			return res;
		await new Promise((resolve) => setTimeout(resolve, checkEveryMilliseconds));
		timeRemaining -= checkEveryMilliseconds;
	}
}

export async function waitFor<T>(action: () => T, checkEveryMilliseconds: number = 20, tryForMilliseconds: number = 2000): Promise<T | undefined> {
	let timeRemaining = tryForMilliseconds;
	while (timeRemaining > 0) {
		const res = action();
		if (res)
			return res;
		await new Promise((resolve) => setTimeout(resolve, checkEveryMilliseconds));
		timeRemaining -= 20;
	}
}

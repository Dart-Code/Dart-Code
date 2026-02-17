import * as os from "os";

export function cleanPubOutput(pubOutput: string) {
	// Sometimes pub will output additional text that we need to discard:
	// Precompiling executable...\nPrecompiled test:test.\n[{"name":"console-full","label"
	const precompilingHeaderPattern = RegExp("^Precompil(?:ing|ed).*$", "gm");
	const json = pubOutput.replace(precompilingHeaderPattern, "");
	return json;
}

export const maxConcurrentProcesses = getMaxConcurrentPubProcesses();

/**
 * Gets the maximum number of pub processes to run at once.
 *
 * Callers should generally use `maxConcurrentProcesses`, this is the implementation
 * exposed only for tests.
 */
export function getMaxConcurrentPubProcesses(cpuCount = os.cpus().length): number {
	return Math.max(1, Math.floor(cpuCount / 2));
}

export async function runWithConcurrencyLimit<T>(
	items: T[],
	maxConcurrent: number,
	cancellationToken: { isCancellationRequested: boolean },
	task: (item: T) => Promise<void>,
	onCompleted?: (completed: number, total: number, item: T) => void,
	onStarted?: (item: T) => void,
): Promise<void> {
	if (!items.length)
		return;

	const maxWorkers = Math.max(1, Math.min(maxConcurrent, items.length));
	let nextIndex = 0;
	let completed = 0;
	let firstError: unknown;

	/// A worker that continuously processes items until there are none left.
	const worker = async () => {
		while (!firstError && !cancellationToken.isCancellationRequested) {
			// Grab the index of the next item.
			const index = nextIndex++;
			if (index >= items.length)
				return; // All items are done.

			const item = items[index];
			onStarted?.(item); // Signal that we're starting.

			try {
				await task(item); // Run the main task.
				completed++;
				onCompleted?.(completed, items.length, item);  // Signal that we're done.
			} catch (error) {
				firstError ??= error;
				return;
			}
		}
	};

	await Promise.all(Array.from({ length: maxWorkers }, () => worker()));

	if (firstError)
		throw firstError; // eslint-disable-line @typescript-eslint/only-throw-error
}

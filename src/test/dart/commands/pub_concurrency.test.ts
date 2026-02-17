import { strict as assert } from "assert";
import { getMaxConcurrentPubProcesses, runWithConcurrencyLimit } from "../../../shared/pub/utils";

describe("pub command concurrency", () => {
	const oneToFifteen = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

	it("computes max concurrency as half of CPU count with a floor of one", () => {
		assert.equal(getMaxConcurrentPubProcesses(1), 1);
		assert.equal(getMaxConcurrentPubProcesses(2), 1);
		assert.equal(getMaxConcurrentPubProcesses(3), 1);
		assert.equal(getMaxConcurrentPubProcesses(4), 2);
		assert.equal(getMaxConcurrentPubProcesses(8), 4);
	});

	it("runs tasks with a bounded concurrency and reports completion counts", async () => {
		const cancellationToken = { isCancellationRequested: false };
		let activeTasks = 0;
		let maxActiveTasks = 0;
		const completionCounts: number[] = [];
		const startedItems: number[] = [];

		await runWithConcurrencyLimit(
			oneToFifteen,
			2,
			cancellationToken,
			async () => {
				activeTasks++;
				maxActiveTasks = Math.max(maxActiveTasks, activeTasks);
				await new Promise((resolve) => setTimeout(resolve, 10));
				activeTasks--;
			},
			(completed: number) => completionCounts.push(completed),
			(item: number) => startedItems.push(item),
		);

		assert.equal(maxActiveTasks <= 2, true);
		assert.deepEqual(completionCounts, oneToFifteen);
		assert.deepEqual(startedItems.sort((a, b) => a - b), oneToFifteen);
	});

	it("stops scheduling new tasks after cancellation", async () => {
		const cancellationToken = { isCancellationRequested: false };
		const processedItems: number[] = [];

		await runWithConcurrencyLimit(
			[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
			2,
			cancellationToken,
			async (item: number) => {
				processedItems.push(item);
				if (item === 1)
					cancellationToken.isCancellationRequested = true;
				await new Promise((resolve) => setTimeout(resolve, 5));
			},
		);

		assert.equal(processedItems.length <= 2, true);
	});
});

// Quick Memory Tracking Utility
// Add this to any test file you suspect is leaking memory

export function addMemoryTracking(testSuiteName: string) {
	let baselineMemory: NodeJS.MemoryUsage;

	function logMemory(context: string) {
		const current = process.memoryUsage();
		const formatBytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;

		console.log(`[${testSuiteName}] ${context}:`);
		console.log(`  RSS: ${formatBytes(current.rss)}`);
		console.log(`  Heap Used: ${formatBytes(current.heapUsed)} / ${formatBytes(current.heapTotal)}`);
		console.log(`  External: ${formatBytes(current.external)}`);
		console.log(`  Array Buffers: ${formatBytes(current.arrayBuffers)}`);

		if (baselineMemory) {
			const heapGrowth = current.heapUsed - baselineMemory.heapUsed;
			const arrayBufferGrowth = current.arrayBuffers - baselineMemory.arrayBuffers;

			if (heapGrowth > 50 * 1024 * 1024) { // 50MB threshold
				console.warn(`  ⚠️  Large heap growth: ${formatBytes(heapGrowth)}`);
			}
			if (arrayBufferGrowth > 10 * 1024 * 1024) { // 10MB threshold
				console.warn(`  ⚠️  Large ArrayBuffer growth: ${formatBytes(arrayBufferGrowth)}`);
			}
		}

		return current;
	}

	function forceGC() {
		if (global.gc) {
			console.log(`[${testSuiteName}] Forcing garbage collection...`);
			global.gc();
		}
	}

	return {
		beforeEach: () => {
			baselineMemory = logMemory("Before test");
		},
		afterEach: () => {
			logMemory("After test");
			forceGC();
		},
		logMemory,
		forceGC
	};
}

// Example usage:
/*
import { addMemoryTracking } from "../path/to/this/file";

describe("My Test Suite", () => {
	const memTracker = addMemoryTracking("My Test Suite");

	beforeEach(() => {
		memTracker.beforeEach();
	});

	afterEach(() => {
		memTracker.afterEach();
	});

	it("should do something", () => {
		// Your test code
		memTracker.logMemory("During test");
	});
});
*/

import { strict as assert } from "assert";
import { ext, privateApi } from "../helpers";
import { addMemoryTracking } from "../memory_tracker_util";

// Add detailed memory tracking function
function logDetailedMemory(step: string) {
	const mem = process.memoryUsage();
	console.log(`[DETAILED-MEMORY] ${step}:`);
	console.log(`  RSS: ${(mem.rss / 1024 / 1024).toFixed(1)}MB`);
	console.log(`  Heap Used: ${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB`);
	console.log(`  Heap Total: ${(mem.heapTotal / 1024 / 1024).toFixed(1)}MB`);
	console.log(`  External: ${(mem.external / 1024 / 1024).toFixed(1)}MB`);
	console.log(`  Array Buffers: ${(mem.arrayBuffers / 1024 / 1024).toFixed(1)}MB`);
	return mem;
}

describe("extension", () => {
	const memTracker = addMemoryTracking("extension");

	beforeEach(() => {
		memTracker.beforeEach();
	});

	afterEach(() => {
		memTracker.afterEach();
	});

	it("activated", async () => {
		console.log(`test1`);
		logDetailedMemory("Test start - before any operations");
		memTracker.logMemory("Test start - before privateApi check");
		assert.equal(privateApi, undefined);
		console.log(`test2`);

		logDetailedMemory("Before activateWithoutAnalysis call");
		memTracker.logMemory("Before activation");

		// This is where the 16GB leak happens - let's break it down
		logDetailedMemory("Before ext.isActive check");
		if (!ext.isActive) {
			logDetailedMemory("Extension not active - about to call ext.activate()");
			await ext.activate();
			logDetailedMemory("🚨 CRITICAL: After ext.activate() - CHECK FOR 16GB LEAK HERE");
		} else {
			logDetailedMemory("Extension already active");
		}

		logDetailedMemory("After activation check, before exports");
		if (ext.exports) {
			logDetailedMemory("Before setting privateApi and extApi");
		}

		memTracker.logMemory("After activation - CRITICAL POINT");
		assert.equal(ext.isActive, true);
	});
});

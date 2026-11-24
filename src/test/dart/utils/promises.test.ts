import { strict as assert } from "assert";
import { PromiseCompleter } from "../../../shared/utils";
import { runWhenReadyOrAfterTimeout } from "../../../shared/utils/promises";
import { defer, sb } from "../../helpers";

describe("runWhenReadyOrAfterTimeout", () => {
	async function flushMicrotasks(): Promise<void> {
		await Promise.resolve();
		await Promise.resolve();
	}

	it("runs once when ready resolves before timeout", async () => {
		const clock = sb.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		defer("Restore fake timers", () => clock.restore());

		const ready = new PromiseCompleter<void>();
		let callCount = 0;
		const handle = runWhenReadyOrAfterTimeout(ready.promise, 5000, () => callCount++);
		defer("Dispose handle", () => handle.dispose());

		ready.resolve();
		await flushMicrotasks();
		assert.equal(callCount, 1);

		clock.tick(5000);
		await flushMicrotasks();
		assert.equal(callCount, 1);
	});

	it("runs once after timeout when ready never settles", async () => {
		const clock = sb.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		defer("Restore fake timers", () => clock.restore());

		const ready = new PromiseCompleter<void>();
		let callCount = 0;
		const handle = runWhenReadyOrAfterTimeout(ready.promise, 5000, () => callCount++);
		defer("Dispose handle", () => handle.dispose());

		clock.tick(4999);
		assert.equal(callCount, 0);

		clock.tick(1);
		assert.equal(callCount, 1);

		ready.resolve();
		await flushMicrotasks();
		assert.equal(callCount, 1);
	});

	it("runs once when ready rejects before timeout", async () => {
		const clock = sb.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		defer("Restore fake timers", () => clock.restore());

		const ready = new PromiseCompleter<void>();
		let callCount = 0;
		const handle = runWhenReadyOrAfterTimeout(ready.promise, 5000, () => callCount++);
		defer("Dispose handle", () => handle.dispose());

		ready.reject(new Error("startup failed"));
		await flushMicrotasks();
		assert.equal(callCount, 1);

		clock.tick(5000);
		await flushMicrotasks();
		assert.equal(callCount, 1);
	});

	it("does not run if disposed before ready settles or timeout elapses", async () => {
		const clock = sb.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		defer("Restore fake timers", () => clock.restore());

		const readyResolve = new PromiseCompleter<void>();
		let callCount = 0;
		const handle1 = runWhenReadyOrAfterTimeout(readyResolve.promise, 5000, () => callCount++);
		defer("Dispose handle1", () => handle1.dispose());

		handle1.dispose();
		clock.tick(5000);
		readyResolve.resolve();
		await flushMicrotasks();
		assert.equal(callCount, 0);

		const readyReject = new PromiseCompleter<void>();
		const handle2 = runWhenReadyOrAfterTimeout(readyReject.promise, 5000, () => callCount++);
		defer("Dispose handle2", () => handle2.dispose());

		handle2.dispose();
		readyReject.reject(new Error("startup failed"));
		clock.tick(5000);
		await flushMicrotasks();
		assert.equal(callCount, 0);
	});

	it("ignores repeated dispose calls and dispose after action ran", async () => {
		const clock = sb.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		defer("Restore fake timers", () => clock.restore());

		const ready = new PromiseCompleter<void>();
		let callCount = 0;
		const handle = runWhenReadyOrAfterTimeout(ready.promise, 5000, () => callCount++);
		defer("Dispose handle", () => handle.dispose());

		ready.resolve();
		await flushMicrotasks();
		assert.equal(callCount, 1);

		handle.dispose();
		handle.dispose();
		clock.tick(5000);
		assert.equal(callCount, 1);
	});
});

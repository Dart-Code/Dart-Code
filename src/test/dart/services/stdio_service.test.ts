import { strict as assert } from "assert";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { SpawnedProcess } from "../../../shared/interfaces";
import { sb } from "../../helpers";
import { FakeProcessStdIOService } from "../../mocks/fake_stdio_service";

function createFakeSpawnedProcess(): SpawnedProcess {
	let killed = false;
	return Object.assign(new EventEmitter(), {
		pid: 9999,
		exitCode: null,
		signalCode: null,
		get killed() { return killed; },
		stdin: new PassThrough(),
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		kill: () => {
			killed = true;
			return true;
		},
	}) as unknown as SpawnedProcess;
}

describe("stdio_service", () => {

	let service: FakeProcessStdIOService<unknown>;
	beforeEach(() => service = new FakeProcessStdIOService<unknown>(true));

	const event1 = { event: "daemon.connected", params: { version: "0.5.3", pid: 4953 } };
	const event2 = { event: "daemon.connected2", params: { version: "0.5.3", pid: 4953 } };

	["\n", "\r\n", "\r"].forEach((terminator) => {
		function sendMessages(...messages: unknown[]) {
			sendRaw(...messages.map((m) => `${JSON.stringify(m)}${terminator}`));
		}

		function sendRaw(...messages: string[]) {
			const packet = messages.join("");
			service.sendStdOut(`${packet}`);
		}

		it(`handles simple JSON notifications terminated with ${JSON.stringify(terminator)}`, () => {
			sendMessages(event1);

			assert.deepStrictEqual(service.notifications, [event1]);
		});

		it(`handles batches of multiple JSON notifications separated with ${JSON.stringify(terminator)}`, () => {
			sendMessages(event1, event2);

			assert.deepStrictEqual(service.notifications, [event1, event2]);
		});

		it(`handles messages split across multiple packets terminated with ${JSON.stringify(terminator)}`, () => {
			const eventJson = JSON.stringify(event1);
			sendRaw(eventJson.substring(0, 5));
			sendRaw(eventJson.substring(5));
			sendRaw(terminator);

			assert.deepStrictEqual(service.notifications, [event1]);
		});

		it(`processes unhandled messages terminated with ${JSON.stringify(terminator)}`, () => {
			sendRaw(`this is a string${terminator}this is a string${terminator}`);

			assert.deepStrictEqual(service.unhandledMessages, [`this is a string\n`, `this is a string\n`]);
		});
	});

	it("rejects active requests and closes stdin when stdin emits EPIPE while running", async () => {
		const proc = createFakeSpawnedProcess();
		service.attachFakeProcess(proc);

		const inFlight = service.callSendRequest("test.inFlight");
		proc.stdin.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));

		await assert.rejects(inFlight, /Process stdin errored: Error: write EPIPE/);
		assert.equal(proc.stdin.writable, false);

		// Subsequent requests see closed stdin immediately.
		await assert.rejects(
			() => service.callSendRequest("test.afterEpipe"),
			/Tried to call "test\.afterEpipe" but process has already exited/,
		);

		assert.doesNotThrow(() => {
			proc.stdout.emit("error", Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }));
			proc.stderr.emit("error", Object.assign(new Error("stream destroyed"), { code: "ERR_STREAM_DESTROYED" }));
		});
	});

	it("rejects active requests when process closes unexpectedly", async () => {
		const proc = createFakeSpawnedProcess();
		service.attachFakeProcess(proc);

		const inFlight = service.callSendRequest("test.inFlight");
		proc.emit("exit", 1, null);
		proc.emit("close", 1, null);

		await assert.rejects(inFlight, /^Error: Process closed unexpectedly \(1, null\)$/);
	});

	it("rejects sendRequest if stdin.write throws synchronously", async () => {
		const proc = createFakeSpawnedProcess();
		sb.stub(proc.stdin, "write").throws(new Error("sync write failure"));
		service.attachFakeProcess(proc);

		await assert.rejects(
			() => service.callSendRequest("test.syncThrow"),
			/sync write failure/,
		);
	});

	it("allows buffered responses to resolve during dispose and cancels remaining requests on close", async () => {
		const proc = createFakeSpawnedProcess();
		const writeSpy = sb.spy(proc.stdin, "write");
		service.attachFakeProcess(proc);

		const bufferedReq = service.callSendRequest<undefined, string>("test.buffered");
		let unrespondedResolved = false;
		let unrespondedRejected = false;
		void service.callSendRequest("test.unresponded").then(
			() => { unrespondedResolved = true; },
			() => { unrespondedRejected = true; },
		);
		assert.equal(writeSpy.callCount, 2);

		await service.dispose();

		// A response already buffered in stdout before "close" still resolves its caller.
		await service.handleMessage(`${JSON.stringify({ id: "1", result: "ok" })}\n`);
		assert.equal(await bufferedReq, "ok");

		// Once stdio closes, any remaining requests are cancelled without rejecting.
		proc.emit("close", 0, "SIGTERM");
		await service.handleMessage(`${JSON.stringify({ id: "2", result: "too-late" })}\n`);
		assert.equal(unrespondedResolved, false);
		assert.equal(unrespondedRejected, false);

		// Post-dispose sendRequest rejects without calling notifyRequestAfterExit or writing to stdin.
		await assert.rejects(
			() => service.callSendRequest("test.afterDispose"),
			/Tried to call "test\.afterDispose" after service was disposed/,
		);
		assert.equal(service.notifyRequestAfterExitCount, 0);

		service.callSendMessage(`{"id":"3"}\r\n`);
		assert.equal(writeSpy.callCount, 2);

		// createProcess after dispose does not spawn a new process.
		service.callCreateProcess("nonexistent-binary");
		assert.equal(service.process, undefined);
	});

	it("guards sendRequest and sendMessage when stdin is ended or destroyed before exit fires", async () => {
		const proc = createFakeSpawnedProcess();
		service.attachFakeProcess(proc);
		proc.stdin.end();
		const writeSpy = sb.spy(proc.stdin, "write");

		await assert.rejects(
			() => service.callSendRequest("test.afterStdinEnded"),
			/Tried to call "test\.afterStdinEnded" but process has already exited/,
		);
		assert.equal(service.notifyRequestAfterExitCount, 1);

		service.callSendMessage(`{"id":"2"}\r\n`);
		assert.equal(writeSpy.notCalled, true);

		const proc2 = createFakeSpawnedProcess();
		const service2 = new FakeProcessStdIOService<unknown>(true);
		service2.attachFakeProcess(proc2);
		proc2.stdin.destroy();
		const writeSpy2 = sb.spy(proc2.stdin, "write");

		await assert.rejects(
			() => service2.callSendRequest("test.afterStdinDestroyed"),
			/Tried to call "test\.afterStdinDestroyed" but process has already exited/,
		);
		assert.equal(service2.notifyRequestAfterExitCount, 1);

		service2.callSendMessage(`{"id":"2"}\r\n`);
		assert.equal(writeSpy2.notCalled, true);
	});
});

import { strict as assert } from "assert";
import * as net from "net";
import * as vs from "vscode";
import * as ws from "ws";
import { ExtensionRestartReason, isWin } from "../../../shared/constants";
import { LogMessage } from "../../../shared/interfaces";
import { DartToolingDaemon } from "../../../shared/services/tooling_daemon";
import { ActiveLocation, ActiveLocationChangedEvent, DtdResult, EventKind, Service, ServiceMethod, Stream } from "../../../shared/services/tooling_daemon_services";
import { PromiseCompleter } from "../../../shared/utils";
import { fsPath } from "../../../shared/utils/fs";
import { waitFor } from "../../../shared/utils/promises";
import { getActiveRealFileEditor } from "../../../shared/vscode/editors";
import { activate, closeAllOpenFiles, defer, delay, flutterHelloWorldMainFile, helloWorldMainFile, openFile, privateApi, sb, setConfigForTest, waitForResult } from "../../helpers";

// These are basic tests for DTD. There are also some tests in `../dart_debug`.
describe("dart tooling daemon", () => {
	beforeEach("activate", () => activate());

	beforeEach("skip if not supported", function () {
		if (!privateApi.dartCapabilities.supportsToolingDaemon)
			this.skip();
	});

	it("should respond with the correct set of IDE workspace roots", async () => {
		const daemon = privateApi.toolingDaemon;
		assert.ok(daemon);

		// Wait for daemon to be up and allow time for the extension to send roots.
		await daemon.connected;
		await delay(50);

		const result = await daemon.callMethod(ServiceMethod.getIDEWorkspaceRoots);
		assert.ok(result.ideWorkspaceRoots.length);
		const roots = vs.workspace.workspaceFolders?.map((wf) => wf.uri.toString()) ?? [];
		assert.deepStrictEqual(result.ideWorkspaceRoots, roots);
	});

	it("should be able to read files inside the workspace root", async function () {
		// https://github.com/Dart-Code/Dart-Code/issues/5210
		if (privateApi.dartCapabilities.version.startsWith("3.5."))
			this.skip();

		const daemon = privateApi.toolingDaemon;
		assert.ok(daemon);

		// Wait for daemon to be up and allow time for the extension to send roots.
		await daemon.connected;
		await delay(50);

		const initialResult = await daemon.callMethod(ServiceMethod.readFileAsString, { uri: helloWorldMainFile.toString() });
		assert.ok(initialResult.content);

		// If we're on Windows, try with different casings because it's easy to have different drive
		// letter casing from different APIs and we don't know the source of all other callers of this
		// API.
		if (isWin) {
			for (const replacer of [
				// Uppercase drive letter
				(_fullMatch, prefix, driveLetter) => `${prefix}${driveLetter.toUpperCase()}:`,
				// Lowercase drive letter
				(_fullMatch, prefix, driveLetter) => `${prefix}${driveLetter.toLowerCase()}:`,
				// Encoded colon
				(_fullMatch, prefix, driveLetter) => `${prefix}${driveLetter}%3a`,
				// Not-encoded colon
				(_fullMatch, prefix, driveLetter) => `${prefix}${driveLetter}:`,
			] as Array<(_fullMatch: string, prefix: string, driveLetter: string, colon: string) => string>) {
				const uri = helloWorldMainFile.toString().replace(/(file:\/\/\/)(\w)(:|%3a|%3A)/, replacer);
				const replacedUriResult = await daemon.callMethod(ServiceMethod.readFileAsString, { uri });
				assert.ok(replacedUriResult.content);
			}
		}
	});

	it("should not be able to read files outside the workspace root", async () => {
		const daemon = privateApi.toolingDaemon;
		assert.ok(daemon);

		// Wait for daemon to be up and allow time for the extension to send roots.
		await daemon.connected;
		await delay(50);

		try {
			const result = await daemon.callMethod(ServiceMethod.readFileAsString, { uri: flutterHelloWorldMainFile.toString() });
			assert.fail(`DTD returned content outside of workspace: (${flutterHelloWorldMainFile.toString()} / ${result.content.length} bytes)`);
		} catch (e) {
			const error = e as { code?: number; message?: string };
			assert.equal(error.code, 142);
			assert.equal(error.message, "Permission denied");
		}
	});

	it("should be able to navigate to code", async () => {
		await closeAllOpenFiles(); // Ensure no false positive.
		const daemon = privateApi.toolingDaemon;
		assert.ok(daemon);
		await daemon.connected;

		const targetLine = 5;
		const targetColumn = 1;
		await daemon.callMethod(ServiceMethod.editorNavigateToCode, {
			column: targetColumn,
			line: targetLine,
			uri: helloWorldMainFile.toString(),
		});

		const editor = getActiveRealFileEditor();
		assert.ok(editor);
		assert.equal(fsPath(editor.document.uri), fsPath(helloWorldMainFile));
		assert.equal(editor.selection.active.line, targetLine - 1);
		assert.equal(editor.selection.active.character, targetColumn - 1);
	});

	it("should return an error for unsupported URI schemes", async () => {
		const daemon = privateApi.toolingDaemon;
		assert.ok(daemon);
		await daemon.connected;

		await assert.rejects(
			daemon.callMethod(ServiceMethod.editorNavigateToCode, { uri: "https://dart.dev" }),
			(e: unknown) => {
				const error = e as { code?: number } | undefined;
				return error?.code === 144;
			},
		);
	});

	it("should expose LSP methods via the analyzer", async function () {
		if (!privateApi.dartCapabilities.supportsLspOverDtd)
			this.skip();

		const daemon = privateApi.toolingDaemon;
		assert.ok(daemon);

		// Wait for daemon to be up.
		await daemon.connected;
		await delay(50);

		// Ensure expected LSP services are registered.
		const knownServices = daemon.registeredServiceMethods;
		assert.ok(knownServices.has("Lsp.experimental/echo"), `Did not find "Lsp.experimental/echo" in ${[...knownServices].join(", ")}`);
	});

	it("should send ActiveLocationChanged events when the selection changes", async () => {
		const dtdDebounceMs = 1;
		await setConfigForTest("dart", "dtdEditorActiveLocationDelay", dtdDebounceMs); // Reduce debounce time for test.

		const daemon = privateApi.toolingDaemon;
		assert.ok(daemon);
		await daemon.connected;
		await daemon.streamListen(Stream.Editor);

		const events: ActiveLocationChangedEvent[] = [];
		const listener = daemon.onNotification(Stream.Editor, EventKind[EventKind.activeLocationChanged], (event: ActiveLocationChangedEvent) => events.push(event));
		try {
			const editor = await openFile(helloWorldMainFile);
			editor.selection = new vs.Selection(new vs.Position(0, 0), new vs.Position(0, 0));
			// Discard any initial events for opening the file and resetting the selection to (0, 0).
			await waitForResult(() => events.at(-1)?.selections[0]?.active.line === 0);
			await delay(50); // Allow for unrelated events.
			events.length = 0;

			editor.selection = new vs.Selection(new vs.Position(1, 0), new vs.Position(2, 0));
			await waitFor(() => events.length >= 1);
			editor.selections = [
				new vs.Selection(new vs.Position(3, 0), new vs.Position(4, 0)),
				new vs.Selection(new vs.Position(5, 0), new vs.Position(6, 0)),
			];

			// Wait for both expected events. Use waitFor and don't throw on failure because the error message
			// from the assert below will be better (we use `waitFor` just to force a delay, but continue when
			// the condition is met).
			await waitFor(() => events.length >= 2);
			assert.deepStrictEqual(
				events.map(simplify),
				[
					{
						filePath: fsPath(helloWorldMainFile),
						selections: [
							{
								active: { line: 2, character: 0 },
								anchor: { line: 1, character: 0 }
							}
						]
					},
					{
						filePath: fsPath(helloWorldMainFile),
						selections: [
							{
								active: { line: 4, character: 0 },
								anchor: { line: 3, character: 0 }
							},
							{
								active: { line: 6, character: 0 },
								anchor: { line: 5, character: 0 }
							}
						]
					},
				],
			);
		} finally {
			listener.dispose();
			await daemon.streamCancel(Stream.Editor);
		}
	});

	it("should return the current active location", async () => {
		const dtdDebounceMs = 1;
		await setConfigForTest("dart", "dtdEditorActiveLocationDelay", dtdDebounceMs); // Reduce debounce time for test.

		const daemon = privateApi.toolingDaemon;
		assert.ok(daemon);
		await daemon.connected;

		const editor = await openFile(helloWorldMainFile);
		await delay(dtdDebounceMs + 50);

		// Ensure there's an initial location for this file after opening.
		let location = await daemon.callMethod(ServiceMethod.editorGetActiveLocation);
		assert.equal(fsPath(vs.Uri.parse(location.textDocument!.uri)), fsPath(helloWorldMainFile));


		// Test a single-position update. Set twice to ensure there's always a change regardless of the
		// original position restored when the file was opened.
		editor.selection = new vs.Selection(new vs.Position(0, 0), new vs.Position(0, 0));
		editor.selection = new vs.Selection(new vs.Position(1, 0), new vs.Position(2, 0));
		await delay(dtdDebounceMs + 50);

		location = await daemon.callMethod(ServiceMethod.editorGetActiveLocation);
		assert.deepStrictEqual(
			simplify(location),
			{
				filePath: fsPath(helloWorldMainFile),
				selections: [
					{
						active: { line: 2, character: 0 },
						anchor: { line: 1, character: 0 }
					}
				]
			},
		);


		// Test a multi-selection.
		editor.selections = [
			new vs.Selection(new vs.Position(3, 0), new vs.Position(4, 0)),
			new vs.Selection(new vs.Position(5, 0), new vs.Position(6, 0)),
		];
		await delay(dtdDebounceMs + 50);
		location = await daemon.callMethod(ServiceMethod.editorGetActiveLocation);
		assert.deepStrictEqual(
			simplify(location),
			{
				filePath: fsPath(helloWorldMainFile),
				selections: [
					{
						active: { line: 4, character: 0 },
						anchor: { line: 3, character: 0 }
					},
					{
						active: { line: 6, character: 0 },
						anchor: { line: 5, character: 0 }
					}
				]
			},
		);
	});

	it("still throws when sending an event while not connected and not shutting down", () => {
		// A daemon whose process cannot start never connects but is also not
		// (yet) shutting down, so a sendEvent here is an unexpected failure that
		// should still be surfaced rather than silently dropped.
		const daemon = new DartToolingDaemon(
			privateApi.logger,
			{ dart: "does-not-exist", dartSdkIsFromFlutter: false, isPreReleaseSdk: false },
			privateApi.dartCapabilities,
			undefined,
			[],
			1000,
			() => ({}),
			async () => { },
		);
		defer("Dispose daemon", () => daemon.dispose());

		assert.throws(() => daemon.sendEvent(Stream.Editor, { kind: EventKind.deviceRemoved, deviceId: "fake" }));
	});

	it("drops and logs events sent while shutting down", () => {
		// Events sent after the daemon starts shutting down (for example from an
		// event handler that was in-flight during dispose) are expected failures
		// and should be logged and dropped rather than thrown.
		const daemon = new DartToolingDaemon(
			privateApi.logger,
			{ dart: "does-not-exist", dartSdkIsFromFlutter: false, isPreReleaseSdk: false },
			privateApi.dartCapabilities,
			undefined,
			[],
			1000,
			() => ({}),
			async () => { },
		);
		defer("Dispose daemon", () => daemon.dispose());
		daemon.dispose();

		const logMessages: string[] = [];
		const logListener = privateApi.logger.onLog((msg: LogMessage) => logMessages.push(msg.message));
		defer("Dispose log listener", () => logListener.dispose());

		daemon.sendEvent(Stream.Editor, { kind: EventKind.deviceRemoved, deviceId: "fake" });
		assert.ok(
			logMessages.some((m) => m.includes("DTD connection is unavailable")),
			"the dropped event was not logged",
		);
	});

	it("does not send pending active-location events after dispose", async function () {
		if (!privateApi.dartCapabilities.supportsLspOverDtd)
			this.skip();

		defer("Reload extension", () => vs.commands.executeCommand("_dart.reloadExtension", ExtensionRestartReason.Test));

		const dtdDebounceMs = 1;
		await setConfigForTest("dart", "dtdEditorActiveLocationDelay", dtdDebounceMs);

		const daemon = privateApi.toolingDaemon!;
		await daemon.connected;

		const sendEvent = sb.spy(daemon, "sendEvent");
		const editor = await openFile(helloWorldMainFile);
		await waitForResult(() => sendEvent.called, "initial active-location event was not sent");
		sendEvent.resetHistory();

		// Disposing inside a selection listener registered after the daemon's
		// own listener guarantees the debounced send is queued (by the daemon's
		// listener, which runs first) but has not yet fired when dispose() runs.
		let markerFired = false;
		const marker = vs.window.onDidChangeTextEditorSelection(() => { markerFired = true; daemon.dispose(); });
		defer("Dispose marker", () => marker.dispose());
		editor.selection = new vs.Selection(new vs.Position(1, 0), new vs.Position(2, 0));
		await waitForResult(() => markerFired, "selection-change event did not fire");

		await delay(dtdDebounceMs + 50);
		assert.ok(
			!sendEvent.getCalls().some((call) => {
				const event = call.args[1] as { kind?: EventKind } | undefined;
				return event?.kind === EventKind.activeLocationChanged;
			}),
			"debounced active-location event was sent after dispose",
		);
	});

	it("does not reject a service response that is in-flight during dispose", async () => {
		const daemon = new DartToolingDaemon(
			privateApi.logger,
			privateApi.workspaceContext.sdks,
			privateApi.dartCapabilities,
			undefined,
			[],
			1000,
			() => ({}),
			async () => { },
		);
		defer("Dispose daemon", () => daemon.dispose());
		await daemon.connected;

		const logMessages: string[] = [];
		const logListener = privateApi.logger.onLog((msg: LogMessage) => logMessages.push(msg.message));
		defer("Dispose log listener", () => logListener.dispose());

		// Register our own service whose handler we can suspend mid-flight. The
		// DTD forwards requests to it back over our own socket because we are the
		// registered provider.
		const handlerGate = new PromiseCompleter<DtdResult & ActiveLocation>();
		let handlerStarted = false;
		await daemon.registerService(Service.Editor, "getActiveLocation", undefined, async () => {
			handlerStarted = true;
			return handlerGate.promise;
		});

		void daemon.callMethod(ServiceMethod.editorGetActiveLocation)
			.catch(() => { /* The response is dropped during shutdown. */ });
		await waitForResult(() => handlerStarted, "service handler did not start");

		// Disposing while the handler is suspended means the response is sent
		// after the connection is gone. Without the shutdown guard in send(),
		// the response send throws and the error-path send throws again, which
		// produced an unhandled rejection.
		daemon.dispose();
		handlerGate.resolve({ selections: [], textDocument: undefined, type: "ActiveLocation" });
		await delay(1);

		assert.ok(
			!logMessages.some((m) => m.includes("Failed handling service request")),
			"the in-flight service response was not dropped cleanly",
		);
	});

	// Creates a locally constructed daemon connected to its own DTD process so
	// tests can exercise disconnect/dispose behaviour without affecting the
	// extension's own daemon (privateApi.toolingDaemon).
	function createDaemon<T extends typeof DartToolingDaemon>(daemonClass?: T): InstanceType<T> {
		const daemon = new (daemonClass ?? DartToolingDaemon)(
			privateApi.logger,
			privateApi.workspaceContext.sdks,
			privateApi.dartCapabilities,
			undefined,
			[],
			1000,
			() => ({}),
			async () => { },
		);
		defer("Dispose daemon", () => daemon.dispose());
		return daemon as InstanceType<T>;
	}

	it("rejects pending requests and swallows fire-and-forget errors when disposed", async () => {
		const daemon = createDaemon(TestDartToolingDaemon);
		await daemon.connected;

		const logMessages: string[] = [];
		const logListener = privateApi.logger.onLog((msg: LogMessage) => logMessages.push(msg.message));
		defer("Dispose log listener", () => logListener.dispose());

		// The request cannot be answered once the daemon is disposed, so the
		// promise should reject rather than remain pending forever.
		const pending = daemon.callMethod(ServiceMethod.getIDEWorkspaceRoots);
		// sendWorkspaceFolders() is called fire-and-forget from real code paths,
		// so its callMethod rejection during dispose should be swallowed rather
		// than rejected or logged.
		const pendingFolders = daemon.sendWorkspaceFoldersForTest([]);
		daemon.dispose();
		await assert.rejects(pending, /DTD connection is unavailable/);
		await pendingFolders;

		await delay(1);
		assert.ok(
			!logMessages.some((m) => m.includes("DTD connection is unavailable")),
			`shutdown rejections produced error logging: ${logMessages.join(" | ")}`,
		);
	});

	it("handles an unexpected socket close", async () => {
		const daemon = createDaemon(TestDartToolingDaemon);
		await daemon.connected;

		const logMessages: string[] = [];
		const logListener = privateApi.logger.onLog((msg: LogMessage) => logMessages.push(msg.message));
		defer("Dispose log listener", () => logListener.dispose());

		// Terminating the real socket in the same tick that sent the requests
		// guarantees they are still pending (no response could have arrived),
		// and fires the real "close" event - the same path as an unexpected
		// network disconnect.
		const pending = daemon.callMethod(ServiceMethod.getIDEWorkspaceRoots);
		const pendingFolders = daemon.sendWorkspaceFoldersForTest([]);
		daemon.terminateSocketForTest();
		await assert.rejects(pending, /DTD connection is unavailable/);
		// Unlike during shutdown, the fire-and-forget rejection caused by an
		// unexpected disconnect should still be surfaced as an error log (but
		// resolved rather than rethrown, because there is nobody to propagate to).
		await pendingFolders;

		await waitForResult(() => !daemon.hasConnection, "connection was not cleared after socket close");
		// With the connection cleared, sends should fail with the expected
		// "unavailable" error rather than a raw WebSocket "not open" error.
		assert.throws(
			() => daemon.sendEvent(Stream.Editor, { kind: EventKind.deviceRemoved, deviceId: "fake" }),
			/DTD connection is unavailable/,
		);
		// And the fire-and-forget send helpers should skip cleanly rather than
		// attempt to send on the dead socket.
		await daemon.sendActiveLocationForTest({ textDocument: undefined, selections: [] });

		assert.ok(
			logMessages.some((m) => m.includes("Failed to call FileSystem.setIDEWorkspaceRoots")),
			`unexpected disconnect was not logged: ${logMessages.join(" | ")}`,
		);
	});

	it("does not send on a socket that is still connecting", async () => {
		// A TCP server that accepts connections but never responds leaves the
		// client WebSocket stuck in CONNECTING state, giving a deterministic
		// window to test sends against a real non-OPEN socket.
		const serverConnections = new Set<net.Socket>();
		const server = net.createServer((conn) => {
			serverConnections.add(conn);
			conn.on("close", () => serverConnections.delete(conn));
		}).listen(0, "127.0.0.1");
		await new Promise<void>((resolve) => server.once("listening", resolve));
		const socket = new ws.WebSocket(`ws://127.0.0.1:${(server.address() as net.AddressInfo).port}`, { followRedirects: false });
		defer("Terminate socket and close server", () => {
			socket.terminate();
			for (const conn of serverConnections)
				conn.destroy();
			return new Promise<void>((resolve) => server.close(() => resolve()));
		});

		// The test injects its own CONNECTING socket, so the daemon doesn't need
		// a real DTD process or connection.
		const daemon = new TestDartToolingDaemon(
			privateApi.logger,
			{ dart: "does-not-exist", dartSdkIsFromFlutter: false, isPreReleaseSdk: false },
			privateApi.dartCapabilities,
			undefined,
			[],
			1000,
			() => ({}),
			async () => { },
		);
		defer("Dispose daemon", () => daemon.dispose());
		daemon.setConnectionForTest(socket);
		assert.equal(socket.readyState, ws.WebSocket.CONNECTING);

		const logMessages: string[] = [];
		const logListener = privateApi.logger.onLog((msg: LogMessage) => logMessages.push(msg.message));
		defer("Dispose log listener", () => logListener.dispose());

		const sendSpy = sb.spy(socket, "send");
		assert.throws(
			() => daemon.sendEvent(Stream.Editor, { kind: EventKind.deviceRemoved, deviceId: "fake" }),
			/DTD connection is unavailable/,
		);
		await assert.rejects(
			daemon.callMethod(ServiceMethod.getIDEWorkspaceRoots),
			/DTD connection is unavailable/,
		);
		// Fire-and-forget helpers must not reject on a non-OPEN socket.
		// Active-location events are skipped, while failed method calls are logged.
		await daemon.sendActiveLocationForTest({ textDocument: undefined, selections: [] });
		await daemon.sendWorkspaceFoldersForTest([]);
		assert.ok(
			!logMessages.some((m) => m.includes("Failed to send active location")),
			`active-location was not silently skipped: ${logMessages.join(" | ")}`,
		);
		assert.ok(
			logMessages.some((m) => m.includes("Failed to call FileSystem.setIDEWorkspaceRoots")),
			`workspace-folders failure was not logged: ${logMessages.join(" | ")}`,
		);
		assert.equal(sendSpy.callCount, 0, "a send reached the non-OPEN socket");
	});

	it("resolves connected when disposed before connecting", async () => {
		// This test disposes before the process even starts, so it doesn't need
		// a real SDK.
		const daemon = new DartToolingDaemon(
			privateApi.logger,
			{ dart: "does-not-exist", dartSdkIsFromFlutter: false, isPreReleaseSdk: false },
			privateApi.dartCapabilities,
			undefined,
			[],
			1000,
			() => ({}),
			async () => { },
		);
		defer("Dispose daemon", () => daemon.dispose());
		daemon.dispose();
		// `connected` must settle even if dispose runs before the socket opened,
		// so continuations don't wait forever.
		assert.equal(await daemon.connected, undefined);
	});
});

function simplify(e: ActiveLocation) {
	return {
		filePath: fsPath(vs.Uri.parse(e.textDocument!.uri)),
		selections: e.selections
	};
}

class TestDartToolingDaemon extends DartToolingDaemon {
	public get hasConnection(): boolean {
		return this.connection !== undefined;
	}

	public terminateSocketForTest(): void {
		this.connection?.socket.terminate();
	}

	public setConnectionForTest(socket: ws.WebSocket): void {
		// Swallow "error" events like the real error handler in connect() would,
		// otherwise closing a CONNECTING socket produces an uncaught error event.
		socket.on("error", () => { });
		this.connection = { socket, dtdUri: "ws://127.0.0.1", dtdSecret: "" };
		// A connection exists, so anything awaiting `connected` should proceed
		// (the real connect() resolves this when the socket opens).
		this.connectedCompleter.resolve(this.connection);
	}

	public sendWorkspaceFoldersForTest(workspaceFolderUris: string[]): Promise<void> {
		return this.sendWorkspaceFolders(workspaceFolderUris);
	}

	public sendActiveLocationForTest(activeLocation: ActiveLocation): Promise<void> {
		return this.sendActiveLocation(activeLocation);
	}
}

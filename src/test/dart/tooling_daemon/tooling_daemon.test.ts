import { strict as assert } from "assert";
import * as vs from "vscode";
import { isWin } from "../../../shared/constants";
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

	beforeEach("skip if not supported", async function () {
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
			// Discard any first events for the above.
			await waitForResult(() => events.length >= 1);
			await delay(50); // Allow for unrelated events.
			events.length = 0;

			editor.selection = new vs.Selection(new vs.Position(1, 0), new vs.Position(2, 0));
			await delay(dtdDebounceMs + 10);
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
		defer("Dispose log listener", () => { logListener.dispose(); });

		daemon.sendEvent(Stream.Editor, { kind: EventKind.deviceRemoved, deviceId: "fake" });
		assert.ok(
			logMessages.some((m) => m.includes("DTD connection is unavailable")),
			"the dropped event was not logged",
		);
	});

	it("does not send pending active-location events after dispose", async () => {
		const daemon = new TestDartToolingDaemon(
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

		const sendEvent = sb.spy(daemon, "sendEvent");

		// sendActiveLocation() awaits `connected` before sending; disposing while
		// that await is suspended exercises the same race as the debounced
		// active-location listener firing during shutdown.
		const pending = daemon.sendActiveLocationForTest({ selections: [], textDocument: undefined });
		daemon.dispose();
		await pending;

		assert.ok(
			!sendEvent.getCalls().some((call) => call.args[1]?.kind === EventKind.activeLocationChanged),
			"active-location event was sent after dispose",
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
		defer("Dispose log listener", () => { logListener.dispose(); });

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
});

function simplify(e: ActiveLocation) {
	return {
		filePath: fsPath(vs.Uri.parse(e.textDocument!.uri)),
		selections: e.selections
	};
}

class TestDartToolingDaemon extends DartToolingDaemon {
	public sendActiveLocationForTest(activeLocation: ActiveLocation): Promise<void> {
		return this.sendActiveLocation(activeLocation);
	}
}

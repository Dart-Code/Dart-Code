import { strict as assert } from "assert";
import * as vs from "vscode";
import { isWin } from "../../../shared/constants";
import { ActiveLocationChangedEvent, EventKind, ServiceMethod, Stream } from "../../../shared/services/tooling_daemon_services";
import { fsPath } from "../../../shared/utils/fs";
import { activate, delay, flutterHelloWorldMainFile, helloWorldMainFile, openFile, privateApi, waitForResult } from "../../helpers";

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

		const result = await daemon.callMethod(ServiceMethod.readFileAsString, { uri: helloWorldMainFile.toString() });
		assert.ok(result.content);

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
				console.log(uri);
				const result = await daemon.callMethod(ServiceMethod.readFileAsString, { uri });
				assert.ok(result.content);
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
			assert.fail(`DTD returned content outside of workspace: (${flutterHelloWorldMainFile} / ${result.content.length} bytes)`);
		} catch (e: any) {
			assert.equal(e.code, 142);
			assert.equal(e.message, "Permission denied");
		}
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
			events.length = 0;

			editor.selection = new vs.Selection(new vs.Position(1, 0), new vs.Position(2, 0));
			await delay(200 + 10); // debounce = 200ms
			editor.selections = [
				new vs.Selection(new vs.Position(3, 0), new vs.Position(4, 0)),
				new vs.Selection(new vs.Position(5, 0), new vs.Position(6, 0)),
			];
			await waitForResult(() => events.length >= 2); // Wait for both expected events.

			assert.deepStrictEqual(
				events.map((e) => ({ filePath: fsPath(vs.Uri.parse(e.textDocument!.uri)), selections: e.selections })),
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
			await listener.dispose();
			await daemon.streamCancel(Stream.Editor);
		}
	});
});

import { strict as assert } from "assert";
import * as path from "path";
import * as vs from "vscode";
import { isWin } from "../../../shared/constants";
import { ServiceMethod } from "../../../shared/services/tooling_daemon_services";
import { waitFor } from "../../../shared/utils/promises";
import { activate, delay, extApi, flutterHelloWorldMainFile, helloWorldMainFile } from "../../helpers";

describe("dart tooling daemon", () => {
	beforeEach("activate", () => activate());

	beforeEach("skip if not supported", async function () {
		if (!extApi.dartCapabilities.supportsToolingDaemon)
			this.skip();
	});

	it("should respond with the correct set of IDE workspace roots", async () => {
		const daemon = extApi.toolingDaemon;
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
		if (extApi.dartCapabilities.version.startsWith("3.5."))
			this.skip();

		const daemon = extApi.toolingDaemon;
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
		const daemon = extApi.toolingDaemon;
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
		// TODO(dantup): Unskip when we have a version number of capability for this functionality
		//  and an LSP method that is certainly registered.
		this.skip();

		const daemon = extApi.toolingDaemon;
		assert.ok(daemon);

		// Wait for daemon to be up.
		await daemon.connected;
		await delay(50);

		// Collect all available services.
		const services: string[] = [];
		const servicesSub = daemon.onServiceRegistered((e) => services.push(`${e.service}.${e.method}`));
		await daemon.streamListen("Service");
		await waitFor(() => services.length); // Wait until we start getting services.
		await delay(100); // And then slightly more.
		await daemon.streamCancel("Service");
		await servicesSub.dispose();

		assert.ok(services.includes("Lsp.textDocument/hover"), `Did not find "Lsp.textDocument/hover" in ${services.join(", ")}`);
	});
});

export function forceWindowsDriveLetterToLowercase<T extends string | undefined>(p: T): string | (undefined extends T ? undefined : never) {
	if (typeof p !== "string")
		return undefined as (undefined extends T ? undefined : never);

	if (p && isWin && path.isAbsolute(p) && p.startsWith(p.charAt(0).toLowerCase()))
		return p.substr(0, 1).toLowerCase() + p.substr(1);

	return p;
}

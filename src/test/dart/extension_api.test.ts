import { strict as assert } from "assert";
import { commands } from "vscode";
import { activateWithoutAnalysis, extApi, waitForResult } from "../helpers";

describe("extension api", () => {
	it("provides the DTD Uri and notifies of changes", async () => {
		await activateWithoutAnalysis();
		await waitForResult(() => !!extApi.dtdUri);

		let didChange = false;
		const sub = extApi.onDtdUriChanged(() => didChange = true);
		await commands.executeCommand("_dart.reloadExtension", "testing");
		await waitForResult(() => didChange);
		sub.dispose();
	});

	it("provides the Dart SDK and notifies of changes", async () => {
		await activateWithoutAnalysis();
		assert.ok(extApi.sdks.dart);

		let didChange = false;
		const sub = extApi.onSdksChanged(() => didChange = true);
		await commands.executeCommand("_dart.reloadExtension", "testing");
		await waitForResult(() => didChange);
		sub.dispose();
	});
});

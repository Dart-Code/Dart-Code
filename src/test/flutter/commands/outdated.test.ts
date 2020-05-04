import * as assert from "assert";
import * as vs from "vscode";
import { activate, captureOutput, extApi, getPackages } from "../../helpers";

describe("flutter packages outdated", () => {

	before("get packages", () => getPackages());
	beforeEach("activate", () => activate());

	beforeEach("skip if not supported", function () {
		if (!extApi.dartCapabilities.supportsPubOutdated)
			this.skip();
	});

	it("runs and prints output", async () => {
		const buffer = captureOutput("flutter");
		const exitCode = await vs.commands.executeCommand("flutter.packages.outdated");
		assert.equal(exitCode, 0);

		const output = buffer.buffer.join("").trim();
		assert.equal(output.startsWith(`[flutter_hello_world] flutter --suppress-analytics pub outdated`), true);
		assert.equal(output.endsWith("exit code 0"), true);
	});
});

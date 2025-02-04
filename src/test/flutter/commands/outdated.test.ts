import { strict as assert } from "assert";
import * as vs from "vscode";
import { activate, captureOutput, getPackages } from "../../helpers";

describe("flutter packages outdated", () => {

	before("get packages", () => getPackages());
	beforeEach("activate", () => activate());

	it("runs and prints output", async () => {
		const buffer = captureOutput("flutter (flutter_hello_world)");
		const exitCode = await vs.commands.executeCommand("flutter.packages.outdated");
		assert.equal(exitCode, 0);

		const output = buffer.join("").trim();
		assert.equal(output.startsWith(`--\n\n[flutter_hello_world] flutter --suppress-analytics pub outdated`), true);
		assert.equal(output.endsWith("exit code 0"), true);
	});
});

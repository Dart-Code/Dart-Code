import * as assert from "assert";
import * as vs from "vscode";
import { pubExecutableName } from "../../../shared/constants";
import { activate, captureOutput, extApi, getPackages } from "../../helpers";

describe("pub outdated", () => {
	before("get packages", () => getPackages());
	beforeEach("activate", () => activate());

	beforeEach("skip if not supported", function () {
		if (!extApi.dartCapabilities.supportsPubOutdated)
			this.skip();
	});

	it("runs and prints output", async () => {
		const buffer = captureOutput("pub");
		const exitCode = await vs.commands.executeCommand("pub.outdated");
		assert.equal(exitCode, 0);

		const output = buffer.buffer.join("").trim();
		assert.equal(output.startsWith(`[hello_world] ${pubExecutableName} outdated`), true);
		assert.equal(output.endsWith("exit code 0"), true);
	});
});

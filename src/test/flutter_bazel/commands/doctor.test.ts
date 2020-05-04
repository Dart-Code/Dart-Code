import * as assert from "assert";
import * as vs from "vscode";
import { isWin } from "../../../shared/constants";
import { activate, captureOutput, ensureHasRunRecently, prepareHasRunFile } from "../../helpers";

describe("flutter doctor", () => {
	beforeEach(function () {
		if (isWin)
			this.skip();
	});

	beforeEach("activate", () => activate());

	it("runs and prints output using script", async () => {
		const hasRunFile = prepareHasRunFile("doctor");

		const buffer = captureOutput("custom_doctor");
		const exitCode = await vs.commands.executeCommand("flutter.doctor");
		assert.equal(exitCode, 0);

		const output = buffer.buffer.join("").trim();
		assert.equal(output.startsWith("[flutter] custom_doctor --suppress-analytics -v"), true);
		assert.notEqual(output.indexOf("[✓] Flutter (Channel"), -1);
		assert.equal(output.endsWith("exit code 0"), true);

		ensureHasRunRecently(hasRunFile);
	});
});

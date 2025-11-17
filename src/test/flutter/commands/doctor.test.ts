import { strict as assert } from "assert";
import * as vs from "vscode";
import { RunProcessResult } from "../../../shared/processes";
import { activate, captureOutput } from "../../helpers";

describe("flutter doctor", () => {

	beforeEach("activate", () => activate());

	it("runs and prints output", async () => {
		const buffer = captureOutput("flutter");
		const result: RunProcessResult = await vs.commands.executeCommand("flutter.doctor");
		assert.equal(result.exitCode, 0);

		const output = buffer.join("").trim();
		assert.equal(output.startsWith(`--\n\n[flutter] flutter --suppress-analytics doctor -v`), true);
		assert.notEqual(output.indexOf("] Flutter (Channel"), -1);
		assert.equal(output.endsWith("exit code 0"), true);
	});
});

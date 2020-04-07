import * as assert from "assert";
import * as vs from "vscode";
import { activate, captureOutput } from "../../helpers";

describe("flutter doctor", () => {

	beforeEach("activate", () => activate());

	it("runs and prints output", async () => {
		const buffer = captureOutput("custom_doctor.sh");
		const exitCode = await vs.commands.executeCommand("flutter.doctor");
		assert.equal(exitCode, 0);

		const output = buffer.buffer.join("").trim();
		assert.equal(output.startsWith("[flutter] custom_doctor.sh --suppress-analytics -v"), true);
		assert.notEqual(output.indexOf("Running custom doctor script"), -1);
		assert.notEqual(output.indexOf("[✓] Flutter (Channel"), -1);
		assert.equal(output.endsWith("exit code 0"), true);
	});
});

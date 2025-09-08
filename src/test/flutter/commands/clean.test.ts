import { strict as assert } from "assert";
import * as vs from "vscode";
import { activate, captureOutput, getPackages } from "../../helpers";

describe("flutter clean", () => {
	before("activate", () => activate());
	before("get packages", () => getPackages());
	beforeEach("activate", () => activate());

	describe("all", () => {
		it("cleans all packages", async () => {
			const rootBuffer = captureOutput("flutter (flutter_hello_world)");
			const exampleBuffer = captureOutput("flutter (example)");

			await vs.commands.executeCommand("flutter.clean.all");

			const rootOutput = rootBuffer.join("").trim();
			assert.equal(rootOutput.startsWith(`--\n\n[flutter_hello_world] flutter --suppress-analytics clean`), true);
			assert.equal(rootOutput.endsWith("exit code 0"), true);

			const exampleOutput = exampleBuffer.join("").trim();
			assert.equal(exampleOutput.startsWith(`--\n\n[example] flutter --suppress-analytics clean`), true);
			assert.equal(exampleOutput.endsWith("exit code 0"), true);
		});
	});
});

import * as vs from "vscode";
import { activate, captureOutput, waitForResult } from "../helpers";

describe("flutter daemon", () => {
	beforeEach("activate", () => activate());

	it("runs using custom script", async () => {
		// Set up buffering channel mock.
		const buffer = captureOutput("flutter daemon");

		// Restart the extension so the daemon picks up our buffered channel.
		await vs.commands.executeCommand("_dart.reloadExtension");

		await waitForResult(() => {
			const output = buffer.buffer.join("").trim();
			return output.indexOf("You are using the custom daemon") !== -1;
		});
	});
});

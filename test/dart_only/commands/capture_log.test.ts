import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as sinon from "sinon";
import * as vs from "vscode";
import { STOP_LOGGING } from "../../../src/commands/logging";
import { PromiseCompleter } from "../../../src/debug/utils";
import { fsPath } from "../../../src/utils";
import { log } from "../../../src/utils/log";
import { activate, defer, getRandomTempFolder, sb, waitFor } from "../../helpers";

describe("capture logs command", () => {
	beforeEach(() => activate());

	it("writes to the correct file", async () => {
		const tempLogFile = path.join(getRandomTempFolder(), "test_log.txt");
		defer(() => {
			if (fs.existsSync(tempLogFile))
				fs.unlinkSync(tempLogFile);
		});

		// When prompted for a log file, provide this temp filename.
		const showSaveDialog = sb.stub(vs.window, "showSaveDialog");
		showSaveDialog.resolves(vs.Uri.file(tempLogFile));

		// Use a completer so the test can signal when to end logging (normally a user
		// would click the Stop Logging button on the notification).
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const stopLogging = new PromiseCompleter();
		showInformationMessage.withArgs(sinon.match.any, STOP_LOGGING).resolves(stopLogging.promise);

		// Start the logging but don't await it (it doesn't complete until we stop the logging!).
		const loggingCommand = vs.commands.executeCommand("dart.startLogging");

		// Wait until the command has called for the filename (otherwise we'll send our log before
		// the logger is set up because the above call is async).
		await waitFor(() => showSaveDialog.called);

		log("This is a test");

		// Resolving the promise will stop the logging.
		stopLogging.resolve(STOP_LOGGING);

		// Wait for the logging command to finish.
		await loggingCommand;

		assert.ok(fs.existsSync(tempLogFile));
		const lines = fs.readFileSync(tempLogFile).toString().trim().split("\n");
		const firstLine = lines[0].trim();
		const lastLine = lines[lines.length - 1].trim();
		assert.ok(firstLine.endsWith("Log file started"), `First line of log was ${firstLine}`);
		assert.ok(lines.find((l) => l.indexOf("This is a test") !== -1), "Did not find logged message");
		assert.ok(lastLine.endsWith("Log file ended"), `Last line of log was ${lastLine}`);

		// Ensure the log file was opened.
		assert.equal(fsPath(vs.window.activeTextEditor.document.uri), tempLogFile);
	});

	it("does not start logging if cancelled", async () => {
		const tempLogFile = path.join(getRandomTempFolder(), "test_log.txt");
		defer(() => {
			if (fs.existsSync(tempLogFile))
				fs.unlinkSync(tempLogFile);
		});

		// When prompted for a log file, provide this temp filename.
		const showSaveDialog = sb.stub(vs.window, "showSaveDialog");
		showSaveDialog.resolves(undefined);

		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");

		// Start the logging but don't await it (it doesn't complete until we stop the logging!).
		const loggingCommand = vs.commands.executeCommand("dart.startLogging");

		// Wait until the command has called for the filename (otherwise we'll send our log before
		// the logger is set up because the above call is async).
		await waitFor(() => showSaveDialog.called);

		// Wait for the logging command to finish (which it should automatically because we aborted).
		await loggingCommand;

		assert.ok(!fs.existsSync(tempLogFile));
	});

	it("only logs the specified categories");
	it("always logs general logs");
});

import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as sinon from "sinon";
import * as vs from "vscode";
import { STOP_LOGGING } from "../../../src/commands/logging";
import { LogCategory, LogSeverity, PromiseCompleter } from "../../../src/debug/utils";
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

		// When prompted for categories, pick just Analyzer.
		const showQuickPick = sb.stub(vs.window, "showQuickPick");
		showQuickPick.resolves([{ logCategory: LogCategory.Analyzer }]);

		// Use a completer so the test can signal when to end logging (normally a user
		// would click the Stop Logging button on the notification).
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const stopLogging = new PromiseCompleter();
		showInformationMessage.withArgs(sinon.match.any, STOP_LOGGING).resolves(stopLogging.promise);

		// Start the logging but don't await it (it doesn't complete until we stop the logging!).
		const loggingCommand = vs.commands.executeCommand("dart.startLogging");

		// Wait until the command has called for the filename and options (otherwise we'll send our log before
		// the logger is set up because the above call is async).
		await waitFor(() => showQuickPick.called);

		log("This is a test"); // Should be logged
		log("This is an analyzer event", LogSeverity.Info, LogCategory.Analyzer); // Should be logged
		log("This is an flutter daemon event", LogSeverity.Info, LogCategory.FlutterDaemon); // Should not be logged
		log("This is an flutter daemon ERROR event", LogSeverity.Error, LogCategory.FlutterDaemon); // Should be logged because it's an error.

		// Resolving the promise will stop the logging.
		stopLogging.resolve(STOP_LOGGING);

		// Wait for the logging command to finish.
		await loggingCommand;

		assert.ok(fs.existsSync(tempLogFile));
		const lines = fs.readFileSync(tempLogFile).toString().trim().split("\n").map((l) => l.trim());
		const lastLine = lines[lines.length - 1];
		assert.ok(lines.find((l) => l.endsWith("Log file started")), "Did not find logged message");
		assert.ok(lines.find((l) => l.indexOf("This is a test") !== -1), "Did not find logged message");
		assert.ok(lines.find((l) => l.indexOf("This is an analyzer event") !== -1), "Did not find logged analyzer message");
		assert.ok(lines.find((l) => l.indexOf("This is an flutter daemon event") === -1), "Found logged flutter daemon message");
		assert.ok(lines.find((l) => l.indexOf("This is an flutter daemon ERROR event") !== -1), "Did not find logged flutter daemon ERROR message");
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

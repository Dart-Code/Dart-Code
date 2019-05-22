import * as assert from "assert";
import * as fs from "fs";
import * as sinon from "sinon";
import * as vs from "vscode";
import { log } from "../../../extension/utils/log";
import { platformEol, stopLoggingAction } from "../../../shared/constants";
import { LogCategory, LogSeverity } from "../../../shared/enums";
import { PromiseCompleter } from "../../../shared/utils";
import { fsPath } from "../../../shared/vscode/utils";
import { activate, sb, waitForResult } from "../../helpers";

describe("capture logs command", () => {
	beforeEach("activate", () => activate());

	async function configureLog(...logCategories: LogCategory[]) {
		// When prompted for categories, pick just Analyzer.
		const showQuickPick = sb.stub(vs.window, "showQuickPick");
		if (logCategories)
			showQuickPick.resolves(logCategories.map((c) => ({ logCategory: c })));
		else
			showQuickPick.resolves(undefined);
		// Use a completer so the test can signal when to end logging (normally a user
		// would click the Stop Logging button on the notification).
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const stopLogging = new PromiseCompleter();
		showInformationMessage.withArgs(sinon.match.any, stopLoggingAction).resolves(stopLogging.promise);
		// Start the logging but don't await it (it doesn't complete until we stop the logging!).
		const loggingCommand = vs.commands.executeCommand("dart.startLogging") as Thenable<string>;
		// Wait until the command has called for the filename and options (otherwise we'll send our log before
		// the logger is set up because the above call is async).
		await waitForResult(() => showQuickPick.called);

		return {
			loggingCommand,
			stopLogging: async () => {
				// Resolving the promise will stop the logging.
				stopLogging.resolve(stopLoggingAction);
				// Wait for the logging command to finish.
				return loggingCommand;
			},
		};
	}

	it("writes to the correct file", async () => {
		const logger = await configureLog(LogCategory.Analyzer);

		log("This is a test"); // Should be logged
		log("This is an analyzer event", LogSeverity.Info, LogCategory.Analyzer); // Should be logged
		log("This is an flutter daemon event", LogSeverity.Info, LogCategory.FlutterDaemon); // Should not be logged
		log("This is an flutter daemon ERROR event", LogSeverity.Error, LogCategory.FlutterDaemon); // Should be logged because it's an error.

		const logFilename = await logger.stopLogging();

		assert.ok(fs.existsSync(logFilename));
		const lines = fs.readFileSync(logFilename).toString().trim().split("\n").map((l) => l.trim());
		const lastLine = lines[lines.length - 1];
		assert.ok(lines.find((l) => l.endsWith("Log file started")), `Did not find 'Log file started' in ${platformEol}${lines.join(platformEol)}`);
		assert.ok(lines.find((l) => l.indexOf("This is a test") !== -1), `Did not find 'This is a test' in ${platformEol}${lines.join(platformEol)}`);
		assert.ok(lastLine.endsWith("Log file ended"), `Last line of log was '${lastLine}' instead of 'Log file ended'`);

		// Ensure the log file was opened.
		assert.equal(fsPath(vs.window.activeTextEditor!.document.uri), logFilename);
	});

	it("does not start logging if cancelled", async () => {
		const logger = await configureLog();

		// Wait for the logging command to finish (which it should automatically because we aborted).
		const logFilename = await logger.loggingCommand;

		assert.ok(!logFilename);
	});

	it("only logs the specified categories", async () => {
		const logger = await configureLog(LogCategory.Analyzer);

		log("This is a test"); // Should be logged
		log("This is an analyzer event", LogSeverity.Info, LogCategory.Analyzer); // Should be logged
		log("This is an flutter daemon event", LogSeverity.Info, LogCategory.FlutterDaemon); // Should not be logged

		const logFilename = await logger.stopLogging();

		assert.ok(fs.existsSync(logFilename));
		const lines = fs.readFileSync(logFilename).toString().trim().split("\n").map((l) => l.trim());
		assert.ok(lines.find((l) => l.indexOf("This is a test") !== -1), `Did not find 'This is a test' in ${platformEol}${lines.join(platformEol)}`);
		assert.ok(lines.find((l) => l.indexOf("This is an analyzer event") !== -1), `Did not find 'This is an analyzer event' in ${platformEol}${lines.join(platformEol)}`);
	});

	it("always logs WARN and ERROR log to General", async () => {
		const logger = await configureLog(LogCategory.General);

		log("This is a test"); // Should be logged
		log("This is an flutter daemon event", LogSeverity.Info, LogCategory.FlutterDaemon); // Should not be logged
		log("This is an flutter daemon ERROR event", LogSeverity.Error, LogCategory.FlutterDaemon); // Should be logged because it's an error.

		const logFilename = await logger.stopLogging();

		assert.ok(fs.existsSync(logFilename));
		const lines = fs.readFileSync(logFilename).toString().trim().split("\n").map((l) => l.trim());
		assert.ok(lines.find((l) => l.indexOf("This is a test") !== -1), `Did not find 'This is a test' in ${platformEol}${lines.join(platformEol)}`);
		assert.ok(lines.find((l) => l.indexOf("This is an flutter daemon event") === -1), "Unexpectedly found 'This is an flutter daemon event' in the log");
		assert.ok(lines.find((l) => l.indexOf("This is an flutter daemon ERROR event") !== -1), `Did not find 'This is an flutter daemon ERROR event' in ${platformEol}${lines.join(platformEol)}`);
	});
});

import { strict as assert } from "assert";
import * as fs from "fs";
import * as vs from "vscode";
import { platformEol } from "../../../shared/constants";
import { LogCategory } from "../../../shared/enums";
import { fsPath } from "../../../shared/utils/fs";
import { activate, logger, sb, waitForResult } from "../../helpers";

describe("capture logs command", () => {
	beforeEach("activate", () => activate());

	async function configureLog(...logCategories: LogCategory[]) {
		// When prompted for categories, pick just Analyzer.
		const showQuickPick = sb.stub(vs.window, "showQuickPick");
		if (logCategories?.length)
			showQuickPick.resolves(logCategories.map((c) => ({ logCategory: c })));
		else
			showQuickPick.resolves(undefined);

		// Start the logging but don't await it (it doesn't complete until we stop the logging!).
		const loggingCommand = vs.commands.executeCommand<string | undefined>("dart.startLogging");

		// Wait until the command has called for the filename and options (otherwise we'll send our log before
		// the logger is set up because the above call is async).
		await waitForResult(() => showQuickPick.called);

		return {
			loggingCommand,
			stopLogging: async () => {
				await vs.commands.executeCommand("dart.stopLogging");
				// Wait for the logging command to finish.
				return (await loggingCommand)!;
			},
		};
	}

	async function logWithCommand(command: string) {
		// Start the logging but don't await it (it doesn't complete until we stop the logging!).
		const loggingCommand = vs.commands.executeCommand<string>(command);

		return {
			loggingCommand,
			stopLogging: async () => {
				await vs.commands.executeCommand("dart.stopLogging");
				// Wait for the logging command to finish.
				return loggingCommand;
			},
		};
	}

	it("writes to the correct file", async () => {
		const log = await configureLog(LogCategory.Analyzer);

		logger.info("This is a test"); // Should be logged
		logger.info("This is an analyzer event", LogCategory.Analyzer); // Should be logged
		logger.info("This is an flutter daemon event", LogCategory.FlutterDaemon); // Should not be logged
		logger.info("This is an flutter daemon ERROR event", LogCategory.FlutterDaemon); // Should be logged because it's an error.

		const logFilename = await log.stopLogging();

		assert.ok(fs.existsSync(logFilename));
		const lines = fs.readFileSync(logFilename).toString().trim().split("\n").map((l) => l.trim());
		const lastLine = lines[lines.length - 1];
		assert.ok(lines.find((l) => l.endsWith("Log file started")), `Did not find 'Log file started' in ${platformEol}${lines.join(platformEol)}`);
		assert.ok(lines.find((l) => l.includes("This is a test")), `Did not find 'This is a test' in ${platformEol}${lines.join(platformEol)}`);
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
		const log = await configureLog(LogCategory.Analyzer);

		logger.info("This is a test"); // Should be logged
		logger.info("This is an analyzer event", LogCategory.Analyzer); // Should be logged
		logger.info("This is a flutter daemon event", LogCategory.FlutterDaemon); // Should not be logged

		const logFilename = await log.stopLogging();

		assert.ok(fs.existsSync(logFilename));
		const lines = fs.readFileSync(logFilename).toString().trim().split("\n").map((l) => l.trim());
		assert.ok(lines.find((l) => l.includes("This is a test")), `Did not find 'This is a test' in ${platformEol}${lines.join(platformEol)}`);
		assert.ok(lines.find((l) => l.includes("This is an analyzer event")), `Did not find 'This is an analyzer event' in ${platformEol}${lines.join(platformEol)}`);
		assert.ok(lines.find((l) => !l.includes("This is a flutter daemon event")), `Found 'This is a flutter daemon event' in ${platformEol}${lines.join(platformEol)}`);
	});

	it("only logs analyzer when using Analyzer logging", async () => {
		const log = await logWithCommand("dart.startLoggingAnalysisServer");

		logger.info("This is a test"); // Should be logged
		logger.info("This is an analyzer event", LogCategory.Analyzer); // Should be logged
		logger.info("This is a flutter daemon event", LogCategory.FlutterDaemon); // Should not be logged

		const logFilename = await log.stopLogging();

		assert.ok(fs.existsSync(logFilename));
		const lines = fs.readFileSync(logFilename).toString().trim().split("\n").map((l) => l.trim());
		assert.ok(lines.find((l) => l.includes("This is a test")), `Did not find 'This is a test' in ${platformEol}${lines.join(platformEol)}`);
		assert.ok(lines.find((l) => l.includes("This is an analyzer event")), `Did not find 'This is an analyzer event' in ${platformEol}${lines.join(platformEol)}`);
		assert.ok(lines.find((l) => !l.includes("This is a flutter daemon event")), `Found 'This is a flutter daemon event' in ${platformEol}${lines.join(platformEol)}`);
	});

	it("only logs debugging when using Debugging logging", async () => {
		const log = await logWithCommand("dart.startLoggingDebugging");

		logger.info("This is a test"); // Should be logged
		logger.info("This is a vm service event", LogCategory.VmService); // Should be logged
		logger.info("This is a dap event", LogCategory.DAP); // Should be logged
		logger.info("This is an analyzer event", LogCategory.Analyzer); // Should not be logged

		const logFilename = await log.stopLogging();

		assert.ok(fs.existsSync(logFilename));
		const lines = fs.readFileSync(logFilename).toString().trim().split("\n").map((l) => l.trim());
		assert.ok(lines.find((l) => l.includes("This is a test")), `Did not find 'This is a test' in ${platformEol}${lines.join(platformEol)}`);
		assert.ok(lines.find((l) => l.includes("This is a vm service event")), `Did not find 'This is a vm service event' in ${platformEol}${lines.join(platformEol)}`);
		assert.ok(lines.find((l) => l.includes("This is a dap event")), `Did not find 'This is a dap event' in ${platformEol}${lines.join(platformEol)}`);
		assert.ok(lines.find((l) => !l.includes("This is an analyzer event")), `Found 'This is an analyzer event' in ${platformEol}${lines.join(platformEol)}`);
	});

	it("only logs extension when using ExtensionOnly logging", async () => {
		const log = await logWithCommand("dart.startLoggingExtensionOnly");

		logger.info("This is a test"); // Should be logged
		logger.info("This is a devtools event", LogCategory.DevTools); // Should be logged
		logger.info("This is an analyzer event", LogCategory.Analyzer); // Should not be logged

		const logFilename = await log.stopLogging();

		assert.ok(fs.existsSync(logFilename));
		const lines = fs.readFileSync(logFilename).toString().trim().split("\n").map((l) => l.trim());
		assert.ok(lines.find((l) => l.includes("This is a test")), `Did not find 'This is a test' in ${platformEol}${lines.join(platformEol)}`);
		assert.ok(lines.find((l) => l.includes("This is a devtools event")), `Did not find 'This is a devtools event' in ${platformEol}${lines.join(platformEol)}`);
		assert.ok(lines.find((l) => !l.includes("This is an analyzer event")), `Found 'This is an analyzer event' in ${platformEol}${lines.join(platformEol)}`);
	});

	it("always logs WARN and ERROR log to General", async () => {
		const log = await configureLog(LogCategory.General);

		logger.info("This is a test"); // Should be logged
		logger.info("This is a flutter daemon event", LogCategory.FlutterDaemon); // Should not be logged
		logger.error("This is a flutter daemon ERROR event", LogCategory.FlutterDaemon); // Should be logged because it's an error.

		const logFilename = await log.stopLogging();

		assert.ok(fs.existsSync(logFilename));
		const lines = fs.readFileSync(logFilename).toString().trim().split("\n").map((l) => l.trim());
		assert.ok(lines.find((l) => l.includes("This is a test")), `Did not find 'This is a test' in ${platformEol}${lines.join(platformEol)}`);
		assert.ok(lines.find((l) => !l.includes("This is a flutter daemon event")), "Unexpectedly found 'This is a flutter daemon event' in the log");
		assert.ok(lines.find((l) => l.includes("This is a flutter daemon ERROR event")), `Did not find 'This is a flutter daemon ERROR event' in ${platformEol}${lines.join(platformEol)}`);
	});
});

import { Event, OutputEvent } from "@vscode/debugadapter";
import { DebugProtocol } from "@vscode/debugprotocol";
import * as path from "path";
import { dartVMPath, debugTerminatingProgressId, pubSnapshotPath, vmServiceHttpLinkPattern } from "../shared/constants";
import { DartLaunchArgs } from "../shared/debug/interfaces";
import { LogCategory } from "../shared/enums";
import { Logger, SpawnedProcess } from "../shared/interfaces";
import { ErrorNotification, GroupNotification, PrintNotification, SuiteNotification, Test, TestDoneNotification, TestStartNotification } from "../shared/test_protocol";
import { usingCustomScript } from "../shared/utils";
import { DartDebugSession } from "./dart_debug_impl";
import { DebugAdapterLogger } from "./logging";
import { TestRunner } from "./test_runner";

const tick = "✓";
const cross = "✖";

export class DartTestDebugSession extends DartDebugSession {
	private expectSingleTest: boolean | undefined = false;

	constructor() {
		super();

		this.sendStdOutToConsole = false;
		this.allowWriteServiceInfo = false;
		this.requiresProgram = false;
	}

	protected async launchRequest(response: DebugProtocol.LaunchResponse, args: DartLaunchArgs): Promise<void> {
		this.expectSingleTest = args.expectSingleTest;
		return super.launchRequest(response, args);
	}

	protected async spawnProcess(args: DartLaunchArgs): Promise<SpawnedProcess> {
		let allArgs: string[] = [];

		if (args.vmAdditionalArgs)
			allArgs = allArgs.concat(args.vmAdditionalArgs);

		// To use the test framework in the supported debugging way we should
		// send this flag; which will pause the tests at each suite start (this is
		// deifferent to the isolates being paused). To do that, we need to change
		// how our "unpause" logic works in the base debug adapter (since it won't
		// be paused at startup).
		// if (this.shouldConnectDebugger) {
		// 	appArgs.push("--pause-after-load");
		// }

		// Instead, we do it the VM way for now...
		if (this.shouldConnectDebugger) {
			this.expectAdditionalPidToTerminate = true;
			allArgs.push("--enable-vm-service=0");
			allArgs.push("--pause_isolates_on_start=true");
		}

		if (this.dartCapabilities.supportsDartRunTest) {
			// Use "dart --vm-args run test:test"
			allArgs.push("run");
			if (this.dartCapabilities.supportsNoServeDevTools)
				allArgs.push("--no-serve-devtools");
			allArgs.push("test:test");
		} else {
			// Use "dart --vm-args [pub-snapshot] run test"
			allArgs.push(path.join(args.dartSdkPath, pubSnapshotPath));
			allArgs = allArgs.concat(["run", "test"]);
		}

		allArgs.push("-r");
		allArgs.push("json");
		allArgs.push("-j1"); // Only run single-threaded in the runner.

		// Replace in any custom tool.
		const customTool = {
			replacesArgs: args.customToolReplacesArgs,
			script: args.customTool,
		};
		const execution = usingCustomScript(
			path.join(args.dartSdkPath, dartVMPath),
			allArgs,
			customTool,
		);
		allArgs = execution.args;

		if (args.toolArgs)
			allArgs = allArgs.concat(args.toolArgs);

		if (args.program)
			allArgs.push(this.sourceFileForArgs(args));

		if (args.args)
			allArgs = allArgs.concat(args.args);

		const logger = new DebugAdapterLogger(this, LogCategory.DartTest);
		return this.createRunner(execution.executable, args.cwd, allArgs, args.env, args.dartTestLogFile, logger, args.maxLogLineLength);
	}

	protected createRunner(executable: string, projectFolder: string | undefined, args: string[], envOverrides: { [key: string]: string | undefined } | undefined, logFile: string | undefined, logger: Logger, maxLogLineLength: number) {
		const runner = new TestRunner(executable, projectFolder, args, { envOverrides, toolEnv: this.toolEnv }, logFile, logger, maxLogLineLength);

		// Set up subscriptions.
		// this.flutter.registerForUnhandledMessages((msg) => this.log(msg));
		runner.registerForUnhandledMessages((msg) => {
			// Hack: Would be better to have an event for this.
			// https://github.com/dart-lang/test/issues/1216
			if (msg.toLowerCase().includes("waiting for current test(s) to finish"))
				this.updateProgress(debugTerminatingProgressId, `${msg.trim()}`);
			this.logToUserIfAppropriate(msg, "stdout");
		});
		runner.registerForTestStartedProcess((n) => {
			// flutter test may send this without a Uri in non-debug mode
			// https://github.com/flutter/flutter/issues/76533
			// also exclude the string "null" since that's never valid and
			// was emitted for a short period (it will never make stable, but
			// is currently being produced on the bots running against Flutter
			// master).
			if (n.observatoryUri && n.observatoryUri !== "null")
				void this.initDebugger(`${n.observatoryUri}ws`);
		});
		runner.registerForAllTestNotifications(async (n) => {
			try {
				await this.handleTestEvent(n);
			} catch (e: any) {
				this.log(`${e}`);
				this.logToUser(`${e}\n`);
			}
			try {
				this.sendTestEventToEditor(n);
			} catch (e: any) {
				this.log(`${e}`);
				this.logToUser(`${e}\n`);
			}
		});

		return runner.process!;
	}

	protected logToUserIfAppropriate(message: string, category?: string) {
		// Filter out these messages taht come to stdout that we don't want to send to the user.
		if (message && message.startsWith("Observatory listening on"))
			return;
		if (message && message.startsWith("The Dart VM service is listening on"))
			return;
		if (message && message.startsWith("Press Control-C again"))
			return;

		this.logToUser(message, category);
	}

	private readonly suitePaths: string[] = [];
	private readonly tests: Test[] = [];
	private testCounts: { [key: string]: number } = {};
	protected async handleTestEvent(notification: any) {
		// Handle basic output
		switch (notification.type) {
			case "start":
				const pid = notification.pid as number | undefined;
				if (pid) {
					this.recordAdditionalPid(pid);
				}
				break;
			case "debug":
				const observatoryUri = notification.observatory as string | undefined;
				if (observatoryUri) {
					const match = vmServiceHttpLinkPattern.exec(observatoryUri);
					if (match) {
						await this.initDebugger(this.convertObservatoryUriToVmServiceUri(match[1]));
					}
				}
				break;
			case "suite":
				const suite = notification as SuiteNotification;
				// HACK: If we got a relative path, fix it up.
				if (!path.isAbsolute(suite.suite.path) && this.cwd)
					suite.suite.path = path.join(this.cwd, suite.suite.path);
				this.suitePaths[suite.suite.id] = suite.suite.path;
				break;
			case "testStart":
				const testStart = notification as TestStartNotification;
				this.tests[testStart.test.id] = testStart.test;
				break;
			case "testDone":
				const testDone = notification as TestDoneNotification;
				if (testDone.hidden)
					return;
				const name = this.tests[testDone.testID].name ?? "";
				const pass = testDone.result === "success";
				const symbol = pass ? tick : cross;
				this.testCounts[name] = (this.testCounts[name] ?? 0) + 1;
				this.sendEvent(new OutputEvent(`${symbol} ${name}\n`, "stdout"));
				break;
			case "print":
				const print = notification as PrintNotification;
				this.sendEvent(new OutputEvent(`${print.message}\n`, "stdout"));
				break;
			case "error":
				const error = notification as ErrorNotification;
				this.logToUser(`${error.error}\n`, "stderr");
				this.logToUser(`${error.stackTrace}\n`, "stderr");
				break;
			case "done":
				if (this.expectSingleTest) {
					const testNames = Object.keys(this.testCounts);
					const firstTestWithMultipleRuns = testNames.find((name) => this.testCounts[name] > 1);
					// It's possible that we ran multiple tests because of a variant argument in Flutter, so only actually report
					// if there were multiple tests with the same name.
					if (firstTestWithMultipleRuns) {
						this.logToUser(`Multiple tests named "${firstTestWithMultipleRuns}" ran but only one was expected.\nYou may have multiple tests with the same name.\n`, "console");
					}
				}
				break;
		}
	}

	protected sendTestEventToEditor(notification: any) {
		let suiteID: number | undefined;
		switch (notification.type) {
			case "suite":
				const suite = notification as SuiteNotification;
				suiteID = suite.suite.id;
				break;
			case "group":
				const group = notification as GroupNotification;
				suiteID = group.group.suiteID;
				break;
			case "testStart":
				const testStart = notification as TestStartNotification;
				suiteID = testStart.test.suiteID;
				break;
			case "testDone":
				const testDone = notification as TestDoneNotification;
				suiteID = this.tests[testDone.testID].suiteID;
				break;
			case "print":
				const print = notification as PrintNotification;
				suiteID = this.tests[print.testID].suiteID;
				break;
			case "error":
				const error = notification as ErrorNotification;
				suiteID = this.tests[error.testID].suiteID;
				break;
		}

		const suitePath = suiteID !== undefined ? this.suitePaths[suiteID] : undefined;
		if (suitePath) {
			this.sendEvent(new Event(
				"dart.testNotification",
				notification,
			));
		}
	}
}

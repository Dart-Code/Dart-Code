import { DebugProtocol } from "@vscode/debugprotocol";
import { strict as assert } from "assert";
import * as path from "path";
import { DebugAdapterExecutable, DebugAdapterServer, DebugAdapterTrackerFactory, DebugConfiguration, Uri } from "vscode";
import { dartVMPath, flutterPath, isWin, vmServiceListeningBannerPattern } from "../shared/constants";
import { DartVsCodeLaunchArgs } from "../shared/debug/interfaces";
import { DebuggerType, LogCategory, VmServiceExtension } from "../shared/enums";
import { SpawnedProcess } from "../shared/interfaces";
import { logProcess } from "../shared/logging";
import { withTimeout } from "../shared/utils";
import { faint } from "../shared/utils/colors";
import { fsPath } from "../shared/utils/fs";
import { DartDebugClient } from "./dart_debug_client";
import { currentTestName, defer, delay, getLaunchConfiguration, logger, privateApi, watchPromise } from "./helpers";

export const flutterTestDeviceId = process.env.FLUTTER_TEST_DEVICE_ID || "flutter-tester";
export const flutterTestDeviceIsWeb = flutterTestDeviceId === "chrome" || flutterTestDeviceId === "web-server";

export async function startDebugger(dc: DartDebugClient, script?: Uri | string, extraConfiguration?: Record<string, any>): Promise<DebugConfiguration & DartVsCodeLaunchArgs & DebugProtocol.LaunchRequestArguments> {
	if (dc.debuggerType === DebuggerType.Flutter || dc.debuggerType === DebuggerType.FlutterTest) {
		extraConfiguration = Object.assign(
			{ deviceId: flutterTestDeviceId },
			extraConfiguration,
		);
	}
	const config = await getLaunchConfiguration(script, extraConfiguration);
	if (!config)
		throw new Error(`Could not get launch configuration (got ${config})`);

	await watchPromise("startDebugger->start", dc.start());
	return config as DebugConfiguration & DartVsCodeLaunchArgs & DebugProtocol.LaunchRequestArguments;
}

export function createDebugClient(debuggerType: DebuggerType) {
	const descriptor = privateApi.debugAdapterDescriptorFactory.descriptorForType(debuggerType);
	const trackerFactories = privateApi.trackerFactories as DebugAdapterTrackerFactory[];
	const dc = descriptor instanceof DebugAdapterServer
		? new DartDebugClient(debuggerType, { port: descriptor.port }, privateApi.debugCommands, privateApi.testCoordinator, trackerFactories, privateApi.dartCapabilities)
		: descriptor instanceof DebugAdapterExecutable
			? new DartDebugClient(
				debuggerType,
				{
					args: descriptor.args.slice(1),
					executable: descriptor.args[0],
					runtime: descriptor.command,
				},
				privateApi.debugCommands,
				privateApi.testCoordinator,
				trackerFactories,
				privateApi.dartCapabilities,
			)
			: undefined;
	if (!dc)
		throw Error(`Unknown debug descriptor type ${descriptor}`);

	dc.defaultTimeout = 120000;
	const thisDc = dc;
	defer("Terminate and clean up debug client/adapter", async () => {
		if (!thisDc.hasStarted) {
			privateApi.logger.info(`Skipping shutdown because it never started`);
			return;
		}
		if (!thisDc.hasTerminated) {
			// Wait for a terminated event with a timeout.
			const terminatedEvent = new Promise((resolve) => thisDc.on("terminated", resolve));
			try {
				thisDc.terminateRequest().catch((e) => logger.warn(e));
				// Tests may require a second terminateRequest because they first print "waiting for test to finish...".
				if (debuggerType === DebuggerType.DartTest || debuggerType === DebuggerType.FlutterTest || debuggerType === DebuggerType.WebTest) {
					await Promise.race([delay(300), terminatedEvent]);
					// If we still hasn't termianted, send the second.
					if (!thisDc.hasTerminated) {
						thisDc.terminateRequest().catch((e) => logger.warn(e));
						await Promise.race([delay(300), terminatedEvent]);
					}
				}
			} catch (e) {
				logger.warn(e);
			}
			await withTimeout(terminatedEvent, "Timed out terminating and cleaning up!", 50);
		}

		try {
			thisDc.stop().catch((e) => logger.warn(e));
		} catch (e) {
			logger.warn(e);
		}
	});
	return thisDc;
}

/// Waits for all the provided promises, but throws if the debugger terminates before they complete.
export function waitAllThrowIfTerminates(dc: DartDebugClient, ...promises: Array<Promise<any>>) {
	let didCompleteSuccessfully = false;
	return Promise.race([
		new Promise<void>(async (resolve, reject) => {
			await dc.waitForEvent("terminated", "waitAllThrowIfTerminates", 180000);
			// Wait a small amount to allow other awaited tasks to complete.
			setTimeout(() => {
				if (didCompleteSuccessfully) {
					resolve();
					return;
				}
				reject(Error("Terminated while waiting for other promises!"));
			}, 500);
		}),
		Promise.all(promises).then(() => didCompleteSuccessfully = true),
	]);
}

export function ensureVariable(variables: DebugProtocol.Variable[], evaluateName: string | undefined, name: string, value: string | { starts?: string, ends?: string }) {
	assert.ok(variables?.length, "No variables given to search");
	const v = variables.find((v) => v.name === name);
	assert.ok(
		v,
		`Couldn't find variable ${name} in\n`
		+ variables.map((v) => `        ${v.name}: ${v.value}`).join("\n"),
	);
	assert.equal(v.evaluateName, evaluateName);
	if (typeof value === "string")
		assert.equal(v.value, value);
	else {
		if (value.starts)
			assert.equal(v.value.slice(0, value.starts.length), value.starts);
		if (value.ends)
			assert.equal(v.value.slice(-value.ends.length), value.ends);
	}
}

export function ensureNoVariable(variables: DebugProtocol.Variable[], name: string) {
	assert.ok(variables, "No variables given to search");
	const v = variables.find((v) => v.name === name);
	assert.ok(!v, `Found unexpected variable ${name}!`);
}

export function ensureVariableWithIndex(variables: DebugProtocol.Variable[], index: number, evaluateName: string | undefined, name: string, value: string | { starts?: string, ends?: string }) {
	assert.ok(variables?.length, "No variables given to search");
	const foundIndex = variables.findIndex((v) => v.name === name);
	assert.equal(index, foundIndex, `Found variable ${name} at index ${foundIndex} but expected ${index}`);
	ensureVariable(variables, evaluateName, name, value);
}

export interface MapEntry {
	key: {
		evaluateName: string | undefined;
		name: string;
		value: string;
	};
	value: {
		evaluateName: string | undefined;
		name: string;
		value: string;
	};
}

export async function ensureMapEntry(mapEntries: DebugProtocol.Variable[], entry: MapEntry, dc: DartDebugClient) {
	assert.ok(mapEntries);
	let found = false;
	const keyValues: string[] = [];
	await Promise.all(mapEntries.map(async (mapEntry) => {
		const variable = await dc.getVariables(mapEntry.variablesReference);

		const key = variable[0];
		const value = variable[1];
		assert.ok(key, "Didn't get Key variable");
		assert.ok(value, "Didn't get Value variable");
		if (key.name === entry.key.name
			&& key.value === entry.key.value
			&& key.evaluateName === entry.key.evaluateName
			&& value.evaluateName === entry.value.evaluateName
			&& value.name === entry.value.name
			&& value.value === entry.value.value)
			found = true;
		keyValues.push(`${key.value}=${value.value}`);
	}));
	assert.ok(found, `Didn't find map entry for ${entry.key.value}=${entry.value.value}\nGot:\n  ${keyValues.join("\n  ")})`);
}

export async function getVariablesTree(dc: DartDebugClient, variablesReference: number): Promise<string[]> {
	let outputLines: string[] = [];
	for (const variable of await dc.getVariables(variablesReference)) {
		// Ignore types that recurse indefinitely, or we just don't want to check
		// in tests.
		if (variable.name === "runtimeType" || variable.name === "hashCode")
			continue;
		outputLines.push(`${variable.name}=${variable.value}`);
		if (variable.variablesReference) {
			const childLines = await getVariablesTree(dc, variable.variablesReference);
			outputLines = outputLines.concat(childLines.map((l) => `  ${l}`));
		}
	}
	return outputLines;
}

export function spawnDartProcessPaused(program: Uri, cwd: Uri, ...vmArgs: string[]): DartProcess {
	const programPath = fsPath(program);
	const cwdPath = fsPath(cwd);
	const dartPath = path.join(privateApi.workspaceContext.sdks.dart, dartVMPath);
	const debugArgs = [
		"--enable-vm-service=0",
		"--pause_isolates_on_start=true",
	];
	const allArgs = [
		...debugArgs,
		...vmArgs,
		programPath,
	];
	logger.info(`Spawning ${dartPath} in ${cwdPath} with args ${JSON.stringify(allArgs)}`);
	const process = privateApi.safeToolSpawn(
		cwdPath,
		dartPath,
		allArgs,
	);
	logProcess(logger, LogCategory.CI, process);
	const dartProcess = new DartProcess(process);
	defer("Kill spawned Dart process", () => {
		if (!dartProcess.hasExited)
			dartProcess.process.kill();
	});
	return dartProcess;
}

export async function spawnFlutterProcess(script: string | Uri): Promise<DartProcess> {
	const config = await getLaunchConfiguration(script, { deviceId: "flutter-tester" });
	if (!config)
		throw new Error(`Could not get launch configuration (got ${config})`);
	const binPath = path.join(config.flutterSdkPath!, flutterPath);
	const args = [
		"run",
		"-d",
		config.deviceId as string,
		"--start-paused",
	];
	const process = privateApi.safeToolSpawn(config.cwd, binPath, args);
	logger.info(`(PROC ${process.pid}) Spawned ${binPath} ${args.join(" ")} in ${config.cwd}`, LogCategory.CommandProcesses);
	logProcess(logger, LogCategory.CI, process);
	const flutterProcess = new DartProcess(process);
	defer("Kill spawned Flutter process", () => {
		// TODO: This may not be terminating correctly, as it may terminate the
		// shell process and not the child processes.
		if (!flutterProcess.hasExited)
			flutterProcess.process.kill();
	});
	return flutterProcess;
}

export class DartProcess {
	public readonly vmServiceUri: Promise<string>;
	public readonly exitCode: Promise<number | null>;
	public get hasExited() { return this.exited; }
	private exited = false;

	constructor(public readonly process: SpawnedProcess) {
		this.vmServiceUri = new Promise((resolve, reject) => {
			process.stdout.on("data", (data: Buffer | string) => {
				const match = vmServiceListeningBannerPattern.exec(data.toString());
				if (match)
					resolve(match[1]);
			});
		});
		this.exitCode = new Promise<number | null>((resolve, reject) => {
			process.on("exit", (code) => { this.exited = true; resolve(code); });
		});
	}
}

export async function killFlutterTester(): Promise<void> {
	// privateApi may be unavailable if the test was skipped (eg. Flutter Bazel on
	// Windows), so we can't call privateApi.safeToolSpawn here (though also should
	// not need to).
	if (!privateApi)
		return;

	await new Promise<void>((resolve) => {
		const proc = isWin
			? privateApi.safeToolSpawn(undefined, "taskkill", ["/IM", "flutter_tester.exe", "/F"])
			: privateApi.safeToolSpawn(undefined, "pkill", ["flutter_tester"]);
		proc.on("exit", (code: number) => {
			if (isWin ? code !== 128 : code === 0) {
				logger.warn(`flutter_tester process(s) remained after test (${currentTestName}). These have been terminated to avoid affecting future tests, ` +
					`but may indicate something is not cleaning up correctly`, LogCategory.CI);
			}
			resolve();
		});
	});

	if (!isWin) {
		await new Promise<void>((resolve) => {
			const proc2 = privateApi.safeToolSpawn(undefined, "ps", ["-x"]);

			proc2.stdout.setEncoding("utf8");
			proc2.stdout.on("data", (data: Buffer | string) => logger.info(data.toString()));
			proc2.stderr.setEncoding("utf8");
			proc2.stderr.on("data", (data: Buffer | string) => logger.info(data.toString()));
			proc2.on("error", (error) => logger.info(error?.message));
			proc2.on("data", (data: Buffer | string) => logger.info(data.toString()));

			proc2.on("exit", () => resolve());
		});
	}
}

export function isSdkFrame(frame: DebugProtocol.StackFrame) {
	return frame.source?.name?.startsWith("dart:");
}

export function isExternalPackage(frame: DebugProtocol.StackFrame) {
	return frame.source?.name && frame.source.name.startsWith("package:") && !isLocalPackage(frame);
}

export function isLocalPackage(frame: DebugProtocol.StackFrame) {
	return frame.source?.name && frame.source.name.startsWith("package:") &&
		// Packages known to be local (from our test projects).
		(frame.source.name.includes("my_package")
			|| frame.source.name.includes("hello_world")
			|| frame.source.name.includes("example"));
}

export function isUserCode(frame: DebugProtocol.StackFrame) {
	return frame.source?.name
		&& !frame.source.name.startsWith("dart:")
		&& (!frame.source.name.startsWith("package:") || isLocalPackage(frame));
}

export function ensureFrameCategories(frames: DebugProtocol.StackFrame[], presentationHint: string | undefined, origin: string | undefined) {
	assert.notEqual(frames.length, 0);
	for (const frame of frames) {
		assert.equal(frame.source!.presentationHint, presentationHint);
		assert.equal(frame.source!.origin, origin);
	}
}

export async function ensureServiceExtensionValue(id: VmServiceExtension, expected: unknown, dc: DartDebugClient) {
	const value = await privateApi.debugCommands.vmServices.getCurrentServiceExtensionValue(dc.currentSession, id);
	assert.equal(value, expected);
}

export function sdkPathForSdkDap(dc: DartDebugClient, file: string) {
	if (dc.isDartDap)
		return path.join(privateApi.workspaceContext.sdks.dart, isWin ? file.replace(/\//g, "\\") : file);
	// When not using the new DAPs, we don't translate SDK paths back to the local file paths.
	return undefined;
}

export function faintTextForNonSdkDap(dc: DartDebugClient, input: string) {
	// Currently the SDK DAPs don't use colours.
	if (dc.isDartDap)
		return input;
	return faint(input);
}

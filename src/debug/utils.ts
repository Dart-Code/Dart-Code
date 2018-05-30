import * as child_process from "child_process";
import * as fs from "fs";
import * as path from "path";
import { DebugProtocol } from "vscode-debugprotocol";

export const isWin = /^win/.test(process.platform);

const toolEnv = Object.create(process.env);
toolEnv.FLUTTER_HOST = "VSCode";
toolEnv.PUB_ENVIRONMENT = (toolEnv.PUB_ENVIRONMENT ? `${toolEnv.PUB_ENVIRONMENT}:` : "") + "vscode.dart-code";
export const globalFlutterArgs: string[] = [];
if (process.env.DART_CODE_IS_TEST_RUN) {
	toolEnv.PUB_ENVIRONMENT += ".test.bot";
	globalFlutterArgs.push("--suppress-analytics");
}

export function safeSpawn(workingDirectory: string, binPath: string, args: string[]): child_process.ChildProcess {
	// Spawning processes on Windows with funny symbols in the path requires quoting. However if you quote an
	// executable with a space in its path and an argument also has a space, you have to then quote all of the
	// arguments too!
	// Tragic.
	// https://github.com/nodejs/node/issues/7367
	return child_process.spawn(`"${binPath}"`, args.map((a) => `"${a}"`), { cwd: workingDirectory, env: toolEnv, shell: true });
}

export function uriToFilePath(uri: string, returnWindowsPath: boolean = isWin): string {
	let filePath = uri;
	if (uri.startsWith("file://"))
		filePath = decodeURI(uri.substring(7));
	else if (uri.startsWith("file:"))
		filePath = decodeURI(uri.substring(5)); // TODO: Does this case ever get hit? Will it be over-decoded?

	// Windows fixup.
	if (returnWindowsPath) {
		filePath = filePath.replace(/\//g, "\\");
		if (filePath[0] === "\\")
			filePath = filePath.substring(1);
	} else {
		if (filePath[0] !== "/")
			filePath = `/${filePath}`;
	}

	return filePath;
}

export function findFile(file: string, startLocation: string) {
	let lastParent;
	let parent = startLocation;

	while (parent && parent.length > 1 && parent !== lastParent) {
		const packages = path.join(parent, file);
		if (fs.existsSync(packages))
			return packages;
		lastParent = parent;
		parent = path.dirname(parent);
	}

	return null;
}

export function formatPathForVm(file: string): string {
	// Handle drive letter inconsistencies.
	file = forceWindowsDriveLetterToUppercase(file);

	// Convert any Windows backslashes to forward slashes.
	file = file.replace(/\\/g, "/");

	// Remove any existing file:/(//) prefixes.
	file = file.replace(/^file:\/+/, ""); // TODO: Does this case ever get hit? Will it be over-encoded?

	// Remove any remaining leading slashes.
	file = file.replace(/^\/+/, "");

	// Ensure a single slash prefix.
	if (file.startsWith("dart:"))
		return file;
	else
		return `/${encodeURI(file)}`;
}

export function forceWindowsDriveLetterToUppercase(p: string): string {
	if (p && isWin && path.isAbsolute(p) && p.charAt(0) === p.charAt(0).toLowerCase())
		p = p.substr(0, 1).toUpperCase() + p.substr(1);
	return p;
}

export function isWithinPath(file: string, folder: string) {
	const relative = path.relative(folder, file);
	return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export class PromiseCompleter<T> {
	public promise: Promise<T>;
	public resolve: (value?: T | PromiseLike<T>) => void;
	public reject: (error?: any, stackTrace?: string) => void;

	constructor() {
		this.promise = new Promise((res, rej) => {
			this.resolve = res;
			this.reject = rej;
		});
	}
}

export interface DartLaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	name: string;
	type: string;
	request: string;
	cwd: string;
	checkedMode: boolean;
	dartPath: string;
	debugSdkLibraries: boolean;
	debugExternalLibraries: boolean;
	program: string;
	args: string[];
	vmAdditionalArgs: string[];
	observatoryLogFile: string;
	showMemoryUsage: boolean;
}

export interface FlutterLaunchRequestArguments extends DartLaunchRequestArguments {
	flutterPath: string;
	flutterMode?: "debug" | "profile" | "release";
	flutterRunLogFile: string;
	flutterTestLogFile: string;
	deviceId: string;
}

export interface DartAttachRequestArguments extends DebugProtocol.AttachRequestArguments {
	type: string;
	request: string;
	cwd: string;
	debugSdkLibraries: boolean;
	debugExternalLibraries: boolean;
	packages: string;
	observatoryUri: string;
	observatoryLogFile: string;
}

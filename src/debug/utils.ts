import * as fs from "fs";
import * as path from "path";
import { DebugProtocol } from "vscode-debugprotocol";

export const isWin = /^win/.test(process.platform);

export const flutterEnv = Object.create(process.env);
flutterEnv.FLUTTER_HOST = "VSCode";

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

function findFile(file: string, startLocation: string) {
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

export function getLocalPackageName(entryPoint: string) {
	const pubspec = findFile("pubspec.yaml", path.dirname(entryPoint));
	if (!pubspec)
		return null;

	// TODO: This could fail if a nested "name:" property exists above the main "name:" property..
	// The proper fix is to use a proper YAML parser but none of those on npm look very appealing
	// (most have several dependencies, full issue trackers and/or are not being maintained).
	const lines = fs.readFileSync(pubspec).toString().split("\n");
	const values = lines.filter((l) => l.indexOf(":") > -1).map((l) => l.split(":"));
	const namePair = values.find((v) => v[0].trim() === "name");

	if (namePair)
		return namePair[1].trim();
	else
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
	if (isWin && path.isAbsolute(p) && p.charAt(0) === p.charAt(0).toLowerCase())
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

export class PackageMap {
	public static findPackagesFile(entryPoint: string): string {
		return findFile(".packages", path.dirname(entryPoint));
	}

	private map: { [name: string]: string } = {};

	constructor(file?: string) {
		if (!file) return;

		const lines: string[] = fs.readFileSync(file, { encoding: "utf8" }).split("\n");
		for (let line of lines) {
			line = line.trim();

			if (line.length === 0 || line.startsWith("#"))
				continue;

			const index = line.indexOf(":");
			if (index !== -1) {
				const name = line.substr(0, index);
				const rest = line.substring(index + 1);

				if (rest.startsWith("file:"))
					this.map[name] = uriToFilePath(rest);
				else
					this.map[name] = path.join(path.dirname(file), rest);
			}
		}
	}

	public getPackagePath(name: string): string {
		return this.map[name];
	}

	public resolvePackageUri(uri: string): string {
		if (!uri)
			return null;

		let name: string = uri;
		if (name.startsWith("package:"))
			name = name.substring(8);
		const index = name.indexOf("/");
		if (index === -1)
			return null;

		const rest = name.substring(index + 1);
		name = name.substring(0, index);

		const location = this.getPackagePath(name);
		if (location)
			return path.join(location, rest);
		else
			return null;
	}

	public convertFileToPackageUri(file: string): string {
		for (const name of Object.keys(this.map)) {
			const dir = this.map[name];
			if (isWithinPath(file, dir)) {
				let rest = file.substring(dir.length);
				// package: uri should always use forward slashes.
				if (isWin)
					rest = rest.replace(/\\/g, "/");
				// Ensure we don't start with a slash if the map didn't have a trailing slash,
				// else we'll end up with doubles. See https://github.com/Dart-Code/Dart-Code/issues/398
				if (rest.startsWith("/"))
					rest = rest.substr(1);
				return `package:${name}/${rest}`;
			}
		}

		return null;
	}
}

export interface DartLaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	type: string;
	request: string;
	cwd: string;
	checkedMode: boolean;
	dartPath: string;
	debugSdkLibraries: boolean;
	debugExternalLibraries: boolean;
	program: string;
	args: string[];
	vmArgs: string[];
	observatoryLogFile: string;
	previewDart2: boolean;
}

export interface FlutterLaunchRequestArguments extends DartLaunchRequestArguments {
	flutterPath: string;
	flutterMode?: "debug" | "profile" | "release";
	flutterRunLogFile: string;
	flutterTestLogFile: string;
	deviceId: string;
}

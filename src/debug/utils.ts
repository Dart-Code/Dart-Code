"use strict"

import * as fs from "fs";
import * as path from "path";
import { DebugProtocol } from "vscode-debugprotocol";

export const isWin = /^win/.test(process.platform);

// TODO: improve
export function uriToFilePath(uri: string): string {
	if (uri.startsWith("file://"))
		return uri.substring(7);
	if (uri.startsWith("file:"))
		return uri.substring(5);
	return uri;
}

function findFile(file: string, startLocation: string) {
	let lastParent;
	let parent = path.dirname(startLocation);

	while (parent && parent.length > 1 && parent != lastParent) {
		let packages = path.join(parent, file);
		if (fs.existsSync(packages))
			return packages;
		lastParent = parent;
		parent = path.dirname(parent);
	}

	return null;
}

export function getLocalPackageName(entryPoint: string) {
	let pubspec = findFile("pubspec.yaml", entryPoint);
	if (!pubspec)
		return null;

	// TODO: This could fail if a nested "name:" property exists above the main "name:" property..
	// The proper fix is to use a proper YAML parser but none of those on npm look very appealing
	// (most have several dependencies, full issue trackers and/or are not being maintained). 
	let lines = fs.readFileSync(pubspec).toString().split("\n");
	let values = lines.filter(l => l.indexOf(":") > -1).map(l => l.split(":"));
	let namePair = values.find(v => v[0].trim() == "name");

	if (namePair)
		return namePair[1].trim();
	else
		return null;
}

// TODO: improve
export function fileToUri(file: string): string {
	// Handle windows paths; slashes must be converted and we need an extra slash prefixed.
	file = file.replace(/\\/g, "/");
	if (!file.startsWith("/"))
		file = "/" + file;

	return `file://${file}`;
}

export class PromiseCompleter<T> {
	promise: Promise<T>;
	resolve: (value?: T | PromiseLike<T>) => void;
	reject: (error?: any, stackTrace?: string) => void;

	constructor() {
		this.promise = new Promise((res, rej) => {
			this.resolve = res;
			this.reject = rej;
		});
	}
}

export class PackageMap {
	static findPackagesFile(entryPoint: string): string {
		return findFile(".packages", entryPoint);
	}

	private map: { [name: string]: string } = {};

	constructor(file?: string) {
		if (!file) return;

		let lines: string[] = fs.readFileSync(file, { encoding: "utf8" }).split("\n");
		for (let line of lines) {
			line = line.trim();

			if (line.length == 0 || line.startsWith("#"))
				continue;

			let index = line.indexOf(":");
			if (index != -1) {
				let name = line.substr(0, index);
				let rest = line.substring(index + 1);

				if (rest.startsWith("file:"))
					this.map[name] = uriToFilePath(rest);
				else
					this.map[name] = path.join(path.dirname(file), rest);
			}
		}
	}

	getPackagePath(name: string): string {
		return this.map[name];
	}

	resolvePackageUri(uri: string): string {
		if (!uri)
			return null;

		let name: string = uri;
		if (name.startsWith("package:"))
			name = name.substring(8);
		let index = name.indexOf("/");
		if (index == -1)
			return null;

		let rest = name.substring(index + 1);
		name = name.substring(0, index);

		let location = this.getPackagePath(name);
		if (location)
			return path.join(location, rest);
		else
			return null;
	}

	convertFileToPackageUri(file: string): string {
		for (let name of Object.keys(this.map)) {
			let dir = this.map[name];
			if (file.startsWith(dir)) {
				let rest = file.substring(dir.length);
				// package: uri should always use forward slashes.
				if (isWin)
					rest = rest.replace(/\\/g, '/');
				return `package:${name}/${rest}`;
			}
		}

		return null;
	}
}

export interface DartLaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	cwd: string;
	checkedMode: boolean;
	dartPath: string;
	debugSdkLibraries: boolean;
	debugExternalLibraries: boolean;
	program: string;
	args: Array<string>;
	observatoryLogFile: string;
}

export interface FlutterLaunchRequestArguments extends DartLaunchRequestArguments {
	flutterPath: string;
	flutterRunLogFile: string;
}

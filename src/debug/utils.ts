"use strict"

import * as fs from "fs";
import * as path from "path";

function isWindows(): boolean {
	return process.platform === 'win32';
}

// TODO: improve
export function uriToFilePath(uri: string): string {
	if (uri.startsWith("file://"))
		return uri.substring(7);
	if (uri.startsWith("file:"))
		return uri.substring(5);
	return uri;
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
		let lastParent;
		let parent = path.dirname(entryPoint);

		while (parent && parent.length > 1 && parent != lastParent) {
			let packages = path.join(parent, ".packages");
			if (fs.existsSync(packages))
				return packages;
			lastParent = parent;
			parent = path.dirname(parent);
		}

		return null;
	}

	private map: {} = {};
	private localPackageName;

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

				// If we map to "lib/" then this must be the local package so we can stash the name.
				if (rest == "lib/")
					this.localPackageName = name;
			}
		}
	}

	getLocalPackageName(): string {
		return this.localPackageName;
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
				if (isWindows())
					rest = rest.replace(/\\/g, '/');
				return `package:${name}/${rest}`;
			}
		}

		return null;
	}
}

export class DebugSettings {
	sdkPath: string;
	debugSdkLibraries: boolean;
	debugExternalLibraries: boolean;
}

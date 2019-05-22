import * as fs from "fs";
import * as path from "path";
import { findFile, isWin, isWithinPath, uriToFilePath } from "../../shared/utils";

export class PackageMap {
	public static findPackagesFile<T extends string | undefined>(entryPoint: T): string | (undefined extends T ? undefined : never) {
		if (typeof entryPoint !== "string")
			return undefined as (undefined extends T ? undefined : never);

		return findFile(".packages", entryPoint) as string | (undefined extends T ? undefined : never);
	}

	private map: { [name: string]: string } = {};
	public readonly localPackageName: string | undefined;
	public get packages(): { [name: string]: string } { return Object.assign({}, this.map); }

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
				else {
					this.map[name] = path.join(path.dirname(file), rest);
					if (rest === "lib" || rest === "lib\\" || rest === "lib/")
						this.localPackageName = name;
				}
			}
		}
	}

	public getPackagePath(name: string): string {
		return this.map[name];
	}

	public resolvePackageUri(uri: string): string | undefined {
		if (!uri)
			return undefined;

		let name: string = uri;
		if (name.startsWith("package:"))
			name = name.substring(8);
		const index = name.indexOf("/");
		if (index === -1)
			return undefined;

		const rest = name.substring(index + 1);
		name = name.substring(0, index);

		const location = this.getPackagePath(name);
		if (location)
			return path.join(location, rest);
		else
			return undefined;
	}

	public convertFileToPackageUri(file: string, allowSelf = true): string | undefined {
		if (!file)
			return;
		for (const name of Object.keys(this.map)) {
			const dir = this.map[name];
			if (isWithinPath(file, dir)) {
				if (!allowSelf && name === this.localPackageName)
					return undefined;
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

		return undefined;
	}
}

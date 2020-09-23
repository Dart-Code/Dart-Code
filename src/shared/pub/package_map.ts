import * as fs from "fs";
import * as path from "path";
import * as url from "url";
import { Logger } from "../interfaces";
import { findFileInAncestor, uriToFilePath } from "../utils";
import { normalizeSlashes } from "../utils/fs";

export abstract class PackageMap {
	public static findPackagesFile<T extends string | undefined>(entryPoint: T): string | (undefined extends T ? undefined : never) {
		if (typeof entryPoint !== "string")
			return undefined as (undefined extends T ? undefined : never);

		const file = findFileInAncestor([path.join(".dart_tool/package_config.json"), ".packages"], entryPoint);
		return file as string | (undefined extends T ? undefined : never);
	}

	public static load(logger: Logger, file: string | undefined): PackageMap {
		if (!file)
			return new MissingPackageMap();
		try {
			if (path.basename(file).toLowerCase() === ".packages")
				return new DotPackagesPackageMap(file);
			else
				return new PackageConfigJsonPackageMap(logger, file);
		} catch (e) {
			logger.error(e);
			return new MissingPackageMap();
		}
	}

	abstract get packages(): { [name: string]: string };

	public getPackagePath(name: string): string | undefined {
		return this.packages[name];
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
}

class MissingPackageMap extends PackageMap {
	public get packages(): { [name: string]: string; } {
		return {};
	}
	public getPackagePath(name: string): string | undefined {
		return undefined;
	}
	public resolvePackageUri(uri: string): string | undefined {
		return undefined;
	}
}

class DotPackagesPackageMap extends PackageMap {
	private map: { [name: string]: string } = {};
	private readonly localPackageRoot: string | undefined;
	public get packages(): { [name: string]: string } { return Object.assign({}, this.map); }

	constructor(file?: string) {
		super();
		if (!file) return;
		this.localPackageRoot = path.dirname(file);

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
					this.map[name] = path.join(this.localPackageRoot, rest);
			}
		}
	}


}

class PackageConfigJsonPackageMap extends PackageMap {
	private readonly map: { [name: string]: string } = {};
	private readonly config: PackageJsonConfig;

	constructor(private readonly logger: Logger, private readonly packageConfigPath: string) {
		super();
		const json = fs.readFileSync(this.packageConfigPath, "utf8");
		this.config = JSON.parse(json);

		for (const pkg of this.config.packages) {
			try {
				const packageConfigFolderPath = path.dirname(this.packageConfigPath);
				const packageRootPath = this.getPathForUri(pkg.rootUri);
				const packageLibPath = this.getPathForUri(pkg.packageUri);
				this.map[pkg.name] = path.resolve(packageConfigFolderPath, packageRootPath ?? "", packageLibPath ?? "");
			} catch (e) {
				logger.error(`Failed to resolve path for package ${pkg.name}: ${e}`);
			}
		}
	}

	private getPathForUri(uri: string): string | undefined {
		if (!uri)
			return undefined;

		const parsedPath = normalizeSlashes(
			uri.startsWith("file:")
				? url.fileURLToPath(uri)
				: unescape(uri),
		);

		return parsedPath.endsWith(path.sep) ? parsedPath : `${parsedPath}${path.sep}`;
	}

	public get packages(): { [name: string]: string } { return Object.assign({}, this.map); }

	public getPackagePath(name: string): string | undefined {
		return this.map[name];
	}
}

interface PackageJsonConfig {
	configVersion: number,
	packages: PackageJsonConfigPackage[];
}

interface PackageJsonConfigPackage {
	name: string;
	rootUri: string;
	packageUri: string;
}

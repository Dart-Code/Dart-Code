import * as fs from "fs";
import * as path from "path";
import * as url from "url";
import { Logger } from "../interfaces";
import { findFileInAncestor, uriToFilePath } from "../utils";
import { normalizeSlashes } from "../utils/fs";

export class PackageMapLoader {
	constructor(private readonly logger: Logger) { }

	public loadForProject(projectFolder: string): PackageMap {
		return PackageMap.loadForProject(this.logger, projectFolder);
	}
}

export abstract class PackageMap {
	public static findPackagesFile(entryPoint: string | undefined): string | undefined {
		if (!entryPoint)
			return undefined;

		const file = findFileInAncestor([path.join(".dart_tool/package_config.json"), ".packages"], entryPoint);
		return file;
	}

	public static loadForProject(logger: Logger, projectFolder: string): PackageMap {
		const packagesFile = PackageMap.findPackagesFile(projectFolder);
		try {
			return packagesFile
				? this.load(logger, packagesFile)
				: new MissingPackageMap();
		} catch (e) {
			logger.warn(`Failed to load package map at ${packagesFile}, continuing as if package map does not exist: ${e}`);
			return new MissingPackageMap();
		}
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

	public abstract reload(): void;

	abstract get packages(): Record<string, string>;

	public getPackagePath(name: string): string | undefined {
		return this.packages[name];
	}

	public get flutterRootPath(): string | undefined {
		return undefined;
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

export class MissingPackageMap extends PackageMap {
	public get packages(): Record<string, string> {
		return {};
	}
	public getPackagePath(_name: string): string | undefined {
		return undefined;
	}
	public resolvePackageUri(_uri: string): string | undefined {
		return undefined;
	}
	public reload() { }
}

class DotPackagesPackageMap extends PackageMap {
	private map: Record<string, string> = {};
	private readonly file: string | undefined;
	private readonly localPackageRoot: string | undefined;
	public get packages(): Record<string, string> { return Object.assign({}, this.map); }

	constructor(file?: string) {
		super();
		if (!file) return;
		this.file = file;
		this.localPackageRoot = path.dirname(file);

		this.load();
	}

	public reload(): void {
		this.load();
	}

	private load(): void {
		if (!this.file || !this.localPackageRoot)
			return;

		this.map = {};
		const lines: string[] = fs.readFileSync(this.file, { encoding: "utf8" }).split("\n");
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
	private map: Record<string, string> = {};
	private config!: PackageJsonConfig;

	constructor(private readonly logger: Logger, private readonly packageConfigPath: string) {
		super();
		this.load();
	}

	public reload() {
		this.load();
	}

	private load() {
		const json = fs.readFileSync(this.packageConfigPath, "utf8");
		try {
			this.config = JSON.parse(json);
		} catch (e) {
			this.logger.warn(`Failed to load package map at ${this.packageConfigPath}, continuing with empty map: ${e}`);
			this.map = {};
			return;
		}

		this.map = {};
		for (const pkg of this.config.packages) {
			const packageConfigFolderPath = path.dirname(this.packageConfigPath);
			const packageRootPath = this.getPathForUri(pkg.rootUri);
			if (packageRootPath) {
				const packageLibPath = this.getPathForUri(pkg.packageUri);
				this.map[pkg.name] = path.resolve(packageConfigFolderPath, packageRootPath, packageLibPath ?? "");
			} else {
				this.logger.error(`Failed to resolve path for package ${pkg.name}, did not resolve a valid rootUri`);
			}
		}
	}

	private getPathForUri(uri: string): string | undefined {
		if (!uri)
			return undefined;

		try {
			const parsedPath = normalizeSlashes(
				uri.startsWith("file:")
					? url.fileURLToPath(uri)
					: decodeURIComponent(uri),
			);

			return parsedPath.endsWith(path.sep) ? parsedPath : `${parsedPath}${path.sep}`;
		} catch (e) {
			// Could be an invalid path such as a package_config on Linux being run on Windows.
			// https://github.com/Dart-Code/Dart-Code/issues/5909
			// This only happens on Windows because the Linux paths with no drive letters are invalid
			// for Windows, however the opposite is not true (`file:///C:/foo` parses fine on Linux).
			this.logger.warn(`Failed to extract path from URI: ${uri}: ${e}`);
			return undefined;
		}
	}

	public get packages(): Record<string, string> { return Object.assign({}, this.map); }

	public get flutterRootPath(): string | undefined {
		const flutterRootUri = this.config?.flutterRoot;
		return flutterRootUri ? this.getPathForUri(flutterRootUri) : undefined;
	}

	public getPackagePath(name: string): string | undefined {
		return this.map[name];
	}
}

interface PackageJsonConfig {
	configVersion: number,
	packages: PackageJsonConfigPackage[];
	flutterRoot?: string;
}

interface PackageJsonConfigPackage {
	name: string;
	rootUri: string;
	packageUri: string;
}

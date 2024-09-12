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
		return packagesFile
			? this.load(logger, packagesFile)
			: new MissingPackageMap();
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

export class MissingPackageMap extends PackageMap {
	public get packages(): { [name: string]: string; } {
		return {};
	}
	public getPackagePath(name: string): string | undefined {
		return undefined;
	}
	public resolvePackageUri(uri: string): string | undefined {
		return undefined;
	}
	public reload() { }
}

class DotPackagesPackageMap extends PackageMap {
	private map: { [name: string]: string } = {};
	private readonly file: string | undefined;
	private readonly localPackageRoot: string | undefined;
	public get packages(): { [name: string]: string } { return Object.assign({}, this.map); }

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
	private map: { [name: string]: string } = {};
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
		this.config = JSON.parse(json);

		this.map = {};
		for (const pkg of this.config.packages) {
			try {
				const packageConfigFolderPath = path.dirname(this.packageConfigPath);
				const packageRootPath = this.getPathForUri(pkg.rootUri);
				const packageLibPath = this.getPathForUri(pkg.packageUri);
				this.map[pkg.name] = path.resolve(packageConfigFolderPath, packageRootPath ?? "", packageLibPath ?? "");
			} catch (e) {
				this.logger.error(`Failed to resolve path for package ${pkg.name}: ${e}`);
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

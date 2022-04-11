import * as vs from "vscode";
import { Logger } from "../../shared/interfaces";
import { PackageMap } from "../../shared/pub/package_map";
import { DartPackageUriTerminalLink, findPackageUriLinks } from "../../shared/vscode/terminal_link_provider_utils";
import { getAllProjectFolders } from "../../shared/vscode/utils";
import { WorkspaceContext } from "../../shared/workspace";
import { config } from "../config";
import { getExcludedFolders } from "../utils";


export class DartPackageUriTerminalLinkProvider implements vs.TerminalLinkProvider<DartPackageUriTerminalLink> {
	packageMaps: { [key: string]: PackageMap } | undefined;
	packageMapDiscovery: Promise<void> | undefined;

	constructor(private readonly logger: Logger, private readonly context: WorkspaceContext) {
		context.events.onPackageMapChange.listen(() => {
			this.packageMaps = undefined;
			this.packageMapDiscovery = undefined;
		});
	}

	private async discoverPackageMaps(): Promise<void> {
		if (this.packageMapDiscovery) {
			return this.packageMapDiscovery;
		}
		this.packageMapDiscovery = new Promise(async (resolve) => {
			const projectFolders = await getAllProjectFolders(this.logger, getExcludedFolders, { requirePubspec: true, searchDepth: config.projectSearchDepth });
			this.packageMaps = {};
			for (const projectFolder of projectFolders) {
				this.packageMaps[projectFolder] = PackageMap.loadForProject(this.logger, projectFolder);
			}
			resolve();
		});
		return this.packageMapDiscovery;
	}

	private isKnownPackage(packageName: string): boolean {
		return !!(this.packageMaps && Object.values(this.packageMaps).find((m) => m.packages[packageName]));
	}

	private resolvePackageUri(uri: string): string | undefined {
		if (!this.packageMaps)
			return undefined;
		for (const packageMap of Object.values(this.packageMaps)) {
			const filePath = packageMap.resolvePackageUri(uri);
			if (filePath)
				return filePath;
		}
		return undefined;
	}

	public async provideTerminalLinks(context: vs.TerminalLinkContext, token: vs.CancellationToken): Promise<DartPackageUriTerminalLink[]> {
		if (!this.packageMaps)
			await this.discoverPackageMaps();

		return findPackageUriLinks(context.line, (name) => this.isKnownPackage(name));
	}

	public handleTerminalLink(link: DartPackageUriTerminalLink): vs.ProviderResult<void> {
		const filePath = this.resolvePackageUri(link.uri);
		if (!filePath) {
			vs.window.showErrorMessage(`Unable to find root for package ${link.packageName}`);
			return;
		}

		vs.commands.executeCommand("_dart.jumpToLineColInUri", vs.Uri.file(filePath), link.line, link.col);
	}
}

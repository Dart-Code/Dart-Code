import * as vs from "vscode";
import { Logger } from "../../shared/interfaces";
import { PackageMap } from "../../shared/pub/package_map";
import { notUndefined } from "../../shared/utils";
import { DartPackageUriLink, findPackageUriLinks, formatLineColFragment } from "../../shared/vscode/terminal_link_provider_utils";
import { getAllProjectFolders } from "../../shared/vscode/utils";
import { WorkspaceContext } from "../../shared/workspace";
import { config } from "../config";
import { getExcludedFolders } from "../utils";


export class DartPackageUriLinkProvider implements vs.TerminalLinkProvider<DartPackageUriLink>, vs.DocumentLinkProvider<vs.DocumentLink> {
	packageMaps: Record<string, PackageMap> | undefined;
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
				this.packageMaps[projectFolder] = PackageMap.loadForProject(this.logger, projectFolder, "DartPackageUriLinkProvider.discoverPackageMaps");
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

	public provideTerminalLinks(context: vs.TerminalLinkContext): Promise<DartPackageUriLink[]> {
		return this.getLinks(context.line);
	}

	private async getLinks(content: string) {
		if (!this.packageMaps)
			await this.discoverPackageMaps();

		return findPackageUriLinks(content, (name) => this.isKnownPackage(name));
	}

	public handleTerminalLink(link: DartPackageUriLink): vs.ProviderResult<void> {
		const filePath = this.resolvePackageUri(link.uri);
		if (!filePath) {
			void vs.window.showErrorMessage(`Unable to find root for package ${link.packageName}`);
			return;
		}

		void vs.commands.executeCommand("_dart.jumpToLineColInUri", vs.Uri.file(filePath), link.line, link.col);
	}

	public async provideDocumentLinks(document: vs.TextDocument): Promise<vs.DocumentLink[]> {
		const links = await this.getLinks(document.getText());

		return links.map((link) => {
			const range = new vs.Range(document.positionAt(link.startIndex), document.positionAt(link.startIndex + link.length));
			const filePath = this.resolvePackageUri(link.uri);
			if (!filePath)
				return undefined;
			return new vs.DocumentLink(range, vs.Uri.file(filePath).with({ fragment: formatLineColFragment(link) }));
		}).filter(notUndefined);
	}

}

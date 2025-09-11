import * as vs from "vscode";
import { Logger } from "../../shared/interfaces";
import { PackageMap } from "../../shared/pub/package_map";
import { notUndefined } from "../../shared/utils";
import { fsPath } from "../../shared/utils/fs";
import { DartPackageUriLink, findPackageUriLinks, formatLineColFragment } from "../../shared/vscode/terminal_link_provider_utils";
import { getAllProjectFolders } from "../../shared/vscode/utils";
import { WorkspaceContext } from "../../shared/workspace";
import { config } from "../config";
import { isDartDocument } from "../editors";
import { locateBestProjectRoot } from "../project";
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
				this.packageMaps[projectFolder] = PackageMap.loadForProject(this.logger, projectFolder);
			}
			resolve();
		});
		return this.packageMapDiscovery;
	}

	private isKnownPackage(packageName: string): boolean {
		return !!(this.packageMaps && Object.values(this.packageMaps).find((m) => m.packages[packageName]));
	}

	private resolveFirstPackageUri(uri: string): string | undefined {
		if (!this.packageMaps)
			return undefined;
		for (const packageMap of Object.values(this.packageMaps)) {
			const filePath = packageMap.resolvePackageUri(uri);
			if (filePath)
				return filePath;
		}
		return undefined;
	}

	private resolvePackageUris(uri: string): string[] {
		if (!this.packageMaps)
			return [];
		return Object.values(this.packageMaps).map((map) => map.resolvePackageUri(uri)).filter(notUndefined);
	}

	public async provideTerminalLinks(context: vs.TerminalLinkContext, _token: vs.CancellationToken): Promise<DartPackageUriLink[]> {
		return this.getLinks(context.line);
	}

	private async getLinks(content: string) {
		if (!this.packageMaps)
			await this.discoverPackageMaps();

		return findPackageUriLinks(content, (name) => this.isKnownPackage(name));
	}

	public handleTerminalLink(link: DartPackageUriLink): vs.ProviderResult<void> {
		const filePaths = this.resolvePackageUris(link.uri);

		if (!filePaths.length) {
			// No locations.
			void vs.window.showErrorMessage(`Unable to find root for package ${link.packageName}`);
			return;
		} else if (filePaths.length === 1) {
			// Single location, go straight there.
			void vs.commands.executeCommand("_dart.jumpToLineColInUri", vs.Uri.file(filePaths[0]), link.line, link.col);
		} else {
			// Multiple locations - go to the first one but show a Peek window.
			const locations: vs.Location[] = filePaths.map((filePath) => new vs.Location(vs.Uri.file(filePath), new vs.Position(link.line ?? 0, link.col ?? 0)));
			const first = locations[0];
			void vs.commands.executeCommand("editor.action.goToLocations", first.uri, first.range.start, locations, "gotoAndPeek", "No locations found");
		}
	}

	public async provideDocumentLinks(document: vs.TextDocument, _token: vs.CancellationToken): Promise<vs.DocumentLink[]> {
		if (!isDartDocument(document))
			return [];

		const projectFolder = locateBestProjectRoot(fsPath(document.uri));
		if (!projectFolder)
			return [];

		if (!this.packageMaps)
			await this.discoverPackageMaps();

		// Prefer using the package map for the current project to look this up, since the workspace might have multiple.
		const packageMap = this.packageMaps ? this.packageMaps[projectFolder] : undefined;
		if (!packageMap)
			return [];

		const links = await this.getLinks(document.getText());
		return links.map((link) => {
			const range = new vs.Range(document.positionAt(link.startIndex), document.positionAt(link.startIndex + link.length));
			// First try the current package URI, but call back to any match.
			const filePath = packageMap.resolvePackageUri(link.uri) ?? this.resolveFirstPackageUri(link.uri);
			if (!filePath)
				return undefined;
			return new vs.DocumentLink(range, vs.Uri.file(filePath).with({ fragment: formatLineColFragment(link) }));
		}).filter(notUndefined);
	}

}

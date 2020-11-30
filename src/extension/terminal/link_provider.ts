import * as vs from "vscode";
import { Logger } from "../../shared/interfaces";
import { PackageMap } from "../../shared/pub/package_map";
import { flatMap } from "../../shared/utils";
import { findProjectFolders, fsPath } from "../../shared/utils/fs";
import { getDartWorkspaceFolders } from "../../shared/vscode/utils";
import { WorkspaceContext } from "../../shared/workspace";
import { getExcludedFolders } from "../utils";

const packageUriPattern = new RegExp("(?<uri>package:\\S+[\\/]\\S+\\.dart)(?:[: ](?<line>\\d+):(?<col>\\d+))?", "mg");

export class DartTerminalLinkProvider implements vs.TerminalLinkProvider<DartTerminalLink> {
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
			const workspaceFolders = getDartWorkspaceFolders();
			const topLevelFolders = workspaceFolders.map((w) => fsPath(w.uri));
			const allExcludedFolders = flatMap(workspaceFolders, getExcludedFolders);
			const projectFolders = await findProjectFolders(this.logger, topLevelFolders, allExcludedFolders, { requirePubspec: true });
			this.packageMaps = {};
			for (const projectFolder of projectFolders) {
				this.packageMaps[projectFolder] = PackageMap.loadForProject(this.logger, projectFolder);
			}
			resolve();
		});
		return this.packageMapDiscovery;
	}

	private isKnownPackage(packageName: string) {
		return this.packageMaps && !!Object.values(this.packageMaps).find((m) => m.packages[packageName]);
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

	public async provideTerminalLinks(context: vs.TerminalLinkContext, token: vs.CancellationToken): Promise<DartTerminalLink[]> {
		if (!this.packageMaps)
			await this.discoverPackageMaps();

		const results: DartTerminalLink[] = [];
		packageUriPattern.lastIndex = -1;
		let result: RegExpExecArray | null;
		// tslint:disable-next-line: no-conditional-assignment
		while ((result = packageUriPattern.exec(context.line)) && result.groups) {
			let uri: vs.Uri | undefined;
			try {
				uri = vs.Uri.parse(result.groups.uri, true);
			} catch (e) {
				this.logger.error(e);
				continue;
			}
			if (!uri)
				continue;

			const packageName = uri.path.split("/")[0];
			if (!this.isKnownPackage(packageName))
				continue;
			const line = result.groups.line ? parseInt(result.groups.line) : undefined;
			const col = result.groups.col ? parseInt(result.groups.col) : undefined;
			const startIndex = result.index;
			// TODO: This should be "result[0].length" but including the line/col can cause
			// the tooltip not to render correctly, so we only highlight the uri for now.
			// https://github.com/microsoft/vscode/issues/108301
			const length = result.groups.uri.length;

			results.push({
				col,
				length,
				line,
				packageName,
				startIndex,
				tooltip: "Open file in editor",
				uri: result.groups.uri,
			});
		}

		return results;
	}

	public handleTerminalLink(link: DartTerminalLink): vs.ProviderResult<void> {
		const filePath = this.resolvePackageUri(link.uri);
		if (!filePath) {
			vs.window.showErrorMessage(`Unable to find root for package ${link.packageName}`);
			return;
		}

		vs.commands.executeCommand("_dart.jumpToLineColInUri", vs.Uri.file(filePath), link.line, link.col);
	}
}

interface DartTerminalLink extends vs.TerminalLink {
	startIndex: number;
	length: number;
	tooltip: string;
	packageName: string;
	uri: string;
	line: number | undefined;
	col: number | undefined;
}

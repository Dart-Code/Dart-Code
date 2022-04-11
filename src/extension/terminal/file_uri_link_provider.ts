import * as vs from "vscode";
import { fsPath } from "../../shared/utils/fs";
import { DartFileUriTerminalLink, findFileUriLinks } from "../../shared/vscode/terminal_link_provider_utils";


export class DartFileUriTerminalLinkProvider implements vs.TerminalLinkProvider<DartFileUriTerminalLink> {
	public async provideTerminalLinks(context: vs.TerminalLinkContext, token: vs.CancellationToken): Promise<DartFileUriTerminalLink[]> {
		return findFileUriLinks(context.line);
	}

	public handleTerminalLink(link: DartFileUriTerminalLink): vs.ProviderResult<void> {
		const filePath = fsPath(link.uri);
		vs.commands.executeCommand("_dart.jumpToLineColInUri", vs.Uri.file(filePath), link.line, link.col);
	}
}

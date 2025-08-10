import * as vs from "vscode";
import { fsPath } from "../../shared/utils/fs";
import { DartFileUriLink, findFileUriLinks, formatLineColFragment } from "../../shared/vscode/terminal_link_provider_utils";


export class DartFileUriLinkProvider implements vs.TerminalLinkProvider<DartFileUriLink>, vs.DocumentLinkProvider<vs.DocumentLink> {
	public async provideTerminalLinks(context: vs.TerminalLinkContext, _token: vs.CancellationToken): Promise<DartFileUriLink[]> {
		return this.getLinks(context.line);
	}

	private getLinks(content: string) {
		return findFileUriLinks(content);
	}

	public handleTerminalLink(link: DartFileUriLink): vs.ProviderResult<void> {
		const filePath = fsPath(link.uri);
		void vs.commands.executeCommand("_dart.jumpToLineColInUri", vs.Uri.file(filePath), link.line, link.col);
	}

	public async provideDocumentLinks(document: vs.TextDocument, _token: vs.CancellationToken): Promise<vs.DocumentLink[]> {
		const links = await this.getLinks(document.getText());

		return links.map((link) => {
			const range = new vs.Range(document.positionAt(link.startIndex), document.positionAt(link.startIndex + link.length));
			return new vs.DocumentLink(range, link.uri.with({ fragment: formatLineColFragment(link) }));
		});
	}
}



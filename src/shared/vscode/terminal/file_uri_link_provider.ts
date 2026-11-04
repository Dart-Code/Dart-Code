import * as vs from "vscode";
import { fsPath } from "../../utils/fs";
import { DartFileUriLink, findFileUriLinks, formatLineColFragment } from "../terminal_link_provider_utils";


export class DartFileUriLinkProvider implements vs.TerminalLinkProvider<DartFileUriLink>, vs.DocumentLinkProvider<vs.DocumentLink> {
	public provideTerminalLinks(context: vs.TerminalLinkContext, _token: vs.CancellationToken): DartFileUriLink[] {
		return this.getLinks(context.line);
	}

	private getLinks(content: string) {
		return findFileUriLinks(content);
	}

	public handleTerminalLink(link: DartFileUriLink): vs.ProviderResult<void> {
		const filePath = fsPath(link.uri);
		void vs.commands.executeCommand("_dart.jumpToLineColInUri", vs.Uri.file(filePath), link.line, link.col);
	}

	public provideDocumentLinks(document: vs.TextDocument, _token: vs.CancellationToken): vs.DocumentLink[] {
		const links = this.getLinks(document.getText());

		return links.map((link) => {
			const range = new vs.Range(document.positionAt(link.startIndex), document.positionAt(link.startIndex + link.length));
			return new vs.DocumentLink(range, link.uri.with({ fragment: formatLineColFragment(link) }));
		});
	}
}



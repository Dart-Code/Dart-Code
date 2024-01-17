import * as vs from "vscode";
import * as c2p from "vscode-languageclient/lib/common/codeConverter";
import * as p2c from "vscode-languageclient/lib/common/protocolConverter";
import { fsPath } from "../../shared/utils/fs";

export class LspUriConverters implements LspConverters {
	constructor(private readonly normalizeFileCasing: boolean) { }

	public code2Protocol(uri: vs.Uri): string {
		// VS Code lowercases drive letters in Uris (even if they're not file scheme!) so we need to replace in the outbound URI too until the
		// server is case-insensitive for drive letters.
		if (uri.scheme === "file")
			uri = vs.Uri.file(fsPath(uri, { useRealCasing: this.normalizeFileCasing }));

		const uriString = uri.toString();
		return uriString.replace(/^([\w+-.]+):(\/\/\w*)?\/(\w)(:|%3A)\//, (match, scheme, authority, driveLetter, colon) => `${scheme}:${authority ?? ""}/${driveLetter.toUpperCase()}${colon}/`);
	}

	public protocol2Code(file: string): vs.Uri {
		return vs.Uri.parse(file);
	}
}

interface LspConverters {
	code2Protocol: c2p.URIConverter;
	protocol2Code: p2c.URIConverter;
}

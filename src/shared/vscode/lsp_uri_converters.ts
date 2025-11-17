import * as vs from "vscode";
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
	code2Protocol(value: vs.Uri): string;
	protocol2Code(value: string): vs.Uri;
}

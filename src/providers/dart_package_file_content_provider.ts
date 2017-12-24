"use strict";

import * as fs from "fs";
import { TextDocumentContentProvider, Uri, CancellationToken } from "vscode";

export class DartPackageFileContentProvider implements TextDocumentContentProvider {
	public provideTextDocumentContent(uri: Uri, token: CancellationToken): string {
		return fs.readFileSync(uri.fsPath).toString();
	}
}

import * as fs from "fs";
import { URL } from "url";
import * as vs from "vscode";
import { CodeActionKind, env as vsEnv, ExtensionKind, extensions, Position, Range, Selection, TextDocument, TextEditor, TextEditorRevealType, Uri, workspace, WorkspaceFolder } from "vscode";
import * as lsp from "vscode-languageclient";
import { dartCodeExtensionIdentifier } from "../constants";
import { Location, Logger } from "../interfaces";
import { nullLogger } from "../logging";
import { notUndefined } from "../utils";
import { forceWindowsDriveLetterToUppercase } from "../utils/fs";

export const SourceSortMembersCodeActionKind = CodeActionKind.Source.append("sortMembers");

const dartExtension = extensions.getExtension(dartCodeExtensionIdentifier);
// The extension kind is declared as Workspace, but VS Code will return UI in the
// case that there is no remote extension host.
export const isRunningLocally = !dartExtension || dartExtension.extensionKind === ExtensionKind.UI;

export function getDartWorkspaceFolders(): WorkspaceFolder[] {
	if (!workspace.workspaceFolders)
		return [];
	return workspace.workspaceFolders.filter(isDartWorkspaceFolder);
}

export function isDartWorkspaceFolder(folder?: WorkspaceFolder): boolean {
	if (!folder || folder.uri.scheme !== "file")
		return false;

	// Currently we don't have good logic to know what's a Dart folder.
	// We could require a pubspec, but it's valid to just write scripts without them.
	// For now, nothing calls this that will do bad things if the folder isn't a Dart
	// project so we can review amend this in future if required.
	return true;
}

export function toRange(document: TextDocument, offset: number, length: number): Range {
	return new Range(document.positionAt(offset), document.positionAt(offset + length));
}

export function lspToRange(range: lsp.Range): Range {
	return new Range(lspToPosition(range.start), lspToPosition(range.end));
}

export function toPosition(location: Location): Position {
	return new Position(location.startLine - 1, location.startColumn - 1);
}

export function lspToPosition(position: lsp.Position): Position {
	return new Position(position.line, position.character);
}

// Translates an offset/length to a Range.
// NOTE: Does not wrap lines because it does not have access to a TextDocument to know
// where the line ends.
export function toRangeOnLine(location: Location): Range {
	const startPos = toPosition(location);
	return new Range(startPos, startPos.translate(0, location.length));
}

export function showCode(editor: TextEditor, displayRange: Range, highlightRange: Range, selectionRange?: Range): void {
	if (selectionRange)
		editor.selection = new Selection(selectionRange.start, selectionRange.end);

	// Ensure the code is visible on screen.
	editor.revealRange(displayRange, TextEditorRevealType.InCenterIfOutsideViewport);

	// TODO: Implement highlighting
	// See https://github.com/Microsoft/vscode/issues/45059
}

export function trimTrailingSlashes(s: string) {
	return s.replace(/[\/\\]+$/, "");
}

export function warnIfPathCaseMismatch(logger: Logger, p: string, pathDescription: string, helpText: string) {
	const userPath = trimTrailingSlashes(forceWindowsDriveLetterToUppercase(p));
	const realPath = fs.existsSync(userPath) && trimTrailingSlashes(forceWindowsDriveLetterToUppercase(fs.realpathSync.native(userPath)));
	// Since realpathSync.native will resolve symlinks, we'll only show these warnings
	// when there was no symlink (eg. the lowercase version of both paths match).
	if (userPath && realPath && userPath.toLowerCase() === realPath.toLowerCase() && userPath !== realPath) {
		const message = `The casing of ${pathDescription} does not match the casing on disk; please ${helpText}. `
			+ `Expected ${realPath} but got ${userPath}`;
		logger.warn(message);
		vs.window.showWarningMessage(message);
		return true;
	}
	return false;
}

class EnvUtils {
	public async openInBrowser(url: string, logger: Logger = nullLogger): Promise<boolean> {
		logger.info(`Opening external URL: ${url}`);
		return vsEnv.openExternal(Uri.parse(url));
	}

	public async exposeUrl(uri: vs.Uri, logger: Logger = nullLogger): Promise<string> {
		logger.info(`Exposing URL: ${uri.toString()}`);
		const isWebSocket = uri.scheme === "ws" || uri.scheme === "wss";
		const isSecure = uri.scheme === "wss" || uri.scheme === "https";

		// TODO: Remove this scheme mapping when https://github.com/microsoft/vscode/issues/84819
		// is resolved.
		let fakeScheme = uri.scheme;
		if (isWebSocket)
			fakeScheme = isSecure ? "https" : "http";

		const url = new URL(uriToString(uri));
		let fakeAuthority = uri.authority;
		if (!url.port)
			fakeAuthority = `${url.hostname}:${isSecure ? "443" : "80"}`;

		const uriToMap = uri.with({ scheme: fakeScheme, authority: fakeAuthority });
		logger.info(`Mapping URL: ${uriToMap.toString()}`);

		const mappedUri = await vsEnv.asExternalUri(uriToMap);
		logger.info(`Mapped URL: ${mappedUri.toString()}`);

		// Now we need to map the scheme back to WS if that's what was originally asked for, however
		// we need to take into account whether asExternalUri pushed is up to secure, so use
		// the http/https to decide which to go back to.
		let newScheme = mappedUri.scheme;
		if (isWebSocket)
			// Note: We use mappedUri.scheme here and not isSecure because we
			// care if the *exposed* URI is secure.
			newScheme = mappedUri.scheme === "https" ? "wss" : "ws";

		const finalUri = uriToString(mappedUri.with({ scheme: newScheme }));
		logger.info(`Final URI: ${finalUri}`);

		const finalUrl = new URL(finalUri).toString();
		logger.info(`Final URL: ${finalUrl}`);

		return finalUrl;
	}
}

function uriToString(uri: vs.Uri) {
	return uri.toString()
		.replace(/%24/g, "$")
		.replace(/%5B/g, "[");
}

export const envUtils = new EnvUtils();

function usedEditorColumns(): Set<number> {
	return new Set(vs.window.visibleTextEditors.map((e) => e.viewColumn as number | undefined).filter(notUndefined));
}

export function firstNonEditorColumn(): vs.ViewColumn | undefined {
	const usedColumns = usedEditorColumns();
	for (let i = 1; i <= 9; i++) {
		if (!usedColumns.has(i))
			return i;
	}
}

export function firstEditorColumn(): vs.ViewColumn | undefined {
	const usedColumns = usedEditorColumns();
	for (let i = 1; i <= 9; i++) {
		if (usedColumns.has(i))
			return i;
	}
}

import * as fs from "fs";
import * as path from "path";
import { URL } from "url";
import * as vs from "vscode";
import { CodeActionKind, ExtensionKind, Position, Range, Selection, TextDocument, TextEditor, TextEditorRevealType, Uri, WorkspaceFolder, extensions, env as vsEnv, workspace } from "vscode";
import * as lsp from "vscode-languageclient";
import * as YAML from "yaml";
import { dartCodeExtensionIdentifier, projectSearchCacheTimeInMs, projectSearchProgressNotificationDelayInMs, projectSearchProgressText } from "../constants";
import { EventEmitter } from "../events";
import { Location, Logger } from "../interfaces";
import { nullLogger } from "../logging";
import { PromiseCompleter, flatMap, notUndefined } from "../utils";
import { SimpleTimeBasedCache } from "../utils/cache";
import { findProjectFolders, forceWindowsDriveLetterToUppercase, fsPath, isWithinPathOrEqual } from "../utils/fs";
import { isKnownCloudIde } from "./utils_cloud";

export const SourceSortMembersCodeActionKind = CodeActionKind.Source.append("sortMembers");

const dartExtension = extensions.getExtension(dartCodeExtensionIdentifier);
export const hostKind = getHostKind();

export interface ProjectFolderSearchResults { projectFolders: string[], excludedFolders: Set<string> };

const projectFolderCache = new SimpleTimeBasedCache<ProjectFolderSearchResults>();
let inProgressProjectFolderSearch: Promise<void> | undefined;

// The extension kind is declared as Workspace, but VS Code will return UI in the
// case that there is no remote extension host.
export const isRunningLocally =
	// Some cloud IDEs mis-report the extension kind, so if we _know_ something is a cloud IDE,
	// override that.
	!isKnownCloudIde(vs.env.appName)
	&& (!dartExtension || dartExtension.extensionKind === ExtensionKind.UI);

export function getDartWorkspaceFolders(): WorkspaceFolder[] {
	if (!workspace.workspaceFolders)
		return [];
	return workspace.workspaceFolders.filter(isDartWorkspaceFolder);
}

function getAnalysisOptionsExcludedFolders(
	logger: Logger,
	projectFolders: string[],
): string[] {
	const results: string[] = [];
	for (const projectFolder of projectFolders) {
		const analysisOptionsPath = path.join(projectFolder, "analysis_options.yaml");
		try {
			const analysisOptionsContent = fs.readFileSync(analysisOptionsPath);
			const yaml = YAML.parse(analysisOptionsContent.toString());
			const excluded = yaml?.analyzer?.exclude;
			if (excluded && Array.isArray(excluded)) {
				for (let exclude of excluded as string[]) {
					// Only exclude an entire folder if the /** is at the end. If it's
					// something like foo/**/*.generated.* then it does not exclude
					// everything in foo.
					if (exclude.endsWith("/**"))
						exclude = exclude.substring(0, exclude.length - 3);

					// Handle relative paths.
					if (!exclude.startsWith("/"))
						exclude = path.join(projectFolder, exclude);

					// Now, if no wildcards remain in the path, we can use it as an exclusion.
					if (!exclude.includes("*"))
						results.push(exclude);
				}
			}
		} catch (e: any) {
			if (e?.code !== "ENOENT") // Don't warn for missing files.
				logger.error(`Failed to read ${analysisOptionsPath}: ${e}`);
		}
	}
	return results;
}

export class ProjectFinder {
	constructor(private readonly logger: Logger) { }

	public async findAllProjectFolders(
		getExcludedFolders: ((f: WorkspaceFolder | undefined) => string[]) | undefined,
		options: { sort?: boolean; requirePubspec?: boolean, searchDepth: number, workspaceFolders?: WorkspaceFolder[], onlyWorkspaceRoots?: boolean },
	) {
		return getAllProjectFolders(this.logger, getExcludedFolders, options);
	}
}

export async function getAllProjectFolders(
	logger: Logger,
	getExcludedFolders: ((f: WorkspaceFolder | undefined) => string[]) | undefined,
	options: { sort?: boolean; requirePubspec?: boolean, searchDepth: number, workspaceFolders?: WorkspaceFolder[], onlyWorkspaceRoots?: boolean },
) {
	const results = await getAllProjectFoldersAndExclusions(logger, getExcludedFolders, options);
	return results.projectFolders;
}

export async function getAllProjectFoldersAndExclusions(
	logger: Logger,
	getExcludedFolders: ((f: WorkspaceFolder | undefined) => string[]) | undefined,
	options: { sort?: boolean; requirePubspec?: boolean, searchDepth: number, workspaceFolders?: WorkspaceFolder[], onlyWorkspaceRoots?: boolean },
): Promise<ProjectFolderSearchResults> {
	const workspaceFolders = options.workspaceFolders ?? getDartWorkspaceFolders();

	// If an existing search is in progress, wait because it might populate the cache with the results
	// we want.
	if (inProgressProjectFolderSearch) {
		await inProgressProjectFolderSearch;
	}

	const cacheKey = `folders_${workspaceFolders.map((f) => f.uri.toString()).join(path.sep)}_${!!options.sort}_${!!options.onlyWorkspaceRoots}`;
	const cachedFolders = projectFolderCache.get(cacheKey);
	if (cachedFolders) {
		logger.info(`Returning cached results for project search`);
		return cachedFolders;
	}

	// Track this search so other searches can wait on it.
	const completer = new PromiseCompleter<void>();
	inProgressProjectFolderSearch = completer.promise;
	try {
		let startTimeMs = new Date().getTime();
		const tokenSource = new vs.CancellationTokenSource();
		let isComplete = false;

		const topLevelFolders = workspaceFolders.map((w) => fsPath(w.uri));
		let allExcludedFolders = getExcludedFolders ? flatMap(workspaceFolders, getExcludedFolders) : [];
		const resultsPromise = findProjectFolders(logger, topLevelFolders, allExcludedFolders, options, tokenSource.token);

		// After some time, if we still have not completed, show a progress notification that can be cancelled
		// to stop the search, which automatically hides when `resultsPromise` resolves.
		setTimeout(() => {
			if (!isComplete) {
				void vs.window.withProgress({
					cancellable: true,
					location: vs.ProgressLocation.Notification,
					title: projectSearchProgressText,
				}, (progress, token) => {
					token.onCancellationRequested(() => {
						tokenSource.cancel();
						logger.info(`Project search was cancelled after ${new Date().getTime() - startTimeMs}ms (was searching ${options.searchDepth} levels)`);
					});
					return resultsPromise;
				});
			}
		}, projectSearchProgressNotificationDelayInMs);

		let projectFolders = await resultsPromise;
		isComplete = true;
		logger.info(`Took ${new Date().getTime() - startTimeMs}ms to search for projects (${options.searchDepth} levels)`);
		startTimeMs = new Date().getTime();

		// Filter out any folders excluded by analysis_options.
		try {
			const excludedFolders = getAnalysisOptionsExcludedFolders(logger, projectFolders);
			projectFolders = projectFolders.filter((p) => !excludedFolders.find((ex) => isWithinPathOrEqual(p, ex)));
			logger.info(`Took ${new Date().getTime() - startTimeMs}ms to filter out excluded projects (${excludedFolders.length} exclusion rules)`);

			allExcludedFolders = allExcludedFolders.concat(excludedFolders);
		} catch (e) {
			logger.error(`Failed to filter out analysis_options exclusions: ${e}`);
		}

		const result = { projectFolders, excludedFolders: new Set(allExcludedFolders) };

		// Cache the results.
		projectFolderCache.add(cacheKey, result, projectSearchCacheTimeInMs);

		return result;
	} finally {
		// Clear the promise if it's still ours.
		completer.resolve();
		if (inProgressProjectFolderSearch === completer.promise)
			inProgressProjectFolderSearch = undefined;
	}
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
		void vs.window.showWarningMessage(message);
		return true;
	}
	return false;
}

class EnvUtils {
	public async openInBrowser(url: string, logger: Logger = nullLogger): Promise<boolean> {
		logger.info(`Opening external URL: ${url}`);
		return vsEnv.openExternal(Uri.parse(url));
	}

	public async exposeUrl(urlString: string, logger: Logger = nullLogger): Promise<string> {
		const uri = vs.Uri.parse(urlString, true);
		logger.info(`Exposing URL: ${uri.toString()}`);
		const isWebSocket = uri.scheme === "ws" || uri.scheme === "wss";
		const isSecure = uri.scheme === "wss" || uri.scheme === "https";

		// TODO: Remove this scheme mapping when https://github.com/microsoft/vscode/issues/84819
		// is resolved.
		let fakeScheme = uri.scheme;
		if (isWebSocket)
			fakeScheme = isSecure ? "https" : "http";

		const url = new URL(urlString);

		// Ensure the URL always has a port, as some cloud providers fail to expose URLs correctly
		// that don't have explicit port numbers.
		//
		// Additionally, on some cloud providers we get an IPv6 loopback which fails to connect
		// correctly. Assume that if we get this, it's safe to use the "localhost" hostname.
		const fakeHostname = url.hostname === "[::]" ? "localhost" : url.hostname;
		const fakePort = url.port || (isSecure ? "443" : "80"); // Don't change to ??, port can be empty string!
		const fakeAuthority = `${fakeHostname}:${fakePort}`;

		const uriToMap = uri.with({ scheme: fakeScheme, authority: fakeAuthority });
		logger.info(`Mapping URI: ${uriToMap.toString()}`);

		const mappedUri = await vsEnv.asExternalUri(uriToMap);
		logger.info(`Mapped URI: ${mappedUri.toString()}`);

		// Now we need to map the scheme back to WS if that's what was originally asked for, however
		// we need to take into account whether asExternalUri pushed is up to secure, so use
		// the http/https to decide which to go back to.
		let newScheme = mappedUri.scheme;
		if (isWebSocket)
			// Note: We use mappedUri.scheme here and not isSecure because we
			// care if the *exposed* URI is secure.
			newScheme = mappedUri.scheme === "https" ? "wss" : "ws";

		const mappedUrl = new URL(uriToString(mappedUri));
		logger.info(`Mapped URL: ${mappedUrl}`);

		// Copy the important (mapped) parts back onto the original URL, preserving
		// the path/querystring that was not messed with by VS Code's Uri class.
		url.protocol = newScheme;
		url.host = mappedUrl.host;
		url.port = mappedUrl.port;
		logger.info(`Final URL: ${url}`);

		return url.toString();
	}
}

function uriToString(uri: vs.Uri) {
	return uri.toString()
		.replace(/%24/g, "$")
		.replace(/%5B/g, "[");
}

export function treeLabel(item: vs.TreeItem): string | undefined {
	if (!item.label || typeof item.label === "string")
		return item.label;
	return item.label.label;
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

export function createWatcher(pattern: string, emitter: EventEmitter<vs.Uri | void>) {
	const watcher = vs.workspace.createFileSystemWatcher(pattern);
	watcher.onDidChange((uri) => emitter.fire(uri));
	watcher.onDidCreate((uri) => emitter.fire(uri));
	watcher.onDidDelete((uri) => emitter.fire(uri));
	return watcher;
}

function getHostKind(): string | undefined {
	return buildHostKind(vs.env);
}


/// Builds a string for analytics/logging purposes that describes the environment that the extension is running in.
///
/// appName is passed only to detect cloud IDEs and is not part of the string, since that is reported separately.
///
/// The returned string is essentially `$appHost-$remoteName` but with some cleanup to avoid redundant or duplicated values, and to
/// shorten domains to top-levels.
export function buildHostKind({ appName, appHost, remoteName }: { appName?: string, appHost?: string, remoteName?: string }): string | undefined {
	const topLevelDomainRegex = new RegExp(".*\\.(.*\\..*)$");
	const withoutNumbersRegex = new RegExp("(.*?)[\\d.\\-:]*$");
	const regexes = [topLevelDomainRegex, withoutNumbersRegex];

	// Fix any known cloud IDEs incorrectly using the default "desktop" value.
	if (isKnownCloudIde(appName) && appHost === "desktop")
		appHost = "web";

	// Assume desktop by default.
	if (appHost === "desktop")
		appHost = undefined;

	/// Clean up domains to only top level domains without ports and no
	/// local domains.
	function cleanString(input: string | undefined): string | undefined {
		if (!input)
			return input;

		for (const regex of regexes) {
			const match = regex.exec(input);
			if (match)
				input = match[1];
		}

		if (input.endsWith(".local") || input.endsWith("localhost")) {
			input = undefined;
		}

		return input;
	}

	remoteName = cleanString(remoteName);
	appHost = cleanString(appHost);

	// There are a lot of uses of "server-distro" that have domains suffixed.
	// We don't care too much about the specific domains for these, we should
	// just group them all as "server-distro".
	if (appHost?.startsWith("server-distro") || remoteName?.startsWith("server-distro"))
		return "server-distro";

	if (appHost && remoteName && appHost !== remoteName)
		return `${appHost}-${remoteName}`;
	else if (appHost)
		return appHost;
	else if (remoteName)
		return remoteName;
	else
		return undefined;
}

import * as fs from "fs";
import * as https from "https";
import * as os from "os";
import * as path from "path";
import * as semver from "semver";
import { commands, env as vsEnv, Range, Position, TextDocument, Uri, workspace, WorkspaceFolder, window } from "vscode";
import * as as from "./analysis/analysis_server_types";
import { config } from "./config";
import { referencesFlutterSdk } from "./sdk/utils";

export const extensionVersion = getExtensionVersion();
export const isDevExtension = checkIsDevExtension();
export const FLUTTER_CREATE_PROJECT_TRIGGER_FILE = "dart_code_flutter_create.dart";

export function isFlutterWorkspaceFolder(folder: WorkspaceFolder): boolean {
	return isDartWorkspaceFolder(folder) && isFlutterProjectFolder(folder.uri.fsPath);
}

export function isFlutterProjectFolder(folder: string): boolean {
	return referencesFlutterSdk(folder);
}

export function getDartWorkspaceFolders(): WorkspaceFolder[] {
	if (!workspace.workspaceFolders)
		return [];
	return workspace.workspaceFolders.filter(isDartWorkspaceFolder);
}

export function isDartWorkspaceFolder(folder: WorkspaceFolder): boolean {
	if (!folder || folder.uri.scheme !== "file")
		return false;

	// TODO: Filter to only Dart projects.
	return true;
}

export function resolveHomePath(p: string) {
	if (p == null) return null;
	if (p.startsWith("~/"))
		return path.join(os.homedir(), p.substr(2));
	return p;
}

export interface Location {
	startLine: number;
	startColumn: number;
	length: number;
}

export function toPosition(location: Location): Position {
	return new Position(location.startLine - 1, location.startColumn - 1);
}

export function toRange(location: Location): Range {
	const startPos = toPosition(location);
	// TODO: Is this translation valid? Does it wrap lines correctly?
	return new Range(startPos, startPos.translate(0, location.length));
}

export function getSdkVersion(sdkRoot: string): string {
	if (!sdkRoot)
		return null;
	try {
		return fs
			.readFileSync(path.join(sdkRoot, "version"), "utf8")
			.trim()
			.split("\n")
			.filter((l) => l)
			.filter((l) => l.trim().substr(0, 1) !== "#")
			.join("\n")
			.trim();
	} catch (e) {
		return null;
	}
}

export function isAnalyzable(document: TextDocument): boolean {
	if (document.isUntitled || !document.fileName)
		return false;

	const analyzableLanguages = ["dart", "html"];
	const analyzableFilenames = [".analysis_options", "analysis_options.yaml"];

	return analyzableLanguages.indexOf(document.languageId) >= 0
		|| analyzableFilenames.indexOf(path.basename(document.fileName)) >= 0;
}

export function isAnalyzableAndInWorkspace(document: TextDocument): boolean {
	if (document.isUntitled || !document.fileName)
		return false;

	return isAnalyzable(document) && isWithinWorkspace(document.fileName);
}

export function isWithinWorkspace(file: string) {
	// TODO: Is this fixed?
	// asRelativePath returns the input if it's outside of the rootPath.
	// Edit: Doesn't actually work properly:
	//   https://github.com/Microsoft/vscode/issues/10446
	// return workspace.asRelativePath(document.fileName) != document.fileName;
	// Edit: Still doesn't work properly!
	//   https://github.com/Microsoft/vscode/issues/33709

	return !!workspace.getWorkspaceFolder(Uri.file(file));
}

export function isTestFile(file: string): boolean {
	return isInsideFolderNamed(file, "test");
}

export function isInsideFolderNamed(file: string, folderName: string): boolean {
	if (!file)
		return false;

	if (!file.toLowerCase().endsWith(".dart"))
		return false;

	const ws = workspace.getWorkspaceFolder(Uri.file(file));

	if (!ws)
		return false;

	const relPath = path.sep + path.relative(ws.uri.fsPath, file);

	// We only want to check the relative path from the workspace root so that if the whole project is inside a
	// test (etc.) folder (for ex. Dart Code's own tests) we don't falsely assume it's an end user test.
	return relPath.toLowerCase().indexOf(`${path.sep}${folderName}${path.sep}`) !== -1;
}

function getExtensionVersion(): string {
	const packageJson = require("../../package.json");
	return packageJson.version;
}

export function versionIsAtLeast(inputVersion: string, requiredVersion: string): boolean {
	return semver.gte(inputVersion, requiredVersion);
}

function checkIsDevExtension() {
	return extensionVersion.endsWith("-dev") || vsEnv.machineId === "someValue.machineId";
}

export function isStableSdk(sdkVersion: string): boolean {
	// We'll consider empty versions as dev; stable versions will likely always
	// be shipped with valid version files.
	return !!(sdkVersion && !semver.prerelease(sdkVersion));
}

export function logError(error: { message: string }): void {
	if (isDevExtension)
		window.showErrorMessage("DEBUG: " + error.message);
	console.error(error.message);
}

export function getLatestSdkVersion(): PromiseLike<string> {
	return new Promise<string>((resolve, reject) => {
		const options: https.RequestOptions = {
			hostname: "storage.googleapis.com",
			method: "GET",
			path: "/dart-archive/channels/stable/release/latest/VERSION",
			port: 443,
		};

		const req = https.request(options, (resp) => {
			if (resp.statusCode < 200 || resp.statusCode > 300) {
				reject({ message: `Failed to get Dart SDK Version ${resp.statusCode}: ${resp.statusMessage}` });
			} else {
				resp.on("data", (d) => {
					resolve(JSON.parse(d.toString()).version);
				});
			}
		});
		req.end();
	});
}

export function escapeRegExp(input: string) {
	// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}

export function openInBrowser(url: string) {
	commands.executeCommand("vscode.open", Uri.parse(url));
}

export class Sdks {
	public dart: string;
	public flutter: string;
	public fuchsia: string;
	public projectType: ProjectType;
}

export enum ProjectType {
	Dart,
	Flutter,
	Fuchsia,
}

export async function reloadExtension(prompt?: string, buttonText?: string) {
	const restartAction = buttonText || "Restart";
	if (!prompt || await window.showInformationMessage(prompt, restartAction) === restartAction) {
		commands.executeCommand("_dart.reloadExtension");
	}
}

export function unique<T>(items: T[]): T[] {
	return Array.from(new Set(items));
}

const shouldLogTimings = false;
const start = process.hrtime();
let last = start;
function pad(str: string, length: number) {
	while (str.length < length)
		str = "0" + str;
	return str;
}
export const logTime = (taskFinished?: string) => {
	if (!shouldLogTimings)
		return;
	const diff = process.hrtime(start);
	console.log(`${pad((diff[0] - last[0]).toString(), 5)}.${pad((diff[1] - last[1]).toString(), 10)} ${taskFinished ? "<== " + taskFinished : ""}`);
	last = diff;
};

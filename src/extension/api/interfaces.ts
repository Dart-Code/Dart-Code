import * as vs from "vscode";
import { SpawnedProcess } from "../../shared/interfaces";

export interface PublicDartExtensionApi {
	/**
	 * The current version of the public API.
	 */
	readonly version: number;

	/**
	 * The currently detected Dart and Flutter SDK paths and versions.
	 */
	readonly sdks: PublicSdks;

	/**
	 * An event that fires when the detected SDKs change. This may happen if the
	 * user changes their configuration, for example.
	 *
	 * An event does not necessarily mean the SDK paths have changed, only that they _might_ have.
	 */
	readonly onSdksChanged: vs.Event<PublicSdks>;

	/**
	 * The current Dart Tooling Daemon (DTD) URI, if available.
	 */
	readonly dtdUri: string | undefined;

	/**
	 * An event that fires when the DTD URI changes.
	 *
	 * An event does not necessarily mean the URI has changed, only that it _might_ have.
	 */
	readonly onDtdUriChanged: vs.Event<string | undefined>;

	/**
	 * APIs related to the project(s) open in the workspace.
	 */
	readonly workspace: PublicWorkspace;

	/**
	 * APIs related to the SDK.
	 */
	readonly sdk: PublicSdk;
}

export interface PublicWorkspace {
	/**
	 * Gets the current outline for a document.
	 *
	 * Will wait for a short period if no outline is available yet.
	 */
	getOutline(document: vs.TextDocument, token?: vs.CancellationToken): Promise<PublicOutline | undefined>;

	/**
	 * Finds all project folders in the workspace.
	 *
	 * This searches for Dart/Flutter project folders by looking for pubspec.yaml files
	 * and applies any configured exclusions. Will only walk down the tree as far as the
	 * user has configured with `projectSearchDepth`.
	 */
	findProjectFolders(): Promise<string[]>;
}

export interface PublicOutline {
	/**
	 * The element information for this outline node.
	 */
	readonly element: PublicElement;

	/**
	 * The range that represents the entire outline element including its body.
	 */
	readonly range: vs.Range;

	/**
	 * The range that represents just the code portion of the element.
	 */
	readonly codeRange: vs.Range;

	/**
	 * Child outline elements, if any.
	 */
	readonly children: PublicOutline[] | undefined;
}

export interface PublicElement {
	/**
	 * The element's name.
	 */
	readonly name: string;

	/**
	 * The range of the element's name.
	 */
	readonly range: vs.Range | undefined;

	/**
	 * The kind of element (e.g., "CLASS", "METHOD", "FUNCTION").
	 */
	readonly kind: string;

	/**
	 * The parameters of the element, if applicable.
	 */
	readonly parameters?: string;

	/**
	 * The type parameters of the element, if applicable.
	 */
	readonly typeParameters?: string;

	/**
	 * The return type of the element, if applicable.
	 */
	readonly returnType?: string;
}

export interface PublicSdks {
	/**
	 * The absolute path to the Dart SDK folder, if detected.
	 */
	readonly dart?: string;

	/**
	 * The Dart SDK version string, as read from the Dart SDK's version file.
	 */
	readonly dartVersion?: string;

	/**
	 * The absolute path to the Flutter SDK folder, if detected.
	 */
	readonly flutter?: string;

	/**
	 * The Flutter SDK version string, as read from the Flutter SDK's version file.
	 */
	readonly flutterVersion?: string;
}

export interface PublicSdk {
	/**
	 * Runs a Dart command in the specified folder.
	 *
	 * A toast notification may be shown to the user while this command runs. It is intended for
	 * small user-initiated commands that would be expected by the user.
	 *
	 * If there is already a running command of the same kind with the same args, will return `undefined`.
	 */
	runDart(folder: string, args: string[], options?: PublicRunOptions): Promise<PublicRunResult | undefined>;

	/**
	 * Runs a pub command in the specified folder.
	 *
	 * A toast notification may be shown to the user while this command runs. It is intended for
	 * small user-initiated commands that would be expected by the user.
	 *
	 * If there is already a running command of the same kind with the same args, will return `undefined`.
	 */
	runPub(folder: string, args: string[], options?: PublicRunOptions): Promise<PublicRunResult | undefined>;

	/**
	 * Starts running a background Dart command in the specified folder.
	 *
	 * This is just a convenience wrapper around `child_process.spawn()` that handles using the correct SDK path
	 * and argument escaping. It is up to the client to handle stdout/stderr/stdin for this process, as well as
	 * terminating it once it is done with (or when the extension deactivates).
	 */
	startDart(folder: string, args: string[], options?: PublicRunOptions): Promise<PublicStartResult | undefined>;
}

export interface PublicRunOptions {
	/**
	 * Whether to always show the output channel.
	 *
	 * If false or undefined, the output will only be shown if the command fails or takes longer than 10 seconds.
	 */
	alwaysShowOutput?: boolean;
}

export interface PublicRunResult {
	/**
	 * The stdout text from the command.
	 */
	stdout: string;

	/**
	 * The stderr text from the command.
	 */
	stderr: string;

	/**
	 * The exit code of the command.
	 */
	exitCode: number;
}

export type PublicStartResult = SpawnedProcess;

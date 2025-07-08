import * as vs from "vscode";

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

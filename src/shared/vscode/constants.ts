import { DocumentFilter, DocumentSelector, env, version as vsVersion } from "vscode";
import { extensionVersion } from "./extension_utils";
import { hostKind } from "./utils";

export const DART_LANGUAGE = "dart";
export const DART_MODE: DocumentFilter[] = [
	{ language: DART_LANGUAGE, scheme: "file" },
];
const PUBSPEC_FILTER: DocumentFilter = { pattern: "**/pubspec.yaml", scheme: "file" };
const ANALYSIS_OPTIONS_FILTER: DocumentFilter = { pattern: "**/analysis_options.yaml", scheme: "file" };
export const ANALYSIS_FILTERS: DocumentSelector = [
	...DART_MODE,
	PUBSPEC_FILTER,
	ANALYSIS_OPTIONS_FILTER,
];

export const dashIdeName = env.appName;
export const dashIdeVersion = vsVersion;
export const dashIdeEnvironment = hostKind ?? "desktop";
export const dashPluginName = "Dart-Code";
export const dashPluginVersion = extensionVersion;
export const dashTool = "vscode-plugins";

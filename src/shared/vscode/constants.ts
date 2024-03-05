import { DocumentFilter, DocumentSelector } from "vscode";


export const DART_LANGUAGE = "dart";
export const DART_MODE: DocumentFilter[] = [
	{ language: DART_LANGUAGE, scheme: "file" },
	{ language: DART_LANGUAGE, scheme: "dart-macro+file" },
];
export const PUBSPEC_FILTER: DocumentFilter = { pattern: "**/pubspec.yaml", scheme: "file" };
export const ANALYSIS_OPTIONS_FILTER: DocumentFilter = { pattern: "**/analysis_options.yaml", scheme: "file" };
export const ANALYSIS_FILTERS: DocumentSelector = [
	...DART_MODE,
	PUBSPEC_FILTER,
	ANALYSIS_OPTIONS_FILTER,
];
export const HTML_MODE: DocumentFilter = { language: "html", scheme: "file" };

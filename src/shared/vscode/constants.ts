import { DocumentFilter } from "vscode";


export const DART_MODE: DocumentFilter & { language: string } = { language: "dart", scheme: "file" };
export const PUBSPEC_FILTER: DocumentFilter = { pattern: "**/pubspec.yaml", scheme: "file" };
export const ANALYSIS_OPTIONS_FILTER: DocumentFilter = { pattern: "**/analysis_options.yaml", scheme: "file" };
export const ANALYSIS_FILTERS = [
	DART_MODE,
	PUBSPEC_FILTER,
	ANALYSIS_OPTIONS_FILTER,
];
export const HTML_MODE: DocumentFilter = { language: "html", scheme: "file" };

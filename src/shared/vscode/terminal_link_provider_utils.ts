import * as vs from "vscode";

/** Builds a global multiline regex matching Dart URIs with a given prefix and optional line/column suffix. */
function createUriPattern(uriPrefix: string): RegExp {
	return new RegExp(`(?<uri>${uriPrefix}\\S+[\\/]\\S+\\.dart)(?:(?:[: ]| line )(?<line>\\d+)(?::(?<col>\\d+))?)?`, "mg");
}

const fileUriPattern = createUriPattern("file:\\/{3}");
const packageUriPattern = createUriPattern("package:");

/** Finds all URI links matching `pattern` in `content` and maps valid parsed URIs using `createLink`. */
function findUriLinks<T>(content: string, pattern: RegExp, createLink: (base: DartUriLinkBase, parsedUri: vs.Uri, rawUri: string) => T | undefined): T[] {
	const results: T[] = [];
	pattern.lastIndex = 0;
	let result: RegExpExecArray | null;
	while ((result = pattern.exec(content)) && result.groups) {
		const rawUri = result.groups.uri;
		let parsedUri: vs.Uri | undefined;
		try {
			parsedUri = vs.Uri.parse(rawUri, true);
		} catch {
			continue;
		}
		if (!parsedUri)
			continue;

		const link = createLink(
			{
				col: result.groups.col ? parseInt(result.groups.col, 10) : undefined,
				length: result[0].length,
				line: result.groups.line ? parseInt(result.groups.line, 10) : undefined,
				startIndex: result.index,
				tooltip: "Open file in editor",
			},
			parsedUri,
			rawUri,
		);
		if (link)
			results.push(link);
	}

	return results;
}

export function findPackageUriLinks(content: string, isKnownPackage: (packageName: string) => boolean): DartPackageUriLink[] {
	return findUriLinks(content, packageUriPattern, (base, parsedUri, rawUri) => {
		const packageName = parsedUri.path.split("/")[0];
		if (!isKnownPackage(packageName))
			return undefined;

		return {
			...base,
			packageName,
			uri: rawUri,
		};
	});
}

export function findFileUriLinks(lineContent: string): DartFileUriLink[] {
	return findUriLinks(lineContent, fileUriPattern, (base, parsedUri) => ({
		...base,
		uri: parsedUri,
	}));
}

export function formatLineColFragment(link: { line: number | undefined, col: number | undefined }) {
	if (link.line !== undefined && link.col !== undefined)
		return `${link.line},${link.col}`;
	else if (link.line !== undefined)
		return `${link.line}`;
	else
		return "";
}

/** Shared location metadata for a Dart URI link matched in terminal or document text. */
export interface DartUriLinkBase {
	startIndex: number;
	length: number;
	tooltip: string;
	line: number | undefined;
	col: number | undefined;
}

export interface DartFileUriLink extends DartUriLinkBase {
	uri: vs.Uri;
}

export interface DartPackageUriLink extends DartUriLinkBase {
	packageName: string;
	uri: string;
}

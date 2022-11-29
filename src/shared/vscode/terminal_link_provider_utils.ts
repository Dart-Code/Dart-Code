import * as vs from "vscode";

const fileUriPattern = new RegExp("(?<uri>file:\\/{3}\\S+[\\/]\\S+\\.dart)(?:(?:[: ]| line )(?<line>\\d+)(?::(?<col>\\d+))?)?", "mg");
const packageUriPattern = new RegExp("(?<uri>package:\\S+[\\/]\\S+\\.dart)(?:(?:[: ]| line )(?<line>\\d+)(?::(?<col>\\d+))?)?", "mg");

export async function findPackageUriLinks(content: string, isKnownPackage: (packageName: string) => boolean): Promise<DartPackageUriLink[]> {
	const results: DartPackageUriLink[] = [];
	packageUriPattern.lastIndex = -1;
	let result: RegExpExecArray | null;
	// tslint:disable-next-line: no-conditional-assignment
	while ((result = packageUriPattern.exec(content)) && result.groups) {
		let uri: vs.Uri | undefined;
		try {
			uri = vs.Uri.parse(result.groups.uri, true);
		} catch (e) {
			continue;
		}
		if (!uri)
			continue;

		const packageName = uri.path.split("/")[0];
		if (!isKnownPackage(packageName))
			continue;
		const line = result.groups.line ? parseInt(result.groups.line) : undefined;
		const col = result.groups.col ? parseInt(result.groups.col) : undefined;
		const startIndex = result.index;
		const length = result[0].length;

		results.push({
			col,
			length,
			line,
			packageName,
			startIndex,
			tooltip: "Open file in editor",
			uri: result.groups.uri,
		});
	}

	return results;
}

export async function findFileUriLinks(line: string): Promise<DartFileUriLink[]> {
	const results: DartFileUriLink[] = [];
	fileUriPattern.lastIndex = -1;
	let result: RegExpExecArray | null;
	// tslint:disable-next-line: no-conditional-assignment
	while ((result = fileUriPattern.exec(line)) && result.groups) {
		let uri: vs.Uri | undefined;
		try {
			uri = vs.Uri.parse(result.groups.uri, true);
		} catch (e) {
			continue;
		}
		if (!uri)
			continue;

		const line = result.groups.line ? parseInt(result.groups.line) : undefined;
		const col = result.groups.col ? parseInt(result.groups.col) : undefined;
		const startIndex = result.index;
		const length = result[0].length;

		results.push({
			col,
			length,
			line,
			startIndex,
			tooltip: "Open file in editor",
			uri,
		});
	}

	return results;
}

export function formatLineColFragment(link: { line: number | undefined, col: number | undefined }) {
	if (link.line !== undefined && link.col !== undefined)
		return `${link.line},${link.col}`;
	else if (!link.line !== undefined)
		return `${link.line}`;
	else
		return "";
}

export interface DartFileUriLink {
	startIndex: number;
	length: number;
	tooltip: string;
	uri: vs.Uri;
	line: number | undefined;
	col: number | undefined;
}


export interface DartPackageUriLink {
	startIndex: number;
	length: number;
	tooltip: string;
	packageName: string;
	uri: string;
	line: number | undefined;
	col: number | undefined;
}

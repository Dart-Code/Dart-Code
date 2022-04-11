import * as vs from "vscode";

const fileUriPattern = new RegExp("(?<uri>file:\\/{3}\\S+[\\/]\\S+\\.dart)(?:[: ](?<line>\\d+):(?<col>\\d+))?", "mg");
const packageUriPattern = new RegExp("(?<uri>package:\\S+[\\/]\\S+\\.dart)(?:[: ](?<line>\\d+):(?<col>\\d+))?", "mg");

export async function findPackageUriLinks(line: string, isKnownPackage: (packageName: string) => boolean): Promise<DartPackageUriTerminalLink[]> {
	const results: DartPackageUriTerminalLink[] = [];
	packageUriPattern.lastIndex = -1;
	let result: RegExpExecArray | null;
	// tslint:disable-next-line: no-conditional-assignment
	while ((result = packageUriPattern.exec(line)) && result.groups) {
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

export async function findFileUriLinks(line: string): Promise<DartFileUriTerminalLink[]> {
	const results: DartFileUriTerminalLink[] = [];
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


export interface DartFileUriTerminalLink extends vs.TerminalLink {
	startIndex: number;
	length: number;
	tooltip: string;
	uri: vs.Uri;
	line: number | undefined;
	col: number | undefined;
}


export interface DartPackageUriTerminalLink extends vs.TerminalLink {
	startIndex: number;
	length: number;
	tooltip: string;
	packageName: string;
	uri: string;
	line: number | undefined;
	col: number | undefined;
}

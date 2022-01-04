export const maxStackFrameMessageLength = 1000;
const containsStackFramePattern = new RegExp(`(?:dart:|package:|\\.dart)`);
const stackFramePattern = new RegExp(`\\(?(?:\\w+:)??((?:(?:dart:|package:)[\\w\\-]+\\/|file:\\/\\/(?:\\/?\\w:\\/)?)?[^\\s:'"]+\\.dart)(?:[: ](\\d+):(\\d+))?\\)*(.*)?$`, "m");
const linePattern = new RegExp(`line (\\d+)`);
const colPattern = new RegExp(`(?:col|pos) (\\d+)`);

export function mayContainStackFrame(message: string) {
	return containsStackFramePattern.test(message);
}

export function parseStackFrame(message: string): MessageWithUriData | undefined {
	// Messages over 1000 characters are unlikely to be stack frames, so short-cut
	// and assume no match.
	if (!message || message.length > maxStackFrameMessageLength)
		return undefined;

	const match = stackFramePattern.exec(message);
	if (match) {
		const prefix = message.substr(0, match.index).trim();
		const suffix = (match[4] || "").trim();
		let col = match[3] !== undefined ? parseInt(match[3]) : undefined;
		let line = match[2] !== undefined ? parseInt(match[2]) : undefined;

		// Handle some common line/col in text that are not in the usual format we can extract, for ex.
		//     Failed assertion: line ${line} pos ${col}
		if (!line) {
			const lineMatch = linePattern.exec(message);
			if (lineMatch)
				line = parseInt(lineMatch[1]);
		}
		if (!col) {
			const colMatch = colPattern.exec(message);
			if (colMatch)
				col = parseInt(colMatch[1]);
		}

		// Only consider this a stack frame if this has either a prefix or suffix, otherwise
		// it's likely just a printed filename or a line like "Launching lib/foo.dart on ...".
		const isStackFrame = !!prefix !== !!suffix;

		// Text should only be replaced if there was a line/col and only one of prefix/suffix, to avoid
		// replacing user prints of filenames or text like "Launching lib/foo.dart on Chrome".
		const textReplacement = (isStackFrame && line && col)
			? (prefix || suffix)
			: undefined;
		const text = `${textReplacement || message}`.trim();


		return {
			col,
			isStackFrame,
			line,
			sourceUri: match[1],
			text,
		} as MessageWithUriData;
	}
	return undefined;
}

export interface MessageWithUriData {
	col: number | undefined;
	isStackFrame: boolean;
	line: number | undefined;
	text: string;
	sourceUri: string;
}

export const maxStackFrameMessageLength = 1000;
const stackFramePattern = new RegExp(`\\(*(dart:[\\w\\-]+|\\S*\\.dart)(?:[: ](\\d+):(\\d+))?\\)*(\\s+.*)?$`, "m");

export function parseStackFrame(message: string): MessageWithUriData | undefined {
	// Messages over 1000 characters are unlikely to be stack frames, so short-cut
	// and assume no match.
	if (!message || message.length > maxStackFrameMessageLength)
		return undefined;

	const match = stackFramePattern.exec(message);
	if (match) {
		const prefix = message.substr(0, match.index);
		const suffix = match[4] || "";
		return {
			col: match[3] !== undefined ? parseInt(match[3]) : undefined,
			line: match[2] !== undefined ? parseInt(match[2]) : undefined,
			sourceUri: match[1],
			text: `${prefix} ${suffix}`.trim(),
		} as MessageWithUriData;
	}
	return undefined;
}

export interface MessageWithUriData {
	col: number | undefined;
	line: number | undefined;
	text: string;
	sourceUri: string;
}

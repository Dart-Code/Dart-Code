const codeReset = 0;
const codeFaint = 2;

const esc = (...code: Array<number | string>) => `\u001B[${code.join(";")}m`;
export const faint = (msg: string) => `${esc(codeFaint)}${msg}${esc(codeReset)}`;

const whitespacePattern = new RegExp(`^(\\s*)(\\S.*\\S)(\\s*)$`);

/// Applies a color function to a string, but leaves leading/trailing whitespace outside
/// of the color codes. This is mainly used because if trailing newlines fall inside the message
/// when sending OutputEvents() to VS Code, it won't allow source locations to be attached (since
/// they can only be attached to single-line messages).
export function applyColor(text: string, color: (text: string) => string) {
	const match = text && whitespacePattern.exec(text);
	if (!match)
		return color(text);

	return `${match[1]}${color(match[2])}${match[3]}`;
}

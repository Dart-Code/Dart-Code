const codeDefautForeground = 39;
const codeReset = 0;
const codeBold = 1;
const codeFaint = 2;
const brightOffset = 8;
const codeFg = "38;5";
const codeBg = "48;5";
const codeBlack = 0;
const codeRed = 1;
const codeGreen = 2;
const codeYellow = 3;
const codeBlue = 4;
const codeMagenta = 5;
const codeCyan = 6;
const codeWhite = 7;

const esc = (...code: Array<number | string>) => `\u001B[${code.join(";")}m`;
export const defaultForeground = (msg: string) => `${esc(codeDefautForeground)}${msg}${esc(codeReset)}`;
export const bold = (msg: string) => `${esc(codeBold)}${msg}${esc(codeReset)}`;
export const faint = (msg: string) => `${esc(codeFaint)}${msg}${esc(codeReset)}`;
export const black = (msg: string) => `${esc(codeFg, codeBlack)}${msg}${esc(codeReset)}`;
export const red = (msg: string) => `${esc(codeFg, codeRed)}${msg}${esc(codeReset)}`;
export const green = (msg: string) => `${esc(codeFg, codeGreen)}${msg}${esc(codeReset)}`;
export const yellow = (msg: string) => `${esc(codeFg, codeYellow)}${msg}${esc(codeReset)}`;
export const blue = (msg: string) => `${esc(codeFg, codeBlue)}${msg}${esc(codeReset)}`;
export const magenta = (msg: string) => `${esc(codeFg, codeMagenta)}${msg}${esc(codeReset)}`;
export const cyan = (msg: string) => `${esc(codeFg, codeCyan)}${msg}${esc(codeReset)}`;
export const white = (msg: string) => `${esc(codeFg, codeWhite)}${msg}${esc(codeReset)}`;
export const brightBlack = (msg: string) => `${esc(codeFg, codeBlack + brightOffset)}${msg}${esc(codeReset)}`;
export const brightRed = (msg: string) => `${esc(codeFg, codeRed + brightOffset)}${msg}${esc(codeReset)}`;
export const brightGreen = (msg: string) => `${esc(codeFg, codeGreen + brightOffset)}${msg}${esc(codeReset)}`;
export const brightYellow = (msg: string) => `${esc(codeFg, codeYellow + brightOffset)}${msg}${esc(codeReset)}`;
export const brightBlue = (msg: string) => `${esc(codeFg, codeBlue + brightOffset)}${msg}${esc(codeReset)}`;
export const brightMagenta = (msg: string) => `${esc(codeFg, codeMagenta + brightOffset)}${msg}${esc(codeReset)}`;
export const brightCyan = (msg: string) => `${esc(codeFg, codeCyan + brightOffset)}${msg}${esc(codeReset)}`;
export const brightWhite = (msg: string) => `${esc(codeFg, codeWhite + brightOffset)}${msg}${esc(codeReset)}`;
export const blackBackground = (msg: string) => `${esc(codeBg, codeBlack + brightOffset)}${msg}${esc(codeReset)}`;
export const redBackground = (msg: string) => `${esc(codeBg, codeRed)}${msg}${esc(codeReset)}`;
export const greenBackground = (msg: string) => `${esc(codeBg, codeGreen)}${msg}${esc(codeReset)}`;
export const yellowBackground = (msg: string) => `${esc(codeBg, codeYellow)}${msg}${esc(codeReset)}`;
export const blueBackground = (msg: string) => `${esc(codeBg, codeBlue)}${msg}${esc(codeReset)}`;
export const magentaBackground = (msg: string) => `${esc(codeBg, codeMagenta)}${msg}${esc(codeReset)}`;
export const cyanBackground = (msg: string) => `${esc(codeBg, codeCyan)}${msg}${esc(codeReset)}`;
export const whiteBackground = (msg: string) => `${esc(codeBg, codeWhite)}${msg}${esc(codeReset)}`;
export const brightBlackBackground = (msg: string) => `${esc(codeBg, codeBlack + brightOffset)}${msg}${esc(codeReset)}`;
export const brightRedBackground = (msg: string) => `${esc(codeBg, codeRed + brightOffset)}${msg}${esc(codeReset)}`;
export const brightGreenBackground = (msg: string) => `${esc(codeBg, codeGreen + brightOffset)}${msg}${esc(codeReset)}`;
export const brightYellowBackground = (msg: string) => `${esc(codeBg, codeYellow + brightOffset)}${msg}${esc(codeReset)}`;
export const brightBlueBackground = (msg: string) => `${esc(codeBg, codeBlue + brightOffset)}${msg}${esc(codeReset)}`;
export const brightMagentaBackground = (msg: string) => `${esc(codeBg, codeMagenta + brightOffset)}${msg}${esc(codeReset)}`;
export const brightCyanBackground = (msg: string) => `${esc(codeBg, codeCyan + brightOffset)}${msg}${esc(codeReset)}`;
export const brightWhiteBackground = (msg: string) => `${esc(codeBg, codeWhite + brightOffset)}${msg}${esc(codeReset)}`;

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

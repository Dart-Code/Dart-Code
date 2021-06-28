import * as vs from "vscode";
import { flutterCupertinoColors, flutterMaterialColors } from "../flutter/colors";
import { asHexColor } from "../utils";
import { toRange } from "./utils";

export class ColorRangeComputer {
	private readonly materialNameColorPattern = "\\bColors\\.(?<mc>[\\w_\\[\\]\\.]+)";
	private readonly cupertinoNameColorPattern = "\\bCupertinoColors\\.(?<cc>[\\w_\\[\\]\\.]+)";
	private readonly colorConstructorPattern = "\\bColor\\(\\s*0x(?<cons>[A-Fa-f0-9]{8}),{0,1}\\s*\\)";
	private readonly colorConstructorRgbo = "\\bColor\\.fromRGBO\\(\\s*(?<rgboR>[\\w_]+),\\s*(?<rgboG>[\\w_]+),\\s*(?<rgboB>[\\w_]+),\\s*(?<rgboO>[\\w_.]+),{0,1}\\s*\\)";
	private readonly colorConstructorArgb = "\\bColor\\.fromARGB\\(\\s*(?<argbA>[\\w_]+),\\s*(?<argbR>[\\w_]+),\\s*(?<argbG>[\\w_]+),\\s*(?<argbB>[\\w_]+),{0,1}\\s*\\)";

	private readonly allColors = [
		this.materialNameColorPattern,
		this.cupertinoNameColorPattern,
		this.colorConstructorPattern,
		this.colorConstructorRgbo,
		this.colorConstructorArgb,
	];

	private readonly allColorsPattern = new RegExp(`^.*?(?<range>${this.allColors.join("|")})`, "gm");

	public compute(document: vs.TextDocument): { [key: string]: vs.Range[] } {
		const text = document.getText();

		// Build a map of all possible decorations, with those in this file. We need to include all
		// colors so if any were removed, we will clear their decorations.
		const decs: { [key: string]: vs.Range[] } = {};

		let result: RegExpExecArray | null;
		this.allColorsPattern.lastIndex = -1;

		// eslint-disable-next-line no-cond-assign
		while (result = this.allColorsPattern.exec(text)) {
			if (!result.groups)
				continue;

			let colorHex: string | undefined;

			if (result.groups.mc)
				colorHex = this.extractMaterialColor(result.groups.mc);
			else if (result.groups.cc)
				colorHex = this.extractCupertinoColor(result.groups.cc);
			else if (result.groups.cons)
				colorHex = result.groups.cons.toLowerCase();
			else if (result.groups.rgboR && result.groups.rgboG && result.groups.rgboB && result.groups.rgboO)
				colorHex = this.extractRgboColor(result.groups.rgboR, result.groups.rgboG, result.groups.rgboB, result.groups.rgboO);
			else if (result.groups.argbA && result.groups.argbR && result.groups.argbG && result.groups.argbB)
				colorHex = this.extractArgbColor(result.groups.argbA, result.groups.argbR, result.groups.argbG, result.groups.argbB);

			if (colorHex) {
				if (!decs[colorHex])
					decs[colorHex] = [];

				// We can't get the index of the captures yet (https://github.com/tc39/proposal-regexp-match-indices) but we do know
				// - the length of the whole match
				// - the length of the main capture
				// - that the main capture ends at the same point as the whole match
				// Therefore the index we want, is the (match index + match length - capture length).
				const index = result.index + result[0].length - result.groups.range.length;

				decs[colorHex].push(toRange(document, index, result.groups.range.length));
			}
		}

		return decs;
	}

	private extractMaterialColor(input: string): string | undefined {
		const colorName = input.replace(/\.shade(\d+)/, "[$1]");

		if (!(colorName in flutterMaterialColors || `${colorName}.primary` in flutterMaterialColors))
			return;

		return (flutterMaterialColors[colorName] || flutterMaterialColors[`${colorName}.primary`]).toLowerCase();
	}

	private extractCupertinoColor(input: string): string | undefined {
		const colorName = input.replace(/\.color/, "[$1]");

		if (!(colorName in flutterCupertinoColors || `${colorName}.color` in flutterCupertinoColors))
			return;

		return (flutterCupertinoColors[colorName] || flutterCupertinoColors[`${colorName}.color`]).toLowerCase();
	}

	private extractRgboColor(inputR: string, inputG: string, inputB: string, inputO: string): string | undefined {
		const r = parseInt(inputR);
		const g = parseInt(inputG);
		const b = parseInt(inputB);
		const opacity = parseFloat(inputO);

		if (isNaN(r) || isNaN(g) || isNaN(b) || isNaN(opacity))
			return;

		return asHexColor({ r, g, b, a: opacity * 255 });
	}

	private extractArgbColor(inputA: string, inputR: string, inputG: string, inputB: string) {
		const a = parseInt(inputA);
		const r = parseInt(inputR);
		const g = parseInt(inputG);
		const b = parseInt(inputB);

		if (isNaN(a) || isNaN(r) || isNaN(g) || isNaN(b))
			return;

		return asHexColor({ a, r, g, b });
	}
}

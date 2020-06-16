import * as vs from "vscode";
import { flutterCupertinoColors, flutterMaterialColors } from "../flutter/colors";
import { asHexColor } from "../utils";
import { toRange } from "./utils";

export class ColorRangeComputer {
	private readonly materialNameColorPattern = new RegExp("Colors\\.([\\w_\\[\\]\\.]+)", "g");
	private readonly cupertinoNameColorPattern = new RegExp("CupertinoColors\\.([\\w_\\[\\]\\.]+)", "g");
	private readonly colorConstructorPattern = new RegExp(" Color\\(0x([\\w_]{8})\\)", "g");
	private readonly colorConstructorPattern2 = new RegExp(" Color\\.fromRGBO\\(([\\w_]+), ([\\w_]+), ([\\w_]+), ([\\w_.]+)\\)", "g");
	private readonly colorConstructorPattern3 = new RegExp(" Color\\.fromARGB\\(([\\w_]+), ([\\w_]+), ([\\w_]+), ([\\w_]+)\\)", "g");

	public compute(document: vs.TextDocument): { [key: string]: vs.Range[] } {
		const text = document.getText();

		// Build a map of all possible decorations, with those in this file. We need to include all
		// colors so if any were removed, we will clear their decorations.
		const decs: { [key: string]: vs.Range[] } = {};

		// Handle named colors.
		let result: RegExpExecArray | null;

		// Material
		// tslint:disable-next-line: no-conditional-assignment
		while (result = this.materialNameColorPattern.exec(text)) {
			const colorName = result[1].replace(/\.shade(\d+)/, "[$1]");

			if (!(colorName in flutterMaterialColors || `${colorName}.primary` in flutterMaterialColors)) {
				console.log(`${colorName} missing`);
				continue;
			}

			const colorHex = (flutterMaterialColors[colorName] || flutterMaterialColors[`${colorName}.primary`]).toLowerCase();

			if (!decs[colorHex])
				decs[colorHex] = [];

			decs[colorHex].push(toRange(document, result.index, result[0].length));
		}

		// Cupertino
		// tslint:disable-next-line: no-conditional-assignment
		while (result = this.cupertinoNameColorPattern.exec(text)) {
			const colorName = result[1].replace(/\.color/, "[$1]");

			if (!(colorName in flutterCupertinoColors || `${colorName}.color` in flutterCupertinoColors)) {
				console.log(`${colorName} missing`);
				continue;
			}

			const colorHex = (flutterCupertinoColors[colorName] || flutterCupertinoColors[`${colorName}.color`]).toLowerCase();

			if (!decs[colorHex])
				decs[colorHex] = [];

			decs[colorHex].push(toRange(document, result.index, result[0].length));
		}

		// Handle color constructors.
		// tslint:disable-next-line: no-conditional-assignment
		while (result = this.colorConstructorPattern.exec(text)) {
			const colorHex = result[1].toLowerCase();

			if (!decs[colorHex])
				decs[colorHex] = [];

			decs[colorHex].push(toRange(
				document,
				result.index + 1, // + 1 to account for space
				result[0].length - 1, // -1 to account for the above
			));
		}
		// tslint:disable-next-line: no-conditional-assignment
		while (result = this.colorConstructorPattern2.exec(text)) {
			const r = parseInt(result[1], 10);
			const g = parseInt(result[2], 10);
			const b = parseInt(result[3], 10);
			const opacity = parseFloat(result[4]);

			if (isNaN(r) || isNaN(g) || isNaN(b) || isNaN(opacity))
				continue;

			const colorHex = asHexColor({ r, g, b, a: opacity * 255 });

			if (!decs[colorHex])
				decs[colorHex] = [];

			decs[colorHex].push(toRange(
				document,
				result.index + 1, // + 1 to account for space
				result[0].length - 1, // -1 to account for the above
			));
		}
		// tslint:disable-next-line: no-conditional-assignment
		while (result = this.colorConstructorPattern3.exec(text)) {
			const a = parseInt(result[1], 10);
			const r = parseInt(result[2], 10);
			const g = parseInt(result[3], 10);
			const b = parseInt(result[4], 10);

			if (isNaN(r) || isNaN(g) || isNaN(b) || isNaN(a))
				continue;

			const colorHex = asHexColor({ a, r, g, b });

			if (!decs[colorHex])
				decs[colorHex] = [];

			decs[colorHex].push(toRange(
				document,
				result.index + 1, // + 1 to account for space
				result[0].length - 1, // -1 to account for the above
			));
		}

		return decs;
	}
}

import * as vs from "vscode";
import { flutterColors } from "../flutter/colors";
import { toRange } from "./utils";

export class ColorRangeComputer {
	private readonly namedColorPattern = new RegExp("Colors\\.([\\w_\\[\\]\\.]+)", "g");
	private readonly colorConstructorPattern = new RegExp(" Color\\(0x([\\w_]{8})\\)", "g");

	public compute(document: vs.TextDocument): { [key: string]: vs.Range[] } {
		const text = document.getText();

		// Build a map of all possible decorations, with those in this file. We need to include all
		// colors so if any were removed, we will clear their decorations.
		const decs: { [key: string]: vs.Range[] } = {};

		// Handle named colors.
		let result: RegExpExecArray | null;
		// tslint:disable-next-line: no-conditional-assignment
		while (result = this.namedColorPattern.exec(text)) {
			const colorName = result[1].replace(/\.shade(\d+)/, "[$1]");

			if (!(colorName in flutterColors || `${colorName}.primary` in flutterColors)) {
				console.log(`${colorName} missing`);
				continue;
			}

			const colorHex = (flutterColors[colorName] || flutterColors[`${colorName}.primary`]).toLowerCase();

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

		return decs;
	}
}

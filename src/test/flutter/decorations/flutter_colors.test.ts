import * as assert from "assert";
import { Range } from "vscode";
import { ColorRangeComputer } from "../../../shared/vscode/color_range_computer";
import { activate, currentDoc, rangesOf, rangeString, setTestContent, waitForNextAnalysis } from "../../helpers";

describe("flutter_color_decorations", () => {
	beforeEach("activate", () => activate());

	it("locates the expected colors", async () => {
		await waitForNextAnalysis(() => setTestContent(`
import 'package:flutter/material.dart';

final ThemeData base2 = ThemeData(
  indicatorColor: Colors.white,
  toggleableActiveColor: const Color(0xFF1E88E5),
  splashColor: Colors.black26,
  canvasColor: Colors.white,
  errorColor: const Color(0xFFB00020),
  buttonTheme: ButtonThemeData(
    buttonColor: Colors.pinkAccent,
    disabledColor: Colors.purpleAccent.shade400,
    hoverColor: Colors.amberAccent[100],
  ),
);
		`));

		const doc = currentDoc();
		const computer = new ColorRangeComputer();
		const results = computer.compute(doc);

		assert.ok(results);
		assert.equal(Object.keys(results).length, 7);
		const ensureColor = (hex: string, ranges: Range[]) => {
			assert.ok(results[hex], hex);
			assert.deepStrictEqual(results[hex].map(rangeString), ranges.map(rangeString), hex);
		};
		ensureColor("ffffffff", rangesOf("|Colors.white|"));
		ensureColor("ff1e88e5", rangesOf("|Color(0xFF1E88E5)|"));
		ensureColor("42000000", rangesOf("|Colors.black26|"));
		ensureColor("ffb00020", rangesOf("|Color(0xFFB00020)|"));
		ensureColor("ffff4081", rangesOf("|Colors.pinkAccent|"));
		ensureColor("ffd500f9", rangesOf("|Colors.purpleAccent.shade400|"));
		ensureColor("ffffe57f", rangesOf("|Colors.amberAccent[100]|"));
	});
});

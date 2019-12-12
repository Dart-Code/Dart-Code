import * as assert from "assert";
import { IconRangeComputer } from "../../../shared/vscode/icon_range_computer";
import { activate, currentDoc, extApi, rangeOf, setTestContent, waitForNextAnalysis } from "../../helpers";

describe("flutter_icon_decorations", () => {
	beforeEach("activate", () => activate());

	it("locates the expected icons", async () => {
		await waitForNextAnalysis(() => setTestContent(`
import 'package:flutter/material.dart';

var btn1 = RaisedButton.icon(
  icon: const Icon(Icons.add, size: 16.0),
  label: const Text('BUTTON TEXT'),
  onPressed: () {},
);

var btn2 = RaisedButton.icon(
  icon: const Icon(Icons.airline_seat_legroom_reduced, size: 16.0),
  label: const Text('BUTTON TEXT'),
  onPressed: () {},
);
		`));

		const doc = currentDoc();
		const outline = extApi.dasFileTracker.getFlutterOutlineFor(doc.uri)!;
		const computer = new IconRangeComputer(extApi.logger);
		const results = computer.compute(doc, outline);

		assert.ok(results);
		assert.deepStrictEqual(Object.keys(results), ["add", "airline_seat_legroom_reduced"]);
		assert.equal(results.add.length, 1);
		assert.ok(results.add[0].isEqual(rangeOf("|Icons.add|")));
		assert.equal(results.airline_seat_legroom_reduced.length, 1);
		assert.ok(results.airline_seat_legroom_reduced[0].isEqual(rangeOf("|Icons.airline_seat_legroom_reduced|")));
	});
});

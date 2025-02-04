import { strict as assert } from "assert";
import { IconRangeComputerLsp } from "../../../shared/vscode/icon_range_computer";
import { activate, currentDoc, extApi, rangeOf, setTestContent, waitForNextAnalysis } from "../../helpers";

describe("flutter_icon_decorations", () => {
	beforeEach("activate", () => activate());

	it("locates the expected icons", async () => {
		await waitForNextAnalysis(() => setTestContent(`
import 'package:flutter/material.dart';
import 'package:flutter/cupertino.dart' show CupertinoIcons;

var btn1 = RaisedButton.icon(
  icon: const Icon(Icons.add, size: 16.0),
  label: const Text('BUTTON TEXT'),
  onPressed: () {},
);

var btn2 = RaisedButton.icon(
  icon: const Icon(CupertinoIcons.battery_75_percent, size: 16.0),
  label: const Text('BUTTON TEXT'),
  onPressed: () {},
);
		`));

		const doc = currentDoc();
		const outline = extApi.fileTracker.getFlutterOutlineFor!(doc.uri)!;
		const results = new IconRangeComputerLsp(extApi.logger).compute(outline);

		assert.ok(results);
		assert.deepStrictEqual(Object.keys(results), ["material/add", "cupertino/battery_75_percent"]);
		assert.equal(results["material/add"].length, 1);
		assert.ok(results["material/add"][0].isEqual(rangeOf("|Icons.add|")));
		assert.equal(results["cupertino/battery_75_percent"].length, 1);
		assert.ok(results["cupertino/battery_75_percent"][0].isEqual(rangeOf("|CupertinoIcons.battery_75_percent|")));
	});
});

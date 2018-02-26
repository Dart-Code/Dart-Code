import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as vs from "vscode";
import { activate, doc, getPositionOf, setTestContent, rangeOf } from "../helpers";

describe("dart_hover_provider", () => {

	before(async () => activate());

	async function getHoversAt(searchText: string): Promise<Array<{ displayText: string, documentation?: string, range: vs.Range }>> {
		const position = getPositionOf(searchText);
		const hoverResult = await (vs.commands.executeCommand("vscode.executeHoverProvider", doc.uri, position) as Thenable<vs.Hover[]>);

		// Our hovers are aways in the form:
		// [{ language: "dart", value: data.displayString }, data.documentation || undefined],
		if (hoverResult == null || hoverResult.length === 0)
			return [];

		return hoverResult.map((h) => {
			const displayText = ((h.contents[0] as any).value as string).trim();
			const docs = ((h.contents[1] as any).value as string).trim();
			assert.equal(displayText.substr(0, 7), "```dart");
			assert.equal(displayText.substr(-3), "```");
			return {
				displayText: displayText.substring(7, displayText.length - 3).trim(),
				documentation: docs,
				range: h.range,
			};
		});
	}

	// Helper to get just a single hover when exactly one is expected.
	async function getHoverAt(searchText: string): Promise<{ displayText: string, documentation?: string, range: vs.Range }> {
		const hovers = await getHoversAt(searchText);
		assert.equal(hovers.length, 1);
		return hovers[0];
	}

	it("does not return hovers for blank areas of the document", async () => {
		await setTestContent(" \n \n");
		const hovers = await getHoversAt("\n^");
		assert.equal(hovers.length, 0);
	});

	it("returns expected information for a class", async () => {
		await setTestContent(`
		/// A Person.
		class Person {}
		`);
		const hover = await getHoverAt("class Pe^rson");
		assert.equal(hover.displayText, "class Person");
		assert.equal(hover.documentation, "A Person.");
		assert.deepStrictEqual(hover.range, rangeOf("class |Person|"));
	});
});

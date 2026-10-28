import { strict as assert } from "assert";
import * as sinon from "sinon";
import * as vs from "vscode";
import { ExtensionRestartReason } from "../../../shared/constants";
import { activate, currentEditor, flutterHelloWorldCounterAppFile, flutterHelloWorldMainFile, openFile, privateApi, rangeOf, sb, setConfigForTest, setTestContent, waitForNextAnalysis, waitForResult } from "../../helpers";

describe("flutter_ui_guides_decorations", () => {
	beforeEach("activate", () => activate());

	async function enableUiGuides(customTracking = false) {
		await setConfigForTest("dart", "previewFlutterUiGuides", true);
		await setConfigForTest("dart", "previewFlutterUiGuidesCustomTracking", customTracking);
		await vs.commands.executeCommand("_dart.reloadExtension", ExtensionRestartReason.Test);
		await activate();
	}

	function spyBuildDecorations() {
		const uiGuides = privateApi.flutterUiGuideDecorations;
		assert.ok(uiGuides);
		const spy = sb.spy(uiGuides, "buildDecorations");
		return () => spy.lastCall?.returnValue as vs.DecorationOptions[] | undefined;
	}

	function formatGuidesByLine(decorations: vs.DecorationOptions[]) {
		const guidesByLine = new Map<number, { anchor: number, text: string }>();
		for (const d of decorations) {
			guidesByLine.set(d.range.start.line, {
				anchor: d.range.start.character,
				text: d.renderOptions?.before?.contentText ?? "",
			});
		}
		return guidesByLine;
	}

	it("renders expected UI guides for widgets", async () => {
		await enableUiGuides(false);

		const getDecorations = spyBuildDecorations();

		await waitForNextAnalysis(() => setTestContent(`
import 'package:flutter/material.dart';

Widget build() {
  return Column(
    children: [
      Padding(
        padding: const EdgeInsets.all(8.0),
        child: Text('First'),
      ),

      Container(
        child:
      Text('Outdented'),
      ),
    ],
  );
}
		`.trim()));

		await waitForResult(() => !!getDecorations()?.length, "Wait for UI guide decorations");
		const guidesByLine = formatGuidesByLine(getDecorations()!);

		// Line 3: "  return Column(" -> start of Column guide at col 2, covered by user text -> 4 NBSPs
		assert.deepStrictEqual(guidesByLine.get(3), { anchor: 2, text: "\xa0\xa0\xa0\xa0" });
		// Line 4: "    children: [" -> vertical line at col 2, NBSPs over user text
		assert.deepStrictEqual(guidesByLine.get(4), { anchor: 2, text: "│\xa0\xa0\xa0" });
		// Line 5: "      Padding(" -> middleCorner at col 2 (since Container is also a child of Column on line 10), horizontal to col 6 (covered by 'P' so NBSP at index 4)
		assert.deepStrictEqual(guidesByLine.get(5), { anchor: 2, text: "├───\xa0\xa0" });
		// Line 6: "        padding: const EdgeInsets.all(8.0)," -> vertical lines at col 2 and col 6
		assert.deepStrictEqual(guidesByLine.get(6), { anchor: 2, text: "│\xa0\xa0\xa0│\xa0" });
		// Line 7: "        child: Text('First')," -> vertical line at col 2, bottomCorner at col 6, horizontal to col 8 (covered by 'c' so NBSP)
		assert.deepStrictEqual(guidesByLine.get(7), { anchor: 2, text: "│\xa0\xa0\xa0╰─\xa0" });
		// Line 8: "      )," -> vertical line at col 2
		assert.deepStrictEqual(guidesByLine.get(8), { anchor: 2, text: "│\xa0\xa0\xa0" });
		// Line 9: "" (empty line) -> anchor is 0 (lastLineCharacter < firstGuideChar), 2 NBSPs + vertical line at col 2
		assert.deepStrictEqual(guidesByLine.get(9), { anchor: 0, text: "\xa0\xa0│\xa0\xa0\xa0" });
		// Line 10: "      Container(" -> bottomCorner at col 2, horizontal to col 6 (covered by 'C' so NBSP)
		assert.deepStrictEqual(guidesByLine.get(10), { anchor: 2, text: "╰───\xa0" });
		// Line 11: "        child:" -> guide from col 6 to col 6 (so lastGuideChar = 6 and anchorPoint = 6 -> empty contentText)
		assert.deepStrictEqual(guidesByLine.get(11), { anchor: 6, text: "" });
		// Line 12: "      Text('Outdented')," -> end of Container->Text guide at col 6, covered by user text ('T' at col 6)
		assert.deepStrictEqual(guidesByLine.get(12), { anchor: 6, text: "\xa0" });
	});

	it("adjusts guide padding for tabs", async () => {
		await enableUiGuides(false);

		const editor = currentEditor();
		editor.options.tabSize = 4;
		const getDecorations = spyBuildDecorations();

		await waitForNextAnalysis(() => setTestContent([
			"import 'package:flutter/material.dart';",
			"",
			"Widget build() {",
			"\treturn Column(",
			"\t\tchildren: [",
			"\t\t\tText('A'),",
			"\t\t\tText('B'),",
			"\t\t],",
			"\t);",
			"}",
		].join("\n")));

		await waitForResult(() => !!getDecorations()?.length, "Wait for tab-adjusted UI guide decorations");
		const guidesByLine = formatGuidesByLine(getDecorations()!);

		// Line 4: "\t\tchildren: [" -> anchor is 1. char 1 is "\t", guide at col 1 is "│", padded with 3 NBSPs (tabSize - 1), plus 1 NBSP at col 2
		assert.deepStrictEqual(guidesByLine.get(4), { anchor: 1, text: "│\xa0\xa0\xa0\xa0" });
		// Line 5: "\t\t\tText('A')," -> anchor is 1. char 1 is "\t" (guide "├" padded with 3 "─"), char 2 is "\t" (guide "─" padded with 3 "─"), char 3 is "T" (NBSP)
		assert.deepStrictEqual(guidesByLine.get(5), { anchor: 1, text: "├───────\xa0" });
		// Line 6: "\t\t\tText('B')," -> anchor is 1. char 1 is "\t" (guide "╰" padded with 3 "─"), char 2 is "\t" (guide "─" padded with 3 "─"), char 3 is "T" (NBSP)
		assert.deepStrictEqual(guidesByLine.get(6), { anchor: 1, text: "╰───────\xa0" });
	});

	it("bails out when outline length does not match document length and updates when switching active editor", async () => {
		await enableUiGuides(false);

		await waitForNextAnalysis(() => setTestContent(`
import 'package:flutter/material.dart';

Widget build() {
  return Center(
    child: Text('Hello'),
  );
}
		`.trim()));

		const editor = currentEditor();
		await waitForResult(() => !!privateApi.fileTracker.getFlutterOutlineFor!(editor.document.uri), "Wait for Flutter outline");

		const uiGuides = privateApi.flutterUiGuideDecorations;
		const spy = sb.spy(uiGuides, "renderGuides");

		// Call buildFromOutline with an outline whose end offset does not match document length (smaller than document length).
		const outline = JSON.parse(JSON.stringify(privateApi.fileTracker.getFlutterOutlineFor!(editor.document.uri)!));
		outline.range.end.line = 1;
		outline.range.end.character = 0;
		uiGuides.buildFromOutline(editor, outline);
		assert.equal(spy.called, false);

		// Switching active text editor triggers onDidChangeActiveTextEditor -> buildForTextEditor.
		await waitForNextAnalysis(async () => {
			await openFile(flutterHelloWorldMainFile);
		});
		await openFile(flutterHelloWorldCounterAppFile);
		const mainEditor = await openFile(flutterHelloWorldMainFile);
		await waitForResult(() => spy.calledWith(mainEditor, sinon.match.any), "Wait for renderGuides on mainEditor");
	});

	it("tracks widget guide positions across edits when previewFlutterUiGuidesCustomTracking is enabled", async () => {
		await enableUiGuides(true);

		const getDecorations = spyBuildDecorations();

		await waitForNextAnalysis(() => setTestContent(`
import 'package:flutter/material.dart';

Widget build() {
  return Column(
    children: [
      Padding(
        padding: const EdgeInsets.all(8.0),
        child: Text('First'),
      ),
      Text('Second'),
    ],
  );
}
		`.trim()));

		await waitForResult(() => !!getDecorations()?.length, "Wait for initial UI guide decorations");
		let guidesByLine = formatGuidesByLine(getDecorations()!);
		assert.deepStrictEqual(guidesByLine.get(5), { anchor: 2, text: "├───\xa0\xa0" });
		assert.deepStrictEqual(guidesByLine.get(9), { anchor: 2, text: "╰───\xa0" });

		// Insert a newline at the top of the document and verify WidgetGuideTracker immediately shifts guides down by 1 line.
		const editor = currentEditor();
		const uiGuides = privateApi.flutterUiGuideDecorations;
		const updatedGuidesSpy = sb.spy(uiGuides, "buildFromUpdatedGuides");

		await editor.edit((eb) => eb.insert(new vs.Position(0, 0), " // comment\n"));
		assert.equal(updatedGuidesSpy.calledOnce, true);

		guidesByLine = formatGuidesByLine(getDecorations()!);
		assert.deepStrictEqual(guidesByLine.get(6), { anchor: 2, text: "├───\xa0\xa0" });
		assert.deepStrictEqual(guidesByLine.get(10), { anchor: 2, text: "╰───\xa0" });

		// Delete a range spanning one of the child widgets so its positions are removed from the tracker while the other remains.
		updatedGuidesSpy.resetHistory();
		await editor.edit((eb) => eb.delete(rangeOf("|      Text('Second'),\n|", editor.document)));
		assert.equal(updatedGuidesSpy.calledOnce, true);
		const remainingGuides = updatedGuidesSpy.lastCall.args[1];
		assert.equal(remainingGuides.length, 2); // Column -> Padding and Padding -> Text

		// Clean up by disabling UI guides and reloading so dispose() is called on FlutterUiGuideDecorations and WidgetGuideTracker.
		const uiGuidesDisposeSpy = sb.spy(uiGuides, "dispose");
		const trackerDisposeSpy = sb.spy(uiGuides.tracker, "dispose");
		updatedGuidesSpy.resetHistory();

		await setConfigForTest("dart", "previewFlutterUiGuides", false);
		await vs.commands.executeCommand("_dart.reloadExtension", ExtensionRestartReason.Test);

		assert.equal(uiGuidesDisposeSpy.calledOnce, true);
		assert.equal(trackerDisposeSpy.calledOnce, true);
		assert.equal(privateApi.flutterUiGuideDecorations, undefined);

		// Verify subsequent edits do not trigger the disposed tracker or update guides.
		await editor.edit((eb) => eb.insert(new vs.Position(0, 0), "// post-dispose edit\n"));
		assert.equal(updatedGuidesSpy.called, false);
	});
});

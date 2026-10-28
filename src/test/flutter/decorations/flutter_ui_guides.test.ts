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

	/**
	 * Renders a visual representation of the document with UI guide decorations
	 * overlaid at their visual positions.
	 */
	function renderDocumentWithGuides(doc: vs.TextDocument, decorations: vs.DecorationOptions[], tabSize = 1): string {
		const guidesByLine = new Map<number, { anchor: number, text: string }>();
		for (const d of decorations) {
			guidesByLine.set(d.range.start.line, {
				anchor: d.range.start.character,
				text: d.renderOptions?.before?.contentText ?? "",
			});
		}

		const lines: string[] = [];
		for (let lineNum = 0; lineNum < doc.lineCount; lineNum++) {
			const rawLine = doc.lineAt(lineNum).text;
			const expandedLine = tabSize > 1 ? rawLine.replace(/\t/g, " ".repeat(tabSize)) : rawLine;
			const guide = guidesByLine.get(lineNum);
			if (!guide) {
				lines.push(expandedLine);
				continue;
			}

			// Compute the visual column of the anchor point when tabs are expanded.
			const prefixBeforeAnchor = rawLine.slice(0, guide.anchor);
			const visualAnchor = (tabSize > 1 ? prefixBeforeAnchor.replace(/\t/g, " ".repeat(tabSize)) : prefixBeforeAnchor).length;
			const chars = expandedLine.padEnd(visualAnchor + guide.text.length, " ").split("");
			for (let i = 0; i < guide.text.length; i++) {
				const guideChar = guide.text[i];
				if (guideChar !== "\xa0")
					chars[visualAnchor + i] = guideChar;
			}
			lines.push(chars.join("").trimEnd());
		}
		return lines.join("\n");
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
		const rendered = renderDocumentWithGuides(currentEditor().document, getDecorations()!);

		assert.equal(rendered, `
import 'package:flutter/material.dart';

Widget build() {
  return Column(
  │ children: [
  ├───Padding(
  │   │ padding: const EdgeInsets.all(8.0),
  │   ╰─child: Text('First'),
  │   ),
  │
  ╰───Container(
        child:
      Text('Outdented'),
      ),
    ],
  );
}
		`.trim());
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
		const rendered = renderDocumentWithGuides(editor.document, getDecorations()!, 4);

		assert.equal(rendered, `
import 'package:flutter/material.dart';

Widget build() {
    return Column(
    │   children: [
    ├───────Text('A'),
    ╰───────Text('B'),
        ],
    );
}
		`.trim());
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
		const editor = currentEditor();
		assert.equal(renderDocumentWithGuides(editor.document, getDecorations()!), `
import 'package:flutter/material.dart';

Widget build() {
  return Column(
  │ children: [
  ├───Padding(
  │   │ padding: const EdgeInsets.all(8.0),
  │   ╰─child: Text('First'),
  │   ),
  ╰───Text('Second'),
    ],
  );
}
		`.trim());

		// Insert a newline at the top of the document and verify WidgetGuideTracker immediately shifts guides down by 1 line.
		const uiGuides = privateApi.flutterUiGuideDecorations;
		const updatedGuidesSpy = sb.spy(uiGuides, "buildFromUpdatedGuides");

		await editor.edit((eb) => eb.insert(new vs.Position(0, 0), "// comment\n"));
		assert.equal(updatedGuidesSpy.calledOnce, true);

		assert.equal(renderDocumentWithGuides(editor.document, getDecorations()!), `
// comment
import 'package:flutter/material.dart';

Widget build() {
  return Column(
  │ children: [
  ├───Padding(
  │   │ padding: const EdgeInsets.all(8.0),
  │   ╰─child: Text('First'),
  │   ),
  ╰───Text('Second'),
    ],
  );
}
		`.trim());

		// Delete a range spanning one of the child widgets so its positions are removed from the tracker while the other remains.
		updatedGuidesSpy.resetHistory();
		await editor.edit((eb) => eb.delete(rangeOf("|      Text('Second'),\n|", editor.document)));
		assert.equal(updatedGuidesSpy.calledOnce, true);
		assert.equal(renderDocumentWithGuides(editor.document, getDecorations()!), `
// comment
import 'package:flutter/material.dart';

Widget build() {
  return Column(
  │ children: [
  ╰───Padding(
      │ padding: const EdgeInsets.all(8.0),
      ╰─child: Text('First'),
      ),
    ],
  );
}
		`.trim());

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

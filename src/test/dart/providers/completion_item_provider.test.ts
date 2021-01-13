import * as assert from "assert";
import * as vs from "vscode";
import { LazyCompletionItem } from "../../../shared/vscode/interfaces";
import { acceptFirstSuggestion, activate, currentDoc, emptyFile, ensureCompletion, ensureInsertReplaceRanges as ensureRanges, ensureNoCompletion, ensureTestContent, ensureTestContentWithCursorPos, ensureTestContentWithSelection, everythingFile, extApi, getCompletionsAt, helloWorldCompletionFile, helloWorldPartFile, helloWorldPartWrapperFile, openFile, rangeOf, select, setTestContent, snippetValue } from "../../helpers";

describe("completion_item_provider", () => {
	beforeEach("activate helloWorldCompletionFile", () => activate(helloWorldCompletionFile));

	// This is not implemented. Turns out it's hard to detect this without having false positives
	// since we can't easily tell we're in a show/hide reliably.
	it.skip("does not add parens on functions in show/hide", async () => {
		const doc = currentDoc();
		await setTestContent(doc.getText().replace(/\/\/ IMPORTS HERE/mg, "import 'dart:io' show ;"));

		const completions = await getCompletionsAt("show ^;");

		ensureCompletion(completions, vs.CompletionItemKind.Function, "exit");
	});

	it("adds parens on functions in code", async () => {
		const doc = currentDoc();
		await setTestContent(doc.getText().replace(/\/\/ IMPORTS HERE/mg, "import 'dart:io' show exit;"));
		await setTestContent(doc.getText().replace(/\/\/ MAIN HERE/mg, "exi //"));

		const completions = await getCompletionsAt("exi^ //");

		ensureCompletion(completions, vs.CompletionItemKind.Function, "exit(…)", "exit");
	});

	it("includes expected completions", async () => {
		await openFile(everythingFile);
		const completions = await getCompletionsAt(`^return str`);

		// From the class
		ensureCompletion(completions, vs.CompletionItemKind.Class, "MyTestClass", "MyTestClass");
		ensureCompletion(completions, vs.CompletionItemKind.Field, "myTestNumField", "myTestNumField");
		ensureCompletion(completions, vs.CompletionItemKind.Property, "myTestNumGetter", "myTestNumGetter");
		ensureCompletion(completions, vs.CompletionItemKind.Property, "myTestNumSetter", "myTestNumSetter");
		ensureCompletion(completions, vs.CompletionItemKind.Constructor, "MyTestClass()", "MyTestClass");
		ensureCompletion(completions, vs.CompletionItemKind.Constructor, "MyTestClass.myTestNamed()", "MyTestClass.myTestNamed");
		ensureCompletion(completions, vs.CompletionItemKind.Method, "myTestVoidReturningMethod()", "myTestVoidReturningMethod");
		ensureCompletion(completions, vs.CompletionItemKind.Method, "myTestStringReturningMethod()", "myTestStringReturningMethod");
		ensureCompletion(completions, vs.CompletionItemKind.Method, "methodTakingString(…)", "methodTakingString");
		ensureCompletion(completions, vs.CompletionItemKind.Method, "methodTakingFunction(…)", "methodTakingFunction");
		ensureCompletion(completions, vs.CompletionItemKind.Variable, "str", "str");

		// Top levels
		ensureCompletion(completions, vs.CompletionItemKind.Function, "doSomeStuff()", "doSomeStuff");
		ensureCompletion(completions, vs.CompletionItemKind.Variable, "foo", "foo"); // We don't know it's constant from DAS.
		ensureCompletion(completions, vs.CompletionItemKind.Enum, "Theme", "Theme");
		ensureCompletion(completions, extApi.isLsp ? vs.CompletionItemKind.Enum : vs.CompletionItemKind.EnumMember, "Theme.Light", "Theme.Light");

		// TODO: vs.CompletionItemKind.File/Folder?

		// Keywords
		ensureCompletion(completions, vs.CompletionItemKind.Keyword, "final", "final");
	});

	it("sets cursor position correctly", async () => {
		await openFile(emptyFile);
		await setTestContent(`
foo({String foo}) {}

main() {
	foo(fo);
}
				`);
		const completions = await getCompletionsAt(`foo(fo^`);

		const comp = ensureCompletion(completions, vs.CompletionItemKind.Variable, "foo: ", "foo: ");
		if (extApi.isLsp)
			assert.equal(comp.insertText, "foo: ");
		else if (typeof comp.insertText === "string")
			throw new Error("Expected SnippetString, got string");
		else if (comp.insertText!.value.includes("{"))
			assert.equal(comp.insertText!.value, "foo: ${1:}");
		else
			assert.equal(comp.insertText!.value, "foo: $0");
	});

	it("includes classes and constructors from other files", async () => {
		await openFile(emptyFile);
		await setTestContent(`
import 'dart:io';

main() {
  ProcessInf
}
		`);
		const completions = await getCompletionsAt(`ProcessInf^`);

		const classComp: LazyCompletionItem = ensureCompletion(completions, vs.CompletionItemKind.Class, "ProcessInfo", "ProcessInfo");
		assert.equal(classComp.detail, undefined);

		const constrComp: LazyCompletionItem = ensureCompletion(completions, vs.CompletionItemKind.Constructor, "ProcessInfo()", "ProcessInfo");
		assert.equal(constrComp.detail, "() → ProcessInfo");
	});

	it("fully populates a completion", async () => {
		await openFile(everythingFile);
		const completions = await getCompletionsAt(`ret^urn str`);

		const cl: LazyCompletionItem = ensureCompletion(completions, vs.CompletionItemKind.Method, "methodWithArgsAndReturnValue(…)", "methodWithArgsAndReturnValue");
		assert.equal(cl.additionalTextEdits, undefined); // Tested in the unimported imports test.
		assert.equal(cl.command, undefined); // Tested in the unimported imports in part-file test.
		assert.equal(cl.commitCharacters, undefined); // TODO: ??
		assert.equal(cl.detail, "(int i) → int"); // No auto import message here
		assert.equal(cl.filterText, "methodWithArgsAndReturnValue");
		if (extApi.isLsp) {
			assert.equal((cl.insertText as vs.SnippetString).value, "methodWithArgsAndReturnValue(${0:i})");
		} else {
			assert.equal((cl.insertText as vs.SnippetString).value, "methodWithArgsAndReturnValue(${1:i})");
			// https://github.com/microsoft/language-server-protocol/issues/880
			assert.equal(cl.keepWhitespace, true);
		}
		assert.equal(cl.kind, vs.CompletionItemKind.Method);
		assert.equal(cl.label, "methodWithArgsAndReturnValue(…)");
		assert.notEqual(cl.preselect, true);
		ensureRanges(cl.range, "|ret|urn str", "|return| str");
	});

	it("does not include auto-import notes on an in-scope completion", async () => {
		await openFile(everythingFile);
		const completions = await getCompletionsAt(`^return str`);

		const completion = ensureCompletion(completions, vs.CompletionItemKind.Method, "methodWithArgsAndReturnValue(…)", "methodWithArgsAndReturnValue");

		assert.equal(completion.detail, "(int i) → int"); // No auto import message here
	});

	it.skip("sorts completions by relevance");

	it("inserts full text for overrides", async () => {
		await setTestContent(`
abstract class Person {
  String get name;
}

class Student extends Person {
  nam //
}
	`);
		select(rangeOf("nam|| //"));

		await acceptFirstSuggestion();
		const expectedBody = "throw UnimplementedError()";

		// Compensate for LSP messing with indent.
		// https://github.com/microsoft/language-server-protocol/issues/880
		const extraUnwantedIndent = extApi.isLsp ? "  " : "";

		await ensureTestContentWithSelection(`
abstract class Person {
  String get name;
}

class Student extends Person {
  @override
${extraUnwantedIndent}  // TODO: implement name
${extraUnwantedIndent}  String get name => |${expectedBody}|; //
}
	`);
	});

	describe("with SuggestionSet support", () => {
		beforeEach("ensure SuggestionSets are supported", async function () {
			if (!extApi.isLsp && extApi.analyzerCapabilities && !extApi.analyzerCapabilities.supportsAvailableSuggestions)
				this.skip();
		});

		it("includes unimported symbols", async () => {
			await setTestContent(`
main() {
  ProcessInf
}
		`);
			const completions = await getCompletionsAt("ProcessInf^", undefined, 5000);

			ensureCompletion(completions, vs.CompletionItemKind.Class, "ProcessInfo", "ProcessInfo");
		});

		it("fully populates a completion for a class in an unimported library", async () => {
			await setTestContent(`
main() {
  ProcessInf
}
		`);
			const completions = await getCompletionsAt("Process^Inf", undefined, 5000);

			const completion = ensureCompletion(completions, vs.CompletionItemKind.Class, "ProcessInfo", "ProcessInfo");

			assert.ok(completion.additionalTextEdits!.length);
			assert.equal(completion.command, undefined); // Tested in the unimported imports in part-file test.
			assert.equal(completion.commitCharacters, undefined); // TODO: ??
			assert.equal(completion.detail, "Auto import from 'dart:io'");
			assert.equal(completion.filterText ?? completion.label, "ProcessInfo");
			assert.equal(snippetValue(completion.insertText) ?? completion.label, "ProcessInfo");
			// https://github.com/microsoft/language-server-protocol/issues/880
			if (!extApi.isLsp)
				assert.equal(completion.keepWhitespace, true);
			assert.equal(completion.kind, vs.CompletionItemKind.Class);
			assert.equal(completion.label, "ProcessInfo");
			assert.notEqual(completion.preselect, true);
			ensureRanges(completion.range, "|Process|Inf", "|ProcessInf|");
		});

		it("fully populates a completion for a undeclared constructor in an unimported library", async () => {
			await setTestContent(`
main() {
  ProcessInf
}
		`);
			const completions = await getCompletionsAt("ProcessIn^f", undefined, extApi.isLsp ? 5000 : 50000); // non-LSP doesn't filter so we need to resolve more :(

			const completion = ensureCompletion(completions, vs.CompletionItemKind.Constructor, "ProcessInfo()", "ProcessInfo");

			assert.ok(completion.additionalTextEdits!.length);
			assert.equal(completion.command, undefined); // Tested in the unimported imports in part-file test.
			assert.equal(completion.commitCharacters, undefined); // TODO: ??
			assert.equal(completion.detail, "Auto import from 'dart:io'\n\n() → ProcessInfo");
			if (extApi.isLsp)
				assert.equal((completion.documentation as vs.MarkdownString).value, "[ProcessInfo] provides methods for retrieving information about the\ncurrent process.");
			assert.equal(completion.filterText ?? completion.label, "ProcessInfo");
			if (extApi.isLsp)
				assert.equal(snippetValue(completion.insertText) ?? completion.label, "ProcessInfo(${0:})");
			else
				assert.equal(snippetValue(completion.insertText) ?? completion.label, "ProcessInfo()");
			// https://github.com/microsoft/language-server-protocol/issues/880
			if (!extApi.isLsp)
				assert.equal(completion.keepWhitespace, true);
			assert.equal(completion.kind, vs.CompletionItemKind.Constructor);
			assert.equal(completion.label, "ProcessInfo()");
			assert.notEqual(completion.preselect, true);
			ensureRanges(completion.range, "|ProcessIn|f", "|ProcessInf|");
		});

		it("fully populates a completion for a declared constructor in an unimported library", async () => {
			await setTestContent(`
main() {
  HashMa
}
		`);
			const completions = await getCompletionsAt("Hash^Ma", undefined, 5000);

			const completion = ensureCompletion(completions, vs.CompletionItemKind.Constructor, "HashMap(…)", "HashMap");

			assert.ok(completion.additionalTextEdits!.length);
			assert.equal(completion.command, undefined); // Tested in the unimported imports in part-file test.
			assert.equal(completion.commitCharacters, undefined); // TODO: ??
			// This signature changed in a newer Dev version of Dart (2020-05-13).
			assert.ok(
				completion.detail === "Auto import from 'dart:collection'\n\n({bool equals(K key1, K key2), int hashCode(K key), bool isValidKey(potentialKey)}) → HashMap"
				|| completion.detail === "Auto import from 'dart:collection'\n\n({bool Function(K, K)? equals, int Function(K)? hashCode, bool Function(dynamic)? isValidKey}) → HashMap",
			);
			assert.equal(completion.filterText ?? completion.label, "HashMap");
			if (extApi.isLsp)
				assert.equal(snippetValue(completion.insertText) ?? completion.label, "HashMap(${0:})");
			else
				assert.equal((completion.insertText as vs.SnippetString).value, "HashMap($1)");
			// https://github.com/microsoft/language-server-protocol/issues/880
			if (!extApi.isLsp)
				assert.equal(completion.keepWhitespace, true);
			assert.equal(completion.kind, vs.CompletionItemKind.Constructor);
			assert.equal(completion.label, "HashMap(…)");
			assert.notEqual(completion.preselect, true);
			ensureRanges(completion.range, "|Hash|Ma", "|HashMa|");
		});

		it("includes auto-import notes on unimported symbols", async () => {
			await setTestContent(`
main() {
  final a = ProcessInf
}
		`);
			const completions = await getCompletionsAt("ProcessInf^", undefined, 5000);

			const completion = ensureCompletion(completions, vs.CompletionItemKind.Class, "ProcessInfo", "ProcessInfo");

			assert.equal(completion.detail!.startsWith("Auto import from 'dart:io'"), true);
		});

		it("insert imports automatically when completing unimported symbols", async () => {
			await setTestContent(`
main() {
  final a = ProcessInf
}
		`);
			select(rangeOf("ProcessInf||"));

			await acceptFirstSuggestion();
			// TODO: Cursor positions are slightly different between LSP/not right now.
			const parens = extApi.isLsp ? "(^)" : "()^";
			await ensureTestContentWithCursorPos(`
import 'dart:io';

main() {
  final a = ProcessInfo${parens}
}
		`);
		});

		it("inserts imports into the library file while inserting code into the part file", async () => {
			await openFile(helloWorldPartFile);
			await setTestContent(`
part of 'part_wrapper.dart';

main() {
  final a = ProcessInf
}
		`);
			select(rangeOf("ProcessInf||"));

			await acceptFirstSuggestion();
			// TODO: Cursor positions are slightly different between LSP/not right now.
			const parens = extApi.isLsp ? "(^)" : "()^";
			await ensureTestContentWithCursorPos(`
part of 'part_wrapper.dart';

main() {
  final a = ProcessInfo${parens}
}
		`);

			// Now ensure the import was added to the wrapper file.
			await openFile(helloWorldPartWrapperFile);
			await ensureTestContent(`
import 'dart:io';

part 'part.dart';
					`);
		});

		it("sorts completions from suggestion sets", async () => {
			await setTestContent(`
import 'package:hello_world/everything.dart';

foo(Theme theme) {
	theme =
}
			`);
			const completions = await getCompletionsAt("theme =^");

			const completion = ensureCompletion(completions, extApi.isLsp ? vs.CompletionItemKind.Enum : vs.CompletionItemKind.EnumMember, "Theme.Dark", "Theme.Dark");
			// 1100 from boost
			//    8 from includedSuggestionSet
			// TODO: Find a reliable way to test ranking.
		});

		it("correctly filters (includes enum constants in methods)", async () => {
			await setTestContent(`
import 'package:hello_world/everything.dart';

foo(Theme theme) {
	theme =
}
			`);
			const completions = await getCompletionsAt("theme =^");

			ensureCompletion(completions, vs.CompletionItemKind.Enum, "Theme", "Theme");
			ensureCompletion(completions, extApi.isLsp ? vs.CompletionItemKind.Enum : vs.CompletionItemKind.EnumMember, "Theme.Dark", "Theme.Dark");
		});

		it("correctly filters (does not include enum constants at top level)", async () => {
			await setTestContent(`
import 'package:hello_world/everything.dart';

// top level
			`);
			const completions = await getCompletionsAt("^// top level");

			ensureCompletion(completions, vs.CompletionItemKind.Enum, "Theme", "Theme");
			ensureNoCompletion(completions, extApi.isLsp ? vs.CompletionItemKind.Enum : vs.CompletionItemKind.EnumMember, "Theme.Dark");
		});
	});
});

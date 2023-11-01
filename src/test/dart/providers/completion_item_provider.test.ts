import { strict as assert } from "assert";
import * as vs from "vscode";
import { LazyCompletionItem } from "../../../shared/vscode/interfaces";
import { acceptFirstSuggestion, activate, completionLabel, currentDoc, emptyFile, ensureCompletion, ensureNoCompletion, ensureInsertReplaceRanges as ensureRanges, ensureTestContent, ensureTestContentWithSelection, everythingFile, extApi, getCompletionsAt, helloWorldCompletionFile, helloWorldPartFile, helloWorldPartWrapperFile, openFile, rangeOf, select, setTestContent, snippetValue } from "../../helpers";

describe("completion_item_provider", () => {
	beforeEach("activate helloWorldCompletionFile", () => activate(helloWorldCompletionFile));

	it("does not add parens on functions in show/hide", async function () {
		if (!extApi.isLsp)
			this.skip();
		const doc = currentDoc();
		await setTestContent(doc.getText().replace(/\/\/ IMPORTS HERE/mg, "import 'dart:io' show ;"));

		const completions = await getCompletionsAt("show ^;");

		const completion = ensureCompletion(completions, vs.CompletionItemKind.Function, "exit(…)", "exit");
		assert.equal(completion.insertText, "exit");
	});

	it("adds parens on functions in code", async () => {
		const doc = currentDoc();
		await setTestContent(doc.getText().replace(/\/\/ IMPORTS HERE/mg, "import 'dart:io' show exit;"));
		await setTestContent(doc.getText().replace(/\/\/ MAIN HERE/mg, "exi //"));

		const completions = await getCompletionsAt("exi^ //");

		const completion = ensureCompletion(completions, vs.CompletionItemKind.Function, "exit(…)", "exit");
		const completionInsertText = (completion.insertText as vs.SnippetString).value;
		// LSP:
		if (completionInsertText.includes("${0"))
			assert.equal(completionInsertText, "exit(${0:code})");
		// Legacy:
		else
			assert.equal(completionInsertText, "exit(${1:code})");
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

		const comp = ensureCompletion(completions, vs.CompletionItemKind.Variable, "foo:", "foo:");
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
  ProcessRes
}
		`);
		const completions = await getCompletionsAt(`ProcessRes^`);

		const classComp: LazyCompletionItem = ensureCompletion(completions, vs.CompletionItemKind.Class, "ProcessResult", "ProcessResult");
		assert.equal(classComp.detail, undefined);

		const constrComp: LazyCompletionItem = ensureCompletion(completions, vs.CompletionItemKind.Constructor, "ProcessResult(…)", "ProcessResult");
		if (extApi.isLsp)
			assert.equal(constrComp.detail, "(int pid, int exitCode, dynamic stdout, dynamic stderr) → ProcessResult");
		else
			assert.equal(constrComp.detail, "(this.pid, this.exitCode, this.stdout, this.stderr) → ProcessResult");
	});

	it("fully populates a completion", async () => {
		await openFile(everythingFile);
		const completions = await getCompletionsAt(`ret^urn str`);

		const cl: LazyCompletionItem = ensureCompletion(completions, vs.CompletionItemKind.Method, "methodWithArgsAndReturnValue(…)", "methodWithArgsAndReturnValue");
		assert.equal(cl.additionalTextEdits, undefined); // Tested in the unimported imports test.
		if (extApi.isLsp)
			assert.equal(cl.command!.command, "editor.action.triggerParameterHints");
		else
			assert.equal(cl.command, undefined);
		assert.equal(cl.commitCharacters, undefined); // TODO: ??
		assert.equal(cl.detail, "(int i) → int"); // No auto import message here
		if (extApi.isLsp) {
			assert.equal((cl.insertText as vs.SnippetString).value, "methodWithArgsAndReturnValue(${0:i})");
		} else {
			assert.equal((cl.insertText as vs.SnippetString).value, "methodWithArgsAndReturnValue(${1:i})");
			// https://github.com/microsoft/language-server-protocol/issues/880
			assert.equal(cl.keepWhitespace, true);
		}
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
  String get fullName;
}

class Student extends Person {
  fullNam //
}
	`);
		select(rangeOf("fullNam|| //"));

		await acceptFirstSuggestion();
		const expectedBody = "throw UnimplementedError()";

		// Compensate for LSP messing with indent.
		// https://github.com/microsoft/language-server-protocol/issues/880
		const extraUnwantedIndent = extApi.isLsp && !extApi.dartCapabilities.hasLspInsertTextModeSupport ? "  " : "";

		await ensureTestContentWithSelection(`
abstract class Person {
  String get fullName;
}

class Student extends Person {
  @override
${extraUnwantedIndent}  // TODO: implement fullName
${extraUnwantedIndent}  String get fullName => |${expectedBody}|; //
}
	`);
	});

	describe("with not-imported completions", () => {
		beforeEach("ensure supported", function () {
			if (!extApi.isLsp)
				this.skip();
		});

		it("includes unimported symbols", async () => {
			await setTestContent(`
main() {
  ProcessRes
}
		`);
			const completions = await getCompletionsAt("ProcessRes^", { resolveCount: 5000 });

			ensureCompletion(completions, vs.CompletionItemKind.Class, "ProcessResult", "ProcessResult");
		});

		it("fully populates a completion for a class in an unimported library", async () => {
			await setTestContent(`
main() {
  ProcessRes
}
		`);
			const completions = await getCompletionsAt("Process^Res", { resolveCount: 5000, requireComplete: true });

			const completion = ensureCompletion(completions, vs.CompletionItemKind.Class, "ProcessResult", "ProcessResult");

			assert.ok(completion.additionalTextEdits!.length);
			assert.equal(completion.command, undefined); // Tested in the unimported imports in part-file test.
			assert.equal(completion.commitCharacters, undefined); // TODO: ??
			assert.equal(completion.detail, "Auto import from 'dart:io'");
			assert.equal(snippetValue(completion.insertText) ?? completionLabel(completion), "ProcessResult");
			// https://github.com/microsoft/language-server-protocol/issues/880
			if (!extApi.isLsp)
				assert.equal(completion.keepWhitespace, true);
			assert.notEqual(completion.preselect, true);
			ensureRanges(completion.range, "|Process|Res", "|ProcessRes|");
		});

		it("fully populates a completion for a undeclared constructor in an unimported library", async () => {
			await setTestContent(`
main() {
  ProcessRes
}
		`);
			const completions = await getCompletionsAt("ProcessRe^s", { requireComplete: true, resolveCount: extApi.isLsp ? 5000 : 50000 }); // non-LSP doesn't filter so we need to resolve more :(
			const completion = ensureCompletion(completions, vs.CompletionItemKind.Constructor, "ProcessResult(…)", "ProcessResult");

			assert.ok(completion.additionalTextEdits!.length);
			if (extApi.isLsp)
				assert.equal(completion.command!.command, "editor.action.triggerParameterHints");
			else
				assert.equal(completion.command, undefined);
			assert.equal(completion.commitCharacters, undefined); // TODO: ??
			assert.equal(completion.detail, "Auto import from 'dart:io'\n\n(int pid, int exitCode, dynamic stdout, dynamic stderr) → ProcessResult");
			// TODO: Restore when a fix for https://github.com/Dart-Code/Dart-Code/issues/4361 is available.
			// if (extApi.isLsp) {
			// 	// This text changed, so handle both.
			// 	const doc = (completion.documentation as vs.MarkdownString).value;
			// 	if (doc.startsWith("[ProcessResult]"))
			// 		assert.equal(doc, "[ProcessInfo] provides methods for retrieving information about the\ncurrent process.");
			// 	else
			// 		assert.equal(doc, "Methods for retrieving information about the current process.");
			// }
			if (extApi.isLsp)
				assert.equal(snippetValue(completion.insertText) ?? completionLabel(completion), "ProcessResult(${1:pid}, ${2:exitCode}, ${3:stdout}, ${4:stderr})");
			else
				assert.equal(snippetValue(completion.insertText) ?? completionLabel(completion), "ProcessResult()");
			// https://github.com/microsoft/language-server-protocol/issues/880
			if (!extApi.isLsp)
				assert.equal(completion.keepWhitespace, true);
			assert.notEqual(completion.preselect, true);
			ensureRanges(completion.range, "|ProcessRe|s", "|ProcessRes|");
		});

		it("fully populates a completion for a declared constructor in an unimported library", async () => {
			await setTestContent(`
main() {
  HashMa
}
		`);
			const completions = await getCompletionsAt("Hash^Ma", { resolveCount: 5000, requireComplete: true });

			const completion = ensureCompletion(completions, vs.CompletionItemKind.Constructor, "HashMap(…)", "HashMap");

			assert.ok(completion.additionalTextEdits!.length);
			if (extApi.isLsp)
				assert.equal(completion.command!.command, "editor.action.triggerParameterHints");
			else
				assert.equal(completion.command, undefined);
			assert.equal(completion.commitCharacters, undefined); // TODO: ??
			// This signature changed in a newer Dev version of Dart (2020-05-13).
			assert.ok(
				completion.detail === "Auto import from 'dart:collection'\n\n({bool equals(K key1, K key2), int hashCode(K key), bool isValidKey(potentialKey)}) → HashMap"
				|| completion.detail === "Auto import from 'dart:collection'\n\n({bool Function(K, K)? equals, int Function(K)? hashCode, bool Function(dynamic)? isValidKey}) → HashMap"
				// 2022-10-11
				|| completion.detail === "Auto import from 'dart:collection'\n\n({bool Function(K, K)? equals, int Function(K)? hashCode, bool Function(dynamic)? isValidKey}) → HashMap<K, V>",
			);
			if (extApi.isLsp) {
				const insertText = snippetValue(completion.insertText) ?? (completion.label as string);
				if (insertText.includes("${"))
					assert.equal(insertText, "HashMap(${0:})");
				else
					assert.equal(insertText, "HashMap($0)");
			} else {
				assert.equal((completion.insertText as vs.SnippetString).value, "HashMap($1)");
			}
			// https://github.com/microsoft/language-server-protocol/issues/880
			if (!extApi.isLsp)
				assert.equal(completion.keepWhitespace, true);
			assert.notEqual(completion.preselect, true);
			ensureRanges(completion.range, "|Hash|Ma", "|HashMa|");
		});

		it("includes auto-import notes on unimported symbols", async () => {
			await setTestContent(`
main() {
  final a = ProcessRes
}
		`);
			const completions = await getCompletionsAt("ProcessRes^", { resolveCount: 5000 });

			const completion = ensureCompletion(completions, vs.CompletionItemKind.Class, "ProcessResult", "ProcessResult");

			assert.equal(completion.detail!.startsWith("Auto import from 'dart:io'"), true);
		});

		it("insert imports automatically when completing unimported symbols", async () => {
			await setTestContent(`
main() {
  final a = ProcessRes
}
		`);
			select(rangeOf("ProcessRes||"));

			await acceptFirstSuggestion();
			await ensureTestContentWithSelection(`
import 'dart:io';

main() {
  final a = ProcessResult(|pid|, exitCode, stdout, stderr)
}
		`);
		});

		it("inserts imports into the library file while inserting code into the part file", async () => {
			await openFile(helloWorldPartFile);
			await setTestContent(`
part of 'part_wrapper.dart';

main() {
  final a = ProcessRes
}
		`);
			select(rangeOf("ProcessRes||"));

			await acceptFirstSuggestion();
			await ensureTestContentWithSelection(`
part of 'part_wrapper.dart';

main() {
  final a = ProcessResult(|pid|, exitCode, stdout, stderr)
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

			ensureCompletion(completions, vs.CompletionItemKind.EnumMember, "Theme.Dark", "Theme.Dark");
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
			ensureCompletion(completions, vs.CompletionItemKind.EnumMember, "Theme.Dark", "Theme.Dark");
		});

		it("correctly filters (does not include enum constants at top level)", async () => {
			await setTestContent(`
import 'package:hello_world/everything.dart';

// top level
			`);
			const completions = await getCompletionsAt("^// top level");

			ensureCompletion(completions, vs.CompletionItemKind.Enum, "Theme", "Theme");
			ensureNoCompletion(completions, [vs.CompletionItemKind.Enum, vs.CompletionItemKind.EnumMember], "Theme.Dark");
		});
	});
});

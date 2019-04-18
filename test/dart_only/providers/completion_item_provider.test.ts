import * as assert from "assert";
import * as vs from "vscode";
import { acceptFirstSuggestion, activate, currentDoc, emptyFile, ensureCompletion, ensureNoCompletion, ensureTestContent, ensureTestContentWithCursorPos, ensureTestContentWithSelection, everythingFile, extApi, getCompletionsAt, getCompletionsViaProviderAt, helloWorldCompletionFile, helloWorldPartFile, helloWorldPartWrapperFile, openFile, rangeOf, resolveCompletion, select, setTestContent } from "../../helpers";

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
		ensureCompletion(completions, vs.CompletionItemKind.Class, "MyClass", "MyClass");
		ensureCompletion(completions, vs.CompletionItemKind.Field, "myNumField", "myNumField");
		ensureCompletion(completions, vs.CompletionItemKind.Property, "myNumGetter", "myNumGetter");
		ensureCompletion(completions, vs.CompletionItemKind.Property, "myNumSetter", "myNumSetter");
		ensureCompletion(completions, vs.CompletionItemKind.Constructor, "MyClass()", "MyClass");
		ensureCompletion(completions, vs.CompletionItemKind.Constructor, "MyClass.myNamed()", "MyClass.myNamed");
		ensureCompletion(completions, vs.CompletionItemKind.Method, "myVoidReturningMethod()", "myVoidReturningMethod");
		ensureCompletion(completions, vs.CompletionItemKind.Method, "myStringReturningMethod()", "myStringReturningMethod");
		ensureCompletion(completions, vs.CompletionItemKind.Method, "methodTakingString(…)", "methodTakingString");
		ensureCompletion(completions, vs.CompletionItemKind.Method, "methodTakingFunction(…)", "methodTakingFunction");
		ensureCompletion(completions, vs.CompletionItemKind.Variable, "str", "str");

		// Top levels
		ensureCompletion(completions, vs.CompletionItemKind.Function, "doSomeStuff()", "doSomeStuff");
		ensureCompletion(completions, vs.CompletionItemKind.Variable, "foo", "foo"); // We don't know it's constant from DAS.
		ensureCompletion(completions, vs.CompletionItemKind.Enum, "Theme", "Theme");
		ensureCompletion(completions, vs.CompletionItemKind.EnumMember, "Theme.Light", "Theme.Light");

		// TODO: vs.CompletionItemKind.File/Folder?

		// Keywords
		ensureCompletion(completions, vs.CompletionItemKind.Keyword, "final", "final");
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

		const classComp = ensureCompletion(completions, vs.CompletionItemKind.Class, "ProcessInfo", "ProcessInfo");
		assert.equal((classComp.documentation as vs.MarkdownString).value, "[ProcessInfo] provides methods for retrieving information about the\ncurrent process.");
		assert.equal(classComp.detail, "");

		const constrComp = ensureCompletion(completions, vs.CompletionItemKind.Constructor, "ProcessInfo()", "ProcessInfo");
		assert.equal((constrComp.documentation as vs.MarkdownString).value, "");
		assert.equal(constrComp.detail, "() → ProcessInfo");
	});

	it("fully populates a completion", async () => {
		await openFile(everythingFile);
		const completions = await getCompletionsAt(`^return str`);

		const cl = ensureCompletion(completions, vs.CompletionItemKind.Method, "methodWithArgsAndReturnValue(…)", "methodWithArgsAndReturnValue");
		assert.equal(cl.additionalTextEdits, undefined); // Tested in the unimported imports test.
		assert.equal(cl.command, undefined); // Tested in the unimported imports in part-file test.
		assert.equal(cl.commitCharacters, undefined); // TODO: ??
		assert.equal(cl.detail, "(int i) → int"); // No auto import message here
		assert.equal((cl.documentation as vs.MarkdownString).value, "This is my method taking arguments and returning a value.");
		assert.equal(cl.filterText, "methodWithArgsAndReturnValue");
		assert.equal((cl.insertText as vs.SnippetString).value, "methodWithArgsAndReturnValue(${1:i})");
		assert.equal(cl.keepWhitespace, true);
		assert.equal(cl.kind, vs.CompletionItemKind.Method);
		assert.equal(cl.label, "methodWithArgsAndReturnValue(…)");
		assert.notEqual(cl.preselect, true);
		assert.equal(cl.range.isEqual(rangeOf("|return| str")), true);
		assert.equal(cl.sortText, "998943methodWithArgsAndReturnValue(…)"); // TODO: This may be fragile...
		assert.equal(cl.textEdit, undefined); // We don't use this (we use insertText and range).
	});

	it("does not include auto-import notes on an in-scope completion", async () => {
		await openFile(everythingFile);
		const completions = await getCompletionsViaProviderAt(`^return str`);

		let completion = ensureCompletion(completions, vs.CompletionItemKind.Method, "methodWithArgsAndReturnValue(…)", "methodWithArgsAndReturnValue");
		completion = await resolveCompletion(completion);

		assert.equal(completion.detail, "(int i) → int"); // No auto import message here
	});

	it.skip("sorts completions by relevance");

	it("inserts full text for overrides", async () => {
		await setTestContent(`
abstract class Person {
  String get name;
}

class Student extends Person {
  na //
}
	`);
		select(rangeOf("na|| //"));

		await acceptFirstSuggestion();
		await ensureTestContentWithSelection(`
abstract class Person {
  String get name;
}

class Student extends Person {
  @override
  // TODO: implement name
  String get name => |null|; //
}
	`);
	});

	describe("with SuggestionSet support", () => {
		beforeEach("ensure SuggestionSets are supported", function () {
			if (!extApi.analyzerCapabilities.supportsAvailableSuggestions)
				this.skip();
		});

		it("includes unimported symbols", async () => {
			await setTestContent(`
main() {
  ProcessInf
}
		`);
			const completions = await getCompletionsAt("ProcessInf^");

			ensureCompletion(completions, vs.CompletionItemKind.Class, "ProcessInfo", "ProcessInfo");
		});

		it("fully populates a completion for a class in an unimported library", async () => {
			await setTestContent(`
main() {
  ProcessInf
}
		`);
			const completions = await getCompletionsViaProviderAt("ProcessInf^");

			let completion = ensureCompletion(completions, vs.CompletionItemKind.Class, "ProcessInfo", "ProcessInfo");
			completion = await resolveCompletion(completion);

			assert.ok(completion.additionalTextEdits.length);
			assert.equal(completion.command, undefined); // Tested in the unimported imports in part-file test.
			assert.equal(completion.commitCharacters, undefined); // TODO: ??
			assert.equal(completion.detail, "Auto import from 'dart:io'");
			assert.equal((completion.documentation as vs.MarkdownString).value, "[ProcessInfo] provides methods for retrieving information about the\ncurrent process.");
			assert.equal(completion.filterText, "ProcessInfo");
			assert.equal((completion.insertText as vs.SnippetString).value, "ProcessInfo");
			assert.equal(completion.keepWhitespace, true);
			assert.equal(completion.kind, vs.CompletionItemKind.Class);
			assert.equal(completion.label, "ProcessInfo");
			assert.notEqual(completion.preselect, true);
			assert.equal(completion.range.isEqual(rangeOf("|ProcessInf|")), true);
			assert.equal(completion.sortText, "999997ProcessInfo"); // TODO: This may be fragile...
			assert.equal(completion.textEdit, undefined); // We don't use this (we use insertText and range).
		});

		it("fully populates a completion for a undeclared constructor in an unimported library", async () => {
			await setTestContent(`
main() {
  ProcessInf
}
		`);
			const completions = await getCompletionsViaProviderAt("ProcessInf^");

			let completion = ensureCompletion(completions, vs.CompletionItemKind.Constructor, "ProcessInfo()", "ProcessInfo");
			completion = await resolveCompletion(completion);

			assert.ok(completion.additionalTextEdits.length);
			assert.equal(completion.command, undefined); // Tested in the unimported imports in part-file test.
			assert.equal(completion.commitCharacters, undefined); // TODO: ??
			assert.equal(completion.detail, "Auto import from 'dart:io'\n\n() → ProcessInfo");
			assert.equal((completion.documentation as vs.MarkdownString).value, ""); // This is a default constructor that doesn't have any docs.
			assert.equal(completion.filterText, "ProcessInfo");
			assert.equal((completion.insertText as vs.SnippetString).value, "ProcessInfo()");
			assert.equal(completion.keepWhitespace, true);
			assert.equal(completion.kind, vs.CompletionItemKind.Constructor);
			assert.equal(completion.label, "ProcessInfo()");
			assert.notEqual(completion.preselect, true);
			assert.equal(completion.range.isEqual(rangeOf("|ProcessInf|")), true);
			assert.equal(completion.sortText, "999997ProcessInfo()"); // TODO: This may be fragile...
			assert.equal(completion.textEdit, undefined); // We don't use this (we use insertText and range).
		});

		it("fully populates a completion for a declared constructor in an unimported library", async () => {
			await setTestContent(`
main() {
  HashMa
}
		`);
			const completions = await getCompletionsViaProviderAt("HashMa^");

			let completion = ensureCompletion(completions, vs.CompletionItemKind.Constructor, "HashMap(…)", "HashMap");
			completion = await resolveCompletion(completion);

			assert.ok(completion.additionalTextEdits.length);
			assert.equal(completion.command, undefined); // Tested in the unimported imports in part-file test.
			assert.equal(completion.commitCharacters, undefined); // TODO: ??
			assert.equal(completion.detail, "Auto import from 'dart:collection'\n\n({bool equals(K key1, K key2), int hashCode(K key), bool isValidKey(potentialKey)}) → HashMap");
			assert.equal((completion.documentation as vs.MarkdownString).value, "Creates an unordered hash-table based [Map].");
			assert.equal(completion.filterText, "HashMap");
			assert.equal((completion.insertText as vs.SnippetString).value, "HashMap($0)");
			assert.equal(completion.keepWhitespace, true);
			assert.equal(completion.kind, vs.CompletionItemKind.Constructor);
			assert.equal(completion.label, "HashMap(…)");
			assert.notEqual(completion.preselect, true);
			assert.equal(completion.range.isEqual(rangeOf("|HashMa|")), true);
			assert.equal(completion.sortText, "999997HashMap(…)"); // TODO: This may be fragile...
			assert.equal(completion.textEdit, undefined); // We don't use this (we use insertText and range).
		});

		it("includes auto-import notes on unimported symbols", async () => {
			await setTestContent(`
main() {
  ProcessInf
}
		`);
			const completions = await getCompletionsViaProviderAt("ProcessInf^");

			let completion = ensureCompletion(completions, vs.CompletionItemKind.Class, "ProcessInfo", "ProcessInfo");
			completion = await resolveCompletion(completion);
			assert.equal(completion.detail.startsWith("Auto import from 'dart:io'"), true);
		});

		it("insert imports automatically when completing unimported symbols", async () => {
			await setTestContent(`
main() {
  ProcessInf
}
		`);
			select(rangeOf("ProcessInf||"));

			await acceptFirstSuggestion();
			await ensureTestContentWithCursorPos(`
import 'dart:io';

main() {
  ProcessInfo^
}
		`);
		});

		it("inserts imports into the library file while inserting code into the part file", async () => {
			await openFile(helloWorldPartFile);
			await setTestContent(`
part of 'part_wrapper.dart';

main() {
  ProcessInf
}
		`);
			select(rangeOf("ProcessInf||"));

			await acceptFirstSuggestion();
			await ensureTestContentWithCursorPos(`
part of 'part_wrapper.dart';

main() {
  ProcessInfo^
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

			const completion = ensureCompletion(completions, vs.CompletionItemKind.EnumMember, "Theme.Dark", "Theme.Dark");
			// 1100 from boost
			//    8 from includedSuggestionSet
			// TODO: Find a reliable way to test ranking.
			// assert.equal(completion.sortText, "998995Theme.Dark"); // TODO: This might be fragile!
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
			ensureNoCompletion(completions, vs.CompletionItemKind.EnumMember, "Theme.Dark");
		});
	});
});

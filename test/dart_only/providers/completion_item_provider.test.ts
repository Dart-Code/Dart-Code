import * as assert from "assert";
import * as vs from "vscode";
import { acceptFirstSuggestion, activate, currentDoc, ensureCompletion, ensureTestContent, ensureTestContentWithCursorPos, ensureTestContentWithSelection, everythingFile, extApi, getCompletionsAt, helloWorldCompletionFile, helloWorldPartFile, helloWorldPartWrapperFile, openFile, rangeOf, select, setTestContent } from "../../helpers";

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

	it("full populates a completion", async () => {
		await openFile(everythingFile);
		const completions = await getCompletionsAt(`^return str`);

		const cl = ensureCompletion(completions, vs.CompletionItemKind.Method, "methodWithArgsAndReturnValue(…)", "methodWithArgsAndReturnValue");
		assert.equal(cl.additionalTextEdits, undefined); // Tested in the unimported imports test.
		assert.equal(cl.command, undefined); // Tested in the unimported imports in part-file test.
		assert.equal(cl.commitCharacters, undefined); // TODO: ??
		assert.equal(cl.detail, "(int i) → int");
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

	it("sorts completions by relevance", async () => {
		throw new Error("NYI");
	});

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

			const completion = ensureCompletion(completions, vs.CompletionItemKind.Class, "ProcessInfo", "ProcessInfo");
			assert.equal(completion.detail.startsWith("Auto import from 'dart:io'\n\n"), true);
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

		it("sorts unimported completions correctly relative to imported completions", async () => {
			throw new Error("NYI");
		});
	});
});

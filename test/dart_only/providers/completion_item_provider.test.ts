import * as vs from "vscode";
import { acceptFirstSuggestion, activate, currentDoc, ensureCompletion, ensureTestContentWithCursorPos, ensureTestContentWithSelection, everythingFile, extApi, getCompletionsAt, helloWorldCompletionFile, openFile, rangeOf, select, setTestContent } from "../../helpers";

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

	it("includes unimported symbols", async function () {
		if (!extApi.analyzerCapabilities.supportsAvailableSuggestions) {
			this.skip();
			return;
		}

		await setTestContent(`
main() {
  ProcessInf
}
		`);
		const completions = await getCompletionsAt("ProcessInf^");

		ensureCompletion(completions, vs.CompletionItemKind.Property, "ProcessInfo", undefined);
	});

	it("insert imports automatically when completing unimported symbols", async function () {
		if (!extApi.analyzerCapabilities.supportsAvailableSuggestions) {
			this.skip();
			return;
		}

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

	it("inserts imports into the library file while inserting code into the part file", () => {
		throw new Error("NYI");
	});
});

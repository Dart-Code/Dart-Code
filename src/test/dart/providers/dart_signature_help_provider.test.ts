import { strict as assert } from "assert";
import * as vs from "vscode";
import { activate, currentDoc, positionOf, setTestContent } from "../../helpers";

describe("dart_signature_provider", () => {
	beforeEach("activate", () => activate());

	async function getSignatureAt(searchText: string): Promise<vs.SignatureHelp> {
		const position = positionOf(searchText);
		return vs.commands.executeCommand<vs.SignatureHelp>("vscode.executeSignatureHelpProvider", currentDoc().uri, position);
	}

	it("returns undefined for invalid area", async () => {
		await setTestContent(`
main() {
  print("test
}
		`);
		const sig = await getSignatureAt("^main");
		assert.ok(!sig);
	});

	it("displays a simple sig", async () => {
		await setTestContent(`
main() {
  print("here
}
		`);
		const sigs = await getSignatureAt("here^");
		assert.ok(sigs);
		// assert.equal(sig.activeParameter, 0);
		assert.equal(sigs.activeSignature, 0);
		assert.equal(sigs.signatures.length, 1);
		const sig = sigs.signatures[0];
		assert.equal(sig.label, sig.label.includes("?") ? "print(Object? object)" : "print(Object object)");
		assert.equal(sig.parameters.length, 1);
		assert.equal(sig.parameters[0].label, (sig.parameters[0].label as string).includes("?") ? "Object? object" : "Object object");
		assert.equal(sig.parameters[0].documentation, undefined);
		const docString = (sig.documentation as vs.MarkdownString).value;
		if (docString.startsWith("Prints a string representation")) {
			assert.equal(docString, "Prints a string representation of the object to the console.");
		} else {
			// Text changed in newer versions to be much longer.
			assert.ok(docString.startsWith("Prints an object to the console."));
			assert.ok(docString.endsWith("Calls to `print` can be intercepted by [Zone.print]."));
		}
	});

	it("displays optional params correctly", async () => {
		await setTestContent(`
a(String name, [int age, int otherAge]) {}
main() {
  a("here
}
		`);
		const sig = await getSignatureAt("here^");
		assert.ok(sig);
		// assert.equal(sig.activeParameter, 0);
		assert.equal(sig.activeSignature, 0);
		assert.equal(sig.signatures[0].label, "a(String name, [int age, int otherAge])");
	});

	it("displays named params correctly", async () => {
		await setTestContent(`
a(String name, {int age, int otherAge}) {}
main() {
  a("here
}
		`);
		const sig = await getSignatureAt("here^");
		assert.ok(sig);
		// assert.equal(sig.activeParameter, 0);
		assert.equal(sig.activeSignature, 0);
		assert.equal(sig.signatures[0].label, "a(String name, {int age, int otherAge})");
	});

	it("displays only named params correctly", async () => {
		await setTestContent(`
a({int age, int otherAge}) {}
main() {
  a("here
}
		`);
		const sig = await getSignatureAt("here^");
		assert.ok(sig);
		// assert.equal(sig.activeParameter, 0);
		assert.equal(sig.activeSignature, 0);
		assert.equal(sig.signatures[0].label, "a({int age, int otherAge})");
	});

	it("displays optional params default values", async () => {
		await setTestContent(`
a(String name, [int age, int otherAge = 2]) {}
main() {
  a("here
}
		`);
		const sig = await getSignatureAt("here^");
		assert.ok(sig);
		// assert.equal(sig.activeParameter, 0);
		assert.equal(sig.activeSignature, 0);
		assert.equal(sig.signatures[0].label, "a(String name, [int age, int otherAge = 2])");
	});

	it("displays named params default values", async () => {
		await setTestContent(`
a(String name, {int age, int otherAge: 2}) {}
main() {
  a("here
}
		`);
		const sig = await getSignatureAt("here^");
		assert.ok(sig);
		// assert.equal(sig.activeParameter, 0);
		assert.equal(sig.activeSignature, 0);
		assert.equal(sig.signatures[0].label, "a(String name, {int age, int otherAge = 2})");
	});
});

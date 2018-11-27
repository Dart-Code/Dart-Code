import * as assert from "assert";
import * as vs from "vscode";
import { activate, currentDoc, extApi, positionOf, setTestContent } from "../../helpers";

describe("dart_signature_provider", () => {
	beforeEach("activate", () => activate());
	beforeEach("skip if analyzer doesn't support getSignature", function () {
		if (!extApi.analyzerCapabilities.supportsGetSignature)
			this.skip();
	});

	async function getSignatureAt(searchText: string): Promise<vs.SignatureHelp> {
		const position = positionOf(searchText);
		return (vs.commands.executeCommand("vscode.executeSignatureHelpProvider", currentDoc().uri, position) as Thenable<vs.SignatureHelp>);
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
		assert.equal(sig.label, "print(Object object)");
		assert.equal(sig.parameters.length, 1);
		assert.equal(sig.parameters[0].label, "Object object");
		assert.equal(sig.parameters[0].documentation, undefined);
		assert.equal((sig.documentation as vs.MarkdownString).value, "Prints a string representation of the object to the console.");
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

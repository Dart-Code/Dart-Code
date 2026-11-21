import { strict as assert } from "assert";
import * as path from "path";
import * as sinon from "sinon";
import { activate, ensureNoSnippet, ensureSnippet, getSnippetCompletionsAt, sb, setConfigForTest, setTestContent } from "../../helpers";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs") as typeof import("fs");

describe("snippets", () => {

	beforeEach("activate", () => activate());

	it("returns dart items", async () => {
		await setTestContent(`
		main() {
			for
		}
		`);
		const snippets = await getSnippetCompletionsAt("for^");
		ensureSnippet(snippets, "for", "for");
	});

	it("returns dart items before comment markers", async () => {
		await setTestContent(`
		main() {
			for // test
		}
		`);
		const snippets = await getSnippetCompletionsAt("for^");
		ensureSnippet(snippets, "for", "for");
	});

	it("does not return dart items after comment markers", async () => {
		await setTestContent(`
		main() {
			// for
		}
		`);
		const snippets = await getSnippetCompletionsAt("for^");
		ensureNoSnippet(snippets, "for");
	});

	it("does not returns dart items after comment markers that come after content", async () => {
		await setTestContent(`
		main() {
			some code // this will be a for loop
		}
		`);
		const snippets = await getSnippetCompletionsAt("for^");
		ensureNoSnippet(snippets, "for");
	});

	it("does not return flutter items", async () => {
		await setTestContent("stf");
		const snippets = await getSnippetCompletionsAt("stf^");
		ensureNoSnippet(snippets, "stful");
	});

	it("returns lazy-loaded client dart snippets when server snippets are disabled", async () => {
		const readFileSyncSpy = sb.spy(fs, "readFileSync");
		const isDartSnippetsRead = (call: sinon.SinonSpyCall) =>
			String(call.args[0]).endsWith(path.join("snippets", "dart.json"));

		await setConfigForTest("dart", "enableServerSnippets", false);
		await setTestContent(`
		main() {
			for
		}
		`);
		const snippets = await getSnippetCompletionsAt("for^");
		ensureSnippet(snippets, "for", "for");
		assert.equal(readFileSyncSpy.getCalls().filter(isDartSnippetsRead).length, 1);

		// Subsequent completions should reuse cached snippets without re-reading disk.
		const snippetsAgain = await getSnippetCompletionsAt("for^");
		ensureSnippet(snippetsAgain, "for", "for");
		assert.equal(readFileSyncSpy.getCalls().filter(isDartSnippetsRead).length, 1);
	});
});

import { strict as assert } from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getTestSuites } from "../../test_runner";

describe("getTestSuites", () => {
	let tempDir: string;

	// A testsRoot below a hidden ancestor directory, like a worktree checked
	// out below ".gemini" (https://github.com/Dart-Code/Dart-Code/issues/6299).
	let hiddenRoot: string;
	let appleFile: string;
	let bananaFile: string;

	// A layout mirroring the real "<repo>/out/src/test/<bot>" structure below
	// the hidden ancestor, with both dart and flutter test folders, used to
	// verify repository-relative filters stay working.
	let hiddenOutTestRoot: string;
	let dartFsFile: string;
	let flutterFsFile: string;

	// The same bot layout in a non-hidden location, as a control.
	let visibleRoot: string;
	let visibleFsFile: string;

	before(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dart-code-test-runner-"));

		hiddenRoot = path.join(tempDir, ".hidden", "tests");
		fs.mkdirSync(path.join(hiddenRoot, "sub"), { recursive: true });
		appleFile = path.resolve(hiddenRoot, "apple.test.js");
		bananaFile = path.resolve(hiddenRoot, "sub", "banana.test.js");
		fs.writeFileSync(appleFile, "");
		fs.writeFileSync(bananaFile, "");

		hiddenOutTestRoot = path.join(tempDir, ".hidden", "out", "src", "test");
		fs.mkdirSync(path.join(hiddenOutTestRoot, "dart", "utils"), { recursive: true });
		fs.mkdirSync(path.join(hiddenOutTestRoot, "flutter", "utils"), { recursive: true });
		dartFsFile = path.resolve(hiddenOutTestRoot, "dart", "utils", "fs.test.js");
		flutterFsFile = path.resolve(hiddenOutTestRoot, "flutter", "utils", "fs.test.js");
		fs.writeFileSync(dartFsFile, "");
		fs.writeFileSync(flutterFsFile, "");

		visibleRoot = path.join(tempDir, "visible", "out", "src", "test", "dart");
		fs.mkdirSync(path.join(visibleRoot, "utils"), { recursive: true });
		visibleFsFile = path.resolve(visibleRoot, "utils", "fs.test.js");
		fs.writeFileSync(visibleFsFile, "");
	});

	after(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("returns all files when there are no filters", async () => {
		assert.deepStrictEqual(await getTestSuites(hiddenRoot, undefined), [appleFile, bananaFile]);
	});

	it("matches file filters below a hidden ancestor directory", async () => {
		assert.deepStrictEqual(await getTestSuites(hiddenRoot, ["banana"]), [bananaFile]);
	});

	it("matches path-style filters below a hidden ancestor directory", async () => {
		assert.deepStrictEqual(await getTestSuites(hiddenRoot, ["sub/banana.test.ts"]), [bananaFile]);
	});

	it("matches filters with Windows-style separators below a hidden ancestor directory", async () => {
		assert.deepStrictEqual(await getTestSuites(hiddenRoot, ["sub\\banana.test.ts"]), [bananaFile]);
	});

	it("deduplicates files matched by multiple filters", async () => {
		assert.deepStrictEqual(await getTestSuites(hiddenRoot, ["banana", "sub/banana.test.ts"]), [bananaFile]);
		assert.deepStrictEqual(await getTestSuites(hiddenRoot, ["apple", "banana"]), [appleFile, bananaFile]);
	});

	it("matches documented repository-relative filters below a hidden ancestor directory", async () => {
		// AGENTS.md documents filters like
		// "npm run test src/test/dart/utils/fs.test.ts".
		assert.deepStrictEqual(await getTestSuites(hiddenOutTestRoot, ["src/test/dart/utils/fs.test.ts"]), [dartFsFile]);
		assert.deepStrictEqual(await getTestSuites(hiddenOutTestRoot, ["utils/fs.test.ts"]), [dartFsFile, flutterFsFile]);
	});

	it("does not let a dart-specific filter select flutter tests", async () => {
		assert.deepStrictEqual(await getTestSuites(hiddenOutTestRoot, ["src/test/dart/utils/fs.test.ts"]), [dartFsFile]);
	});

	it("still matches documented repository-relative filters outside hidden ancestors", async () => {
		assert.deepStrictEqual(await getTestSuites(visibleRoot, ["src/test/dart/utils/fs.test.ts"]), [visibleFsFile]);
		assert.deepStrictEqual(await getTestSuites(visibleRoot, ["utils/fs.test.ts"]), [visibleFsFile]);
	});
});

import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import { getRandomTempFolder, tryDelete } from "../../helpers";
import { getTestSuites } from "../../test_runner";

describe("getTestSuites", () => {
	let tempDir: string;

	// A testsRoot below a hidden ancestor directory, like a worktree checked
	// out below ".gemini" (https://github.com/Dart-Code/Dart-Code/issues/6299).
	let hiddenTestsRoot: string;
	let appleFile: string;
	let bananaFile: string;

	// A layout mirroring the real "<repo>/out/src/test/<bot>" structure below
	// the hidden ancestor, with a test file of the same name in both the dart
	// and flutter bot folders, used to verify repository-relative filters stay
	// working and filters select files only from the bot's own testsRoot.
	let hiddenDartRoot: string;
	let hiddenFlutterRoot: string;
	let dartFsFile: string;
	let flutterFsFile: string;

	// The same dart bot layout in a non-hidden location, as a control.
	let visibleDartRoot: string;
	let visibleFsFile: string;

	before(() => {
		tempDir = getRandomTempFolder();

		hiddenTestsRoot = path.join(tempDir, ".hidden", "tests");
		fs.mkdirSync(path.join(hiddenTestsRoot, "sub"), { recursive: true });
		fs.mkdirSync(path.join(hiddenTestsRoot, ".hidden_sub"), { recursive: true });
		appleFile = path.resolve(hiddenTestsRoot, "apple.test.js");
		bananaFile = path.resolve(hiddenTestsRoot, "sub", "banana.test.js");
		fs.writeFileSync(appleFile, "");
		fs.writeFileSync(bananaFile, "");
		fs.writeFileSync(path.join(hiddenTestsRoot, ".hidden_sub", "apple.test.js"), "");

		const hiddenOutTestRoot = path.join(tempDir, ".hidden", "out", "src", "test");
		hiddenDartRoot = path.join(hiddenOutTestRoot, "dart");
		hiddenFlutterRoot = path.join(hiddenOutTestRoot, "flutter");
		fs.mkdirSync(path.join(hiddenDartRoot, "utils"), { recursive: true });
		fs.mkdirSync(path.join(hiddenFlutterRoot, "utils"), { recursive: true });
		dartFsFile = path.resolve(hiddenDartRoot, "utils", "fs.test.js");
		flutterFsFile = path.resolve(hiddenFlutterRoot, "utils", "fs.test.js");
		fs.writeFileSync(dartFsFile, "");
		fs.writeFileSync(flutterFsFile, "");

		visibleDartRoot = path.join(tempDir, "project", "out", "src", "test", "dart");
		fs.mkdirSync(path.join(visibleDartRoot, "utils"), { recursive: true });
		visibleFsFile = path.resolve(visibleDartRoot, "utils", "fs.test.js");
		fs.writeFileSync(visibleFsFile, "");
	});

	after(() => {
		tryDelete(tempDir);
	});

	it("returns all files when there are no filters", async () => {
		assert.deepStrictEqual(await getTestSuites(hiddenTestsRoot, undefined), [appleFile, bananaFile]);
	});

	it("excludes files inside hidden subdirectories below testsRoot even when matching a filter", async () => {
		assert.deepStrictEqual(await getTestSuites(hiddenTestsRoot, ["apple"]), [appleFile]);
		assert.deepStrictEqual(await getTestSuites(hiddenTestsRoot, [".hidden_sub"]), []);
	});

	it("matches file filters below a hidden ancestor directory", async () => {
		assert.deepStrictEqual(await getTestSuites(hiddenTestsRoot, ["banana"]), [bananaFile]);
	});

	it("matches path-style filters below a hidden ancestor directory", async () => {
		assert.deepStrictEqual(await getTestSuites(hiddenTestsRoot, ["sub/banana.test.ts"]), [bananaFile]);
	});

	it("matches filters with Windows-style separators below a hidden ancestor directory", async () => {
		assert.deepStrictEqual(await getTestSuites(hiddenTestsRoot, ["sub\\banana.test.ts"]), [bananaFile]);
	});

	it("deduplicates files matched by multiple filters", async () => {
		assert.deepStrictEqual(await getTestSuites(hiddenTestsRoot, ["banana", "sub/banana.test.ts"]), [bananaFile]);
		assert.deepStrictEqual(await getTestSuites(hiddenTestsRoot, ["apple", "banana"]), [appleFile, bananaFile]);
	});

	it("matches documented repository-relative filters below a hidden ancestor directory", async () => {
		// AGENTS.md documents filters like
		// "npm run test src/test/dart/utils/fs.test.ts".
		assert.deepStrictEqual(await getTestSuites(hiddenDartRoot, ["src/test/dart/utils/fs.test.ts"]), [dartFsFile]);
		assert.deepStrictEqual(await getTestSuites(hiddenDartRoot, ["utils/fs.test.ts"]), [dartFsFile]);
	});

	it("does not let a dart-specific filter select flutter tests", async () => {
		// The same filename exists in both bots, but a filter that includes the
		// "dart" bot path selects nothing when run against the flutter bot's
		// testsRoot, and vice versa.
		assert.deepStrictEqual(await getTestSuites(hiddenFlutterRoot, ["src/test/dart/utils/fs.test.ts"]), []);
		assert.deepStrictEqual(await getTestSuites(hiddenDartRoot, ["src/test/flutter/utils/fs.test.ts"]), []);
		assert.deepStrictEqual(await getTestSuites(hiddenFlutterRoot, ["src/test/flutter/utils/fs.test.ts"]), [flutterFsFile]);
	});

	it("still matches documented repository-relative filters outside hidden ancestors", async () => {
		assert.deepStrictEqual(await getTestSuites(visibleDartRoot, ["src/test/dart/utils/fs.test.ts"]), [visibleFsFile]);
		assert.deepStrictEqual(await getTestSuites(visibleDartRoot, ["utils/fs.test.ts"]), [visibleFsFile]);
	});
});

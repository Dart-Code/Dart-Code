import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import { Uri } from "vscode";
import { isWin } from "../../../shared/constants";
import { nullLogger } from "../../../shared/logging";
import { existsAndIsDirectoryAsync, existsAndIsDirectorySync, existsAndIsFileAsync, existsAndIsFileSync, extractFlutterSdkPathFromPackagesFile, findCommonAncestorFolder, findProjectFolders, fsPath, getPackageName, hasPackageMapFile, hasPubspec, mkDirRecursive, uriComparisonString } from "../../../shared/utils/fs";
import { createTempPubPackage, defer, fakeCancellationToken, flutterHelloWorldFolder, getRandomTempFolder, helloWorldExampleSubFolder, helloWorldFolder, helloWorldMainFile, helloWorldTestFolder, logger, testProjectsFolder, tryDelete } from "../../helpers";

describe("findCommonAncestorFolder", () => {
	it("handles empty array", () => {
		assert.equal(findCommonAncestorFolder([]), undefined);
	});

	it("handles single item array", () => {
		assert.equal(
			findCommonAncestorFolder([
				fsPath(helloWorldFolder),
			]),
			fsPath(helloWorldFolder),
		);
	});

	it("handles multiple folders with shared ancestor", () => {
		assert.equal(
			findCommonAncestorFolder([
				fsPath(helloWorldFolder),
				fsPath(helloWorldTestFolder),
				fsPath(flutterHelloWorldFolder),
			]),
			fsPath(Uri.file(testProjectsFolder)),
		);
	});

	it("returns undefined for paths without a shared ancestor", () => {
		assert.equal(
			findCommonAncestorFolder([
				fsPath(helloWorldFolder),
				fsPath(helloWorldTestFolder),
				fsPath(flutterHelloWorldFolder),
				isWin ? "Z:\\foo\\bar" : "/foo/bar",
			]),
			undefined,
		);
	});
});

describe("uriComparisonString", () => {
	it("handles differences in drive letter casing for file scheme", function () {
		if (!isWin)
			this.skip();

		// Upper
		assert.equal(
			uriComparisonString(Uri.file("C:\\test\\test")),
			"file:c:\\test\\test",
		);
		// Lower
		assert.equal(
			uriComparisonString(Uri.file("c:\\test\\test")),
			"file:c:\\test\\test",
		);
	});

	it("handles URIs", function () {
		if (!isWin)
			this.skip();

		assert.equal(
			uriComparisonString(Uri.parse("http://foo/bar")),
			"http://foo/bar",
		);
	});
});

describe("getPackageName", () => {
	it("uses the package name from pubspec.yaml when available", () => {
		const projectFolder = createTempPubPackage("my_custom_package", "workspace_project");
		assert.equal(getPackageName(projectFolder), "my_custom_package");
	});

	it("falls back to the folder name when pubspec.yaml is missing", () => {
		const tempFolder = getRandomTempFolder();
		const projectFolder = path.join(tempFolder, "workspace_project");
		defer("delete temp folder", () => tryDelete(projectFolder));

		fs.mkdirSync(projectFolder, { recursive: true });
		assert.equal(getPackageName(projectFolder), "workspace_project");
	});
});

describe("extractFlutterSdkPathFromPackagesFile", () => {
	let tempFolder: string;
	let fakeFlutterRoot: string;

	beforeEach(() => {
		tempFolder = getRandomTempFolder();
		fakeFlutterRoot = path.join(tempFolder, "flutter_fake");
		mkDirRecursive(path.join(fakeFlutterRoot, "bin"));
		defer("delete temp folder", () => tryDelete(tempFolder));
	});

	function createPackageConfig({
		flutterRootUri,
		flutterPackageRootUri,
	}: {
		flutterRootUri?: Uri,
		flutterPackageRootUri?: Uri,
	}) {
		const dartToolDir = path.join(tempFolder, ".dart_tool");
		fs.mkdirSync(dartToolDir, { recursive: true });

		const packages = [];
		if (flutterPackageRootUri) {
			packages.push({
				languageVersion: "2.12",
				name: "flutter",
				packageUri: "lib/",
				rootUri: flutterPackageRootUri?.toString(),
			});
		}

		const config = {
			configVersion: 2,
			flutterRoot: flutterRootUri?.toString(),
			packages,
		};

		fs.writeFileSync(path.join(dartToolDir, "package_config.json"), JSON.stringify(config));
	}

	it("returns SDK path from package path", () => {
		const flutterPackageRootUri = Uri.file(path.join(fakeFlutterRoot, "packages", "flutter"));

		createPackageConfig({ flutterPackageRootUri });

		const sdkPath = extractFlutterSdkPathFromPackagesFile(tempFolder);
		const expectedSdkPath = path.join(fakeFlutterRoot, "bin") + path.sep;
		assert.equal(sdkPath?.toLowerCase(), expectedSdkPath.toLowerCase());
	});

	it("returns SDK path from flutterRoot, prioritizing it over package path", () => {
		const fakeFlutterRootUri = Uri.file(fakeFlutterRoot);
		const fakeFlutterPackageRootUri = Uri.file(path.join(fakeFlutterRoot, "packages", "flutter"));

		createPackageConfig({
			flutterPackageRootUri: fakeFlutterPackageRootUri,
			flutterRootUri: fakeFlutterRootUri,
		});

		const sdkPath = extractFlutterSdkPathFromPackagesFile(tempFolder);
		const expectedSdkPath = path.join(fakeFlutterRoot, "bin") + path.sep;
		assert.equal(sdkPath?.toLowerCase(), expectedSdkPath.toLowerCase());
	});

	it("handles missing URIs", function () {
		if (!isWin)
			this.skip();

		createPackageConfig({});

		const sdkPath = extractFlutterSdkPathFromPackagesFile(tempFolder);
		assert.equal(sdkPath, undefined);
	});

	it("handles non-Windows file URI in package path on Windows", function () {
		if (!isWin)
			this.skip();

		createPackageConfig({
			flutterPackageRootUri: Uri.parse("file:///home/test/flutter/packages/flutter"),
		});

		const sdkPath = extractFlutterSdkPathFromPackagesFile(tempFolder);
		assert.equal(sdkPath, undefined);
	});

	it("handles Windows file URI in package path on non-Windows", function () {
		if (isWin)
			this.skip();

		createPackageConfig({
			flutterPackageRootUri: Uri.parse("file:///C:/src/flutter/packages/flutter"),
		});

		const sdkPath = extractFlutterSdkPathFromPackagesFile(tempFolder);
		assert.equal(sdkPath, undefined);
	});

	it("handles non-Windows file URI in flutterRoot on Windows", function () {
		if (!isWin)
			this.skip();

		createPackageConfig({
			flutterRootUri: Uri.parse("file:///home/test/flutter"),
		});

		const sdkPath = extractFlutterSdkPathFromPackagesFile(tempFolder);
		assert.equal(sdkPath, undefined);
	});

	it("handles Windows file URI in flutterRoot on non-Windows", function () {
		if (isWin)
			this.skip();

		createPackageConfig({
			flutterRootUri: Uri.parse("file:///C:/src/flutter"),
		});

		const sdkPath = extractFlutterSdkPathFromPackagesFile(tempFolder);
		assert.equal(sdkPath, undefined);
	});
});

describe("existsAndIsFileSync", () => {
	it("should return true for an existing file", () => {
		assert.equal(existsAndIsFileSync(fsPath(helloWorldMainFile)), true);
	});

	it("should return false for a non-existent path", () => {
		const missingFile = path.join(fsPath(helloWorldFolder), "does_not_exist.dart");
		assert.equal(existsAndIsFileSync(missingFile), false);
	});

	it("should return false for a folder", () => {
		assert.equal(existsAndIsFileSync(fsPath(helloWorldFolder)), false);
	});

	it("should return false for a path that is a subpath of a file", () => {
		const fileInsideFile = path.join(fsPath(helloWorldMainFile), "pubspec.yaml");
		assert.equal(existsAndIsFileSync(fileInsideFile), false);
	});
});

describe("existsAndIsDirectorySync", () => {
	it("should return true for an existing folder", () => {
		assert.equal(existsAndIsDirectorySync(fsPath(helloWorldFolder)), true);
	});

	it("should return false for a non-existent path", () => {
		const missingFile = path.join(fsPath(helloWorldFolder), "does_not_exist");
		assert.equal(existsAndIsDirectorySync(missingFile), false);
	});

	it("should return false for a file", () => {
		assert.equal(existsAndIsDirectorySync(fsPath(helloWorldMainFile)), false);
	});

	it("should return false for a path that is a subpath of a file", () => {
		const fileInsideFile = path.join(fsPath(helloWorldMainFile), "pubspec.yaml");
		assert.equal(existsAndIsDirectorySync(fileInsideFile), false);
	});
});

describe("existsAndIsFileAsync", () => {
	it("should return true for an existing file", async () => {
		assert.equal(await existsAndIsFileAsync(fsPath(helloWorldMainFile)), true);
	});

	it("should return false for a non-existent path", async () => {
		const missingFile = path.join(fsPath(helloWorldFolder), "does_not_exist.dart");
		assert.equal(await existsAndIsFileAsync(missingFile), false);
	});

	it("should return false for a folder", async () => {
		assert.equal(await existsAndIsFileAsync(fsPath(helloWorldFolder)), false);
	});

	it("should return false for a path that is a subpath of a file", async () => {
		const fileInsideFile = path.join(fsPath(helloWorldMainFile), "pubspec.yaml");
		assert.equal(await existsAndIsFileAsync(fileInsideFile), false);
	});
});

describe("existsAndIsDirectoryAsync", () => {
	it("should return true for an existing folder", async () => {
		assert.equal(await existsAndIsDirectoryAsync(fsPath(helloWorldFolder)), true);
	});

	it("should return false for a non-existent path", async () => {
		const missingFile = path.join(fsPath(helloWorldFolder), "does_not_exist");
		assert.equal(await existsAndIsDirectoryAsync(missingFile), false);
	});

	it("should return false for a file", async () => {
		assert.equal(await existsAndIsDirectoryAsync(fsPath(helloWorldMainFile)), false);
	});

	it("should return false for a path that is a subpath of a file", async () => {
		const fileInsideFile = path.join(fsPath(helloWorldMainFile), "pubspec.yaml");
		assert.equal(await existsAndIsDirectoryAsync(fileInsideFile), false);
	});
});

describe("hasPubspec", () => {
	it("should return false for a path that is a subpath of a file", () => {
		const fileInsideFile = path.join(fsPath(helloWorldMainFile), "pubspec.yaml");
		assert.equal(hasPubspec(fileInsideFile), false);
	});
});

describe("hasPackageMapFile", () => {
	it("should return false for a path that is a subpath of a file", () => {
		const fileInsideFile = path.join(fsPath(helloWorldMainFile), "pubspec.yaml");
		assert.equal(hasPackageMapFile(fileInsideFile), false);
	});
});

describe("findProjectFolders", () => {
	let tempFolder: string;

	beforeEach(() => {
		tempFolder = getRandomTempFolder();
		defer("delete temp folder", () => tryDelete(tempFolder));
	});

	function createPubspec(relativeFolder: string) {
		const folder = path.join(tempFolder, relativeFolder);
		fs.mkdirSync(folder, { recursive: true });
		fs.writeFileSync(path.join(folder, "pubspec.yaml"), "name: test\n");
		return folder;
	}

	it("excludes .dart_tool and .widget_preview folders and their children", async () => {
		const mainProject = createPubspec("my_project");
		const subProject = createPubspec(path.join("my_project", "sub_project"));
		const excludedProject = createPubspec(path.join("my_project", "excluded_project"));
		createPubspec(path.join("my_project", ".dart_tool"));
		createPubspec(path.join("my_project", ".dart_tool", "nested_project"));
		createPubspec(path.join("my_project", ".widget_preview"));
		createPubspec(path.join("my_project", ".widget_preview", "nested_project"));

		const projects = await findProjectFolders(
			nullLogger,
			[tempFolder],
			[excludedProject],
			{ requirePubspec: true, sort: true, searchDepth: 5 },
			{ isCancellationRequested: false },
		);

		assert.deepStrictEqual(projects, [mainProject, subProject]);
	});

	it("does not return duplicate project folders when roots are nested", async () => {
		// https://github.com/Dart-Code/Dart-Code/issues/6215
		const roots = [
			fsPath(helloWorldFolder),
			fsPath(helloWorldExampleSubFolder),
		];
		const projects = await findProjectFolders(logger, roots, [], { requirePubspec: true, searchDepth: 5 }, fakeCancellationToken);
		assert.deepStrictEqual(projects, [
			fsPath(helloWorldFolder),
			fsPath(helloWorldExampleSubFolder),
			path.join(fsPath(helloWorldFolder), "nested_flutter_example"),
		]);
	});

	it("searches full searchDepth from nested roots without re-scanning nested roots", async () => {
		const outerRoot = path.join(tempFolder, "outer");
		const innerRoot = path.join(outerRoot, "level1", "inner_root");
		const innerProject = path.join(innerRoot, "level2", "inner_project");
		const deepProject = path.join(innerProject, "level3", "deep_project");
		mkDirRecursive(deepProject);
		fs.writeFileSync(path.join(innerProject, "pubspec.yaml"), "name: inner_project\n");
		fs.writeFileSync(path.join(deepProject, "pubspec.yaml"), "name: deep_project\n");

		// With searchDepth = 5:
		// - outerRoot (depth 1) -> level1 (depth 2) -> inner_root (depth 3) -> level2 (depth 4) -> inner_project (depth 5):
		//   cannot reach deep_project (depth 7 from outerRoot), AND would discover inner_project a second time if inner_root was not skipped.
		// - inner_root (depth 1) -> level2 (depth 2) -> inner_project (depth 3) -> level3 (depth 4) -> deep_project (depth 5):
		//   reaches both inner_project and deep_project.
		const projects = await findProjectFolders(logger, [outerRoot, innerRoot], [], { requirePubspec: true, searchDepth: 5 }, fakeCancellationToken);
		assert.deepStrictEqual(projects, [innerProject, deepProject]);
	});
});

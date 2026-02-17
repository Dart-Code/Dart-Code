import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import { Uri } from "vscode";
import { isWin } from "../../../shared/constants";
import { extractFlutterSdkPathFromPackagesFile, findCommonAncestorFolder, fsPath, getPackageName, mkDirRecursive, uriComparisonString } from "../../../shared/utils/fs";
import { defer, flutterHelloWorldFolder, getRandomTempFolder, helloWorldFolder, helloWorldTestFolder, testProjectsFolder, tryDeleteDirectoryRecursive } from "../../helpers";

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
		const tempFolder = getRandomTempFolder();
		const projectFolder = path.join(tempFolder, "workspace_project");
		defer("delete temp folder", () => tryDeleteDirectoryRecursive(projectFolder));

		fs.mkdirSync(projectFolder, { recursive: true });
		fs.writeFileSync(path.join(projectFolder, "pubspec.yaml"), "name: my_custom_package\n");
		assert.equal(getPackageName(projectFolder), "my_custom_package");
	});

	it("falls back to the folder name when pubspec.yaml is missing", () => {
		const tempFolder = getRandomTempFolder();
		const projectFolder = path.join(tempFolder, "workspace_project");
		defer("delete temp folder", () => tryDeleteDirectoryRecursive(projectFolder));

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
		defer("delete temp folder", () => tryDeleteDirectoryRecursive(tempFolder));
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

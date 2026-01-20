import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import { Uri } from "vscode";
import { isWin } from "../../../shared/constants";
import { extractFlutterSdkPathFromPackagesFile, findCommonAncestorFolder, fsPath, getPackageName, uriComparisonString } from "../../../shared/utils/fs";
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
	let flutterRoot: string;

	beforeEach(() => {
		tempFolder = getRandomTempFolder();
		defer("delete temp folder", () => tryDeleteDirectoryRecursive(tempFolder));
		flutterRoot = path.join(tempFolder, "flutter");
	});

	function createPackageConfig({ flutterRoot, flutterPackageRoot }: { flutterRoot?: string, flutterPackageRoot?: string }) {
		const dartToolDir = path.join(tempFolder, ".dart_tool");
		fs.mkdirSync(dartToolDir, { recursive: true });

		const packages = [];
		if (flutterPackageRoot) {
			packages.push({
				languageVersion: "2.12",
				name: "flutter",
				packageUri: "lib/",
				rootUri: Uri.file(flutterPackageRoot).toString(),
			});
		}

		const config = {
			configVersion: 2,
			flutterRoot: flutterRoot ? Uri.file(flutterRoot).toString() : undefined,
			packages,
		};

		fs.writeFileSync(path.join(dartToolDir, "package_config.json"), JSON.stringify(config));
	}

	it("returns SDK path from package path", () => {
		const flutterPackageRoot = path.join(flutterRoot, "packages", "flutter");

		createPackageConfig({ flutterPackageRoot });

		const sdkPath = extractFlutterSdkPathFromPackagesFile(tempFolder);
		const expectedSdkPath = path.join(flutterRoot, "bin") + path.sep;
		assert.equal(sdkPath?.toLowerCase(), expectedSdkPath.toLowerCase());
	});

	it("returns SDK path from flutterRoot, prioritizing it over package path", () => {
		const fakeFlutterRoot = path.join(tempFolder, "flutter_fake");
		const fakeFlutterPackageRoot = path.join(fakeFlutterRoot, "packages", "flutter");

		createPackageConfig({
			flutterPackageRoot: fakeFlutterPackageRoot,
			flutterRoot,
		});

		const sdkPath = extractFlutterSdkPathFromPackagesFile(tempFolder);
		const expectedSdkPath = path.join(flutterRoot, "bin") + path.sep;
		assert.equal(sdkPath?.toLowerCase(), expectedSdkPath.toLowerCase());
	});
});

import { strict as assert } from "assert";
import * as os from "os";
import * as path from "path";
import * as vs from "vscode";
import { isWin } from "../../shared/constants";
import { escapeDartString, generateTestNameFromFileName, isDartSdkFromFlutter, isStableSdk, pubVersionIsAtLeast, versionIsAtLeast } from "../../shared/utils";
import { arrayContainsArray } from "../../shared/utils/array";
import { applyColor, red } from "../../shared/utils/colors";
import { fsPath, homeRelativePath, isWithinPath, isWithinPathOrEqual } from "../../shared/utils/fs";
import { resolvePaths } from "../../shared/vscode/utils";
import { emptyFile, everythingFile, ext, flutterEmptyFile, flutterHelloWorldFolder, flutterHelloWorldMainFile, helloWorldFolder, helloWorldMainFile, sb } from "../helpers";

describe("versionIsAtLeast", () => {
	it("should not consider build numbers when comparing versions", () => {
		assert.equal(versionIsAtLeast("1.2.3", "1.2.3"), true);
		assert.equal(versionIsAtLeast("1.2.3+012345", "1.2.3"), true);
	});
	it("should consider pre-release versions older than release versions", () => {
		assert.equal(versionIsAtLeast("1.2.3-alpha", "1.2.3"), false);
		assert.equal(versionIsAtLeast("1.2.3-alpha+012345", "1.2.3"), false);
	});
	it("should compare segments as individual numbers, not decimals", () => {
		assert.equal(versionIsAtLeast("1.9.0", "1.10.0"), false);
	});
	it("should return the correct result for some real world tests", () => {
		assert.equal(versionIsAtLeast("1.2.0", "1.18.1"), false);
		assert.equal(versionIsAtLeast("1.18.0", "1.18.1"), false);
		assert.equal(versionIsAtLeast("1.18.1", "1.18.1"), true);
		assert.equal(versionIsAtLeast("1.19.0", "1.18.1"), true);
		assert.equal(versionIsAtLeast("1.19.0-dev.0.0", "1.18.1"), true);
		assert.equal(versionIsAtLeast("1.19.0-dev.5.0", "1.18.1"), true);
		assert.equal(versionIsAtLeast("1.19.0-dev.7.0", "1.18.1"), true);
		assert.equal(versionIsAtLeast("1.19.1-dev.0.0", "1.19.0"), true);
		assert.equal(versionIsAtLeast("0.10.2-pre.119", "0.10.2"), false);
		assert.equal(versionIsAtLeast("0.10.1", "0.10.2-a"), false);
		assert.equal(versionIsAtLeast("0.10.1-pre.119", "0.10.2-a"), false);
		assert.equal(versionIsAtLeast("0.10.2-pre.119", "0.10.2-a"), true);
		assert.equal(versionIsAtLeast("0.10.3-pre.119", "0.10.2-a"), true);
		assert.equal(versionIsAtLeast("0.10.2-alpha.1", "0.10.2-a"), true);
		assert.equal(versionIsAtLeast("0.10.2-beta.1", "0.10.2-a"), true);
		assert.equal(versionIsAtLeast("2.2.0", "2.2.1-edge"), false);
		assert.equal(versionIsAtLeast("2.2.1-dev", "2.2.1-edge"), false);
		assert.equal(versionIsAtLeast("2.2.1-dev.1", "2.2.1-edge"), false);
		assert.equal(versionIsAtLeast("2.2.1-edge", "2.2.1-edge"), true);
		assert.equal(versionIsAtLeast("2.2.1-edge.foo", "2.2.1-edge"), true);
	});
});

describe("pubVersionIsAtLeast", () => {
	it("should consider build metadata newer than without", () => {
		assert.equal(pubVersionIsAtLeast("1.2.3+012345", "1.2.3"), true);
		assert.equal(pubVersionIsAtLeast("1.2.3", "1.2.3+012345"), false);
	});
	it("should sort build metadata the same way as pre-release", () => {
		assert.equal(pubVersionIsAtLeast("1.2.3+123", "1.2.3+122"), true);
		assert.equal(pubVersionIsAtLeast("1.2.3+122", "1.2.3+123"), false);
	});
	it("should sort pre-release before build metadata", () => {
		assert.equal(pubVersionIsAtLeast("1.2.3-123", "1.2.3+122"), false);
		assert.equal(pubVersionIsAtLeast("1.2.3+122", "1.2.3-123"), true);
		assert.equal(pubVersionIsAtLeast("1.2.3-123+122", "1.2.3-122+123"), true);
		assert.equal(pubVersionIsAtLeast("1.2.3-122+123", "1.2.3-123+122"), false);
	});
	it("should sort by build metadata if pre-release is equal", () => {
		assert.equal(pubVersionIsAtLeast("1.2.3-123+123", "1.2.3-123+122"), true);
		assert.equal(pubVersionIsAtLeast("1.2.3-123+122", "1.2.3-123+123"), false);
	});
});

describe("isStableSdk", () => {
	it("should consider missing versions as unstable", () => {
		assert.equal(isStableSdk(), false);
		assert.equal(isStableSdk(undefined), false);
	});
	it("should consider anything without a hyphen as stable", () => {
		assert.equal(isStableSdk("1.0.0"), true);
		assert.equal(isStableSdk("1.2.0"), true);
		assert.equal(isStableSdk("1.2.3"), true);
	});
	it("should consider anything with a hyphen as unstable", () => {
		assert.equal(isStableSdk("1.0.0-dev"), false);
		assert.equal(isStableSdk("1.2.0-beta"), false);
		assert.equal(isStableSdk("1.2.3-alpha.3"), false);
		assert.equal(isStableSdk("0.2.2-pre.55"), false);
		assert.equal(isStableSdk("2.0.0-dev.37.0.flutter-7328726088"), false);
	});
});

describe("util.isDartSdkFromFlutter", () => {
	it("should consider Dart SDK to not be from Flutter", function () {
		if (!process.env.DART_PATH) {
			this.skip();
			return;
		}

		assert.equal(isDartSdkFromFlutter(process.env.DART_PATH), false);
	});
	it("should consider Flutter's Dart SDK to be from Flutter", function () {
		if (!process.env.FLUTTER_PATH) {
			this.skip();
			return;
		}

		assert.equal(isDartSdkFromFlutter(path.join(process.env.FLUTTER_PATH, "bin", "cache", "dart-sdk")), true);
	});
});

describe("applyColor", () => {
	const redPrefix = "\u001b[38;5;1m";
	const reset = "\u001b[0m";
	it("should work with strings with no whitespace", () => {
		assert.equal(applyColor("This is a test", red), `${redPrefix}This is a test${reset}`);
	});
	it("should work with leading whitespace", () => {
		assert.equal(applyColor("\n\n  This is a test", red), `\n\n  ${redPrefix}This is a test${reset}`);
	});
	it("should work with trailing whitespace", () => {
		assert.equal(applyColor("This is a test  \n\n", red), `${redPrefix}This is a test${reset}  \n\n`);
	});
	it("should work with leading and trailing whitespace", () => {
		assert.equal(applyColor("\n \n This is a test \n \n", red), `\n \n ${redPrefix}This is a test${reset} \n \n`);
	});
});

describe("generateTestNameFromFileName", () => {
	it("generates expected names", () => {
		assert.equal(generateTestNameFromFileName(path.join("test", "screens", "blank_test.dart")), "blank");
	});
});

describe("escapeDartString", () => {
	it("escapes expected characters", () => {
		assert.equal(escapeDartString(`test's some quote"s and \\slashs`), `test\\'s some quote\\"s and \\\\slashs`);
	});
});

describe("isWithinPath", () => {
	it("should return true for children", () => {
		assert.equal(isWithinPath(fsPath(helloWorldFolder), ext.extensionPath), true);
		assert.equal(isWithinPath(fsPath(emptyFile), ext.extensionPath), true);
		assert.equal(isWithinPath(fsPath(everythingFile), ext.extensionPath), true);
		assert.equal(isWithinPath(fsPath(emptyFile), fsPath(helloWorldFolder)), true);
		assert.equal(isWithinPath(fsPath(everythingFile), fsPath(helloWorldFolder)), true);

		assert.equal(isWithinPath(fsPath(flutterHelloWorldFolder), ext.extensionPath), true);
		assert.equal(isWithinPath(fsPath(flutterEmptyFile), ext.extensionPath), true);
		assert.equal(isWithinPath(fsPath(flutterHelloWorldMainFile), ext.extensionPath), true);
		assert.equal(isWithinPath(fsPath(flutterEmptyFile), fsPath(flutterHelloWorldFolder)), true);
		assert.equal(isWithinPath(fsPath(flutterHelloWorldMainFile), fsPath(flutterHelloWorldFolder)), true);
	});

	it("should return false for parents", () => {
		assert.equal(isWithinPath(ext.extensionPath, fsPath(helloWorldFolder)), false);
		assert.equal(isWithinPath(ext.extensionPath, fsPath(emptyFile)), false);
		assert.equal(isWithinPath(ext.extensionPath, fsPath(everythingFile)), false);
		assert.equal(isWithinPath(fsPath(helloWorldFolder), fsPath(emptyFile)), false);
		assert.equal(isWithinPath(fsPath(helloWorldFolder), fsPath(everythingFile)), false);

		assert.equal(isWithinPath(ext.extensionPath, fsPath(flutterHelloWorldFolder)), false);
		assert.equal(isWithinPath(ext.extensionPath, fsPath(flutterEmptyFile)), false);
		assert.equal(isWithinPath(ext.extensionPath, fsPath(flutterHelloWorldMainFile)), false);
		assert.equal(isWithinPath(fsPath(flutterHelloWorldFolder), fsPath(flutterEmptyFile)), false);
		assert.equal(isWithinPath(fsPath(flutterHelloWorldFolder), fsPath(flutterHelloWorldMainFile)), false);
	});

	it("should return false for same input", () => {
		assert.equal(isWithinPath(ext.extensionPath, ext.extensionPath), false);
		assert.equal(isWithinPath(fsPath(helloWorldFolder), fsPath(helloWorldFolder)), false);
		assert.equal(isWithinPath(fsPath(emptyFile), fsPath(emptyFile)), false);
		assert.equal(isWithinPath(fsPath(everythingFile), fsPath(everythingFile)), false);
		assert.equal(isWithinPath(fsPath(flutterHelloWorldFolder), fsPath(flutterHelloWorldFolder)), false);
		assert.equal(isWithinPath(fsPath(flutterEmptyFile), fsPath(flutterEmptyFile)), false);
		assert.equal(isWithinPath(fsPath(flutterHelloWorldMainFile), fsPath(flutterHelloWorldMainFile)), false);
	});
});

describe("isWithinPathOrEqual", () => {
	it("should return true for children", () => {
		assert.equal(isWithinPathOrEqual(fsPath(helloWorldFolder), ext.extensionPath), true);
		assert.equal(isWithinPathOrEqual(fsPath(emptyFile), ext.extensionPath), true);
		assert.equal(isWithinPathOrEqual(fsPath(everythingFile), ext.extensionPath), true);
		assert.equal(isWithinPathOrEqual(fsPath(emptyFile), fsPath(helloWorldFolder)), true);
		assert.equal(isWithinPathOrEqual(fsPath(everythingFile), fsPath(helloWorldFolder)), true);

		assert.equal(isWithinPathOrEqual(fsPath(flutterHelloWorldFolder), ext.extensionPath), true);
		assert.equal(isWithinPathOrEqual(fsPath(flutterEmptyFile), ext.extensionPath), true);
		assert.equal(isWithinPathOrEqual(fsPath(flutterHelloWorldMainFile), ext.extensionPath), true);
		assert.equal(isWithinPathOrEqual(fsPath(flutterEmptyFile), fsPath(flutterHelloWorldFolder)), true);
		assert.equal(isWithinPathOrEqual(fsPath(flutterHelloWorldMainFile), fsPath(flutterHelloWorldFolder)), true);
	});

	it("should return false for parents", () => {
		assert.equal(isWithinPathOrEqual(ext.extensionPath, fsPath(helloWorldFolder)), false);
		assert.equal(isWithinPathOrEqual(ext.extensionPath, fsPath(emptyFile)), false);
		assert.equal(isWithinPathOrEqual(ext.extensionPath, fsPath(everythingFile)), false);
		assert.equal(isWithinPathOrEqual(fsPath(helloWorldFolder), fsPath(emptyFile)), false);
		assert.equal(isWithinPathOrEqual(fsPath(helloWorldFolder), fsPath(everythingFile)), false);

		assert.equal(isWithinPathOrEqual(ext.extensionPath, fsPath(flutterHelloWorldFolder)), false);
		assert.equal(isWithinPathOrEqual(ext.extensionPath, fsPath(flutterEmptyFile)), false);
		assert.equal(isWithinPathOrEqual(ext.extensionPath, fsPath(flutterHelloWorldMainFile)), false);
		assert.equal(isWithinPathOrEqual(fsPath(flutterHelloWorldFolder), fsPath(flutterEmptyFile)), false);
		assert.equal(isWithinPathOrEqual(fsPath(flutterHelloWorldFolder), fsPath(flutterHelloWorldMainFile)), false);
	});

	it("should return true for same input", () => {
		assert.equal(isWithinPathOrEqual(ext.extensionPath, ext.extensionPath), true);
		assert.equal(isWithinPathOrEqual(fsPath(helloWorldFolder), fsPath(helloWorldFolder)), true);
		assert.equal(isWithinPathOrEqual(fsPath(emptyFile), fsPath(emptyFile)), true);
		assert.equal(isWithinPathOrEqual(fsPath(everythingFile), fsPath(everythingFile)), true);
		assert.equal(isWithinPathOrEqual(fsPath(flutterHelloWorldFolder), fsPath(flutterHelloWorldFolder)), true);
		assert.equal(isWithinPathOrEqual(fsPath(flutterEmptyFile), fsPath(flutterEmptyFile)), true);
		assert.equal(isWithinPathOrEqual(fsPath(flutterHelloWorldMainFile), fsPath(flutterHelloWorldMainFile)), true);
	});
});

describe("arrayContainsArray", () => {
	it("handles haystacks that equal needle", () => {
		assert.equal(arrayContainsArray([1], [1]), true);
		assert.equal(arrayContainsArray([1, 2], [1, 2]), true);
	});
	it("handles haystacks that start with needle", () => {
		assert.equal(arrayContainsArray([1, 2], [1]), true);
		assert.equal(arrayContainsArray([1, 2, 3], [1, 2]), true);
	});
	it("handles haystacks that contain needle", () => {
		assert.equal(arrayContainsArray([0, 1, 2], [1]), true);
		assert.equal(arrayContainsArray([0, 1, 2, 3], [1, 2]), true);
	});
	it("handles haystacks that end with needle", () => {
		assert.equal(arrayContainsArray([0, 1], [1]), true);
		assert.equal(arrayContainsArray([0, 1, 2], [1, 2]), true);
	});
	it("handles haystacks that do not contain needle", () => {
		assert.equal(arrayContainsArray([], [1]), false);
		assert.equal(arrayContainsArray([1], [1, 1]), false);
		assert.equal(arrayContainsArray([0, 2, 3], [3, 2, 0]), false);
	});
});

describe("homeRelativePath", () => {
	it("handle non-home dir", () => {
		if (isWin) {
			assert.equal(homeRelativePath("C:\\foo\\bar"), "C:\\foo\\bar");
		} else {
			assert.equal(homeRelativePath("/foo/bar"), "/foo/bar");
		}
	});
	it("handles home dir", () => {
		// We always use forward slashes for home-dir-relative paths, even on Windows.
		assert.equal(homeRelativePath(path.join(os.homedir(), "foo", "bar")), "~/foo/bar");
	});
});

describe("resolvePaths", () => {
	it("does not map absolute paths", () => {
		const fullPath = fsPath(helloWorldMainFile);
		assert.equal(resolvePaths(fullPath), fullPath);
	});

	const sampleWorkspaceFilePath = path.join(fsPath(flutterHelloWorldFolder), "foo.code-workspace");
	const sampleWorkspaceFileUri = vs.Uri.file(sampleWorkspaceFilePath);
	const sampleWorkspaceFolderPath = path.dirname(sampleWorkspaceFilePath);

	it("maps relative path with file:/// workspace file", () => {
		sb.stub(vs.workspace, "workspaceFile").get(() => sampleWorkspaceFileUri);
		assert.equal(resolvePaths("./foo"), path.join(sampleWorkspaceFolderPath, "foo"));
	});

	it("maps relative path with open folder for non-file:/// workspace file", () => {
		sb.stub(vs.workspace, "workspaceFile").get(() => sampleWorkspaceFileUri.with({ scheme: "untitled" }));
		// The workspace file is not file:/// so we ignore it (opening multiple folders are once creates an untitled-scheme workspace file).
		assert.equal(resolvePaths("./foo"), path.join(fsPath(helloWorldFolder), "foo"));
	});

	it("maps relative path with open folder for non-workspace", () => {
		assert.equal(resolvePaths("./foo"), path.join(fsPath(helloWorldFolder), "foo"));
	});
});

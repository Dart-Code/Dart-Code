/* eslint-disable @typescript-eslint/tslint/config */
import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { isWin } from "../../../shared/constants";
import { Sdks } from "../../../shared/interfaces";
import { nullLogger } from "../../../shared/logging";
import { fsPath, isWithinPathOrEqual } from "../../../shared/utils/fs";
import { getPubPackageStatus, getPubWorkspaceStatus, PubPackageStatus } from "../../../shared/vscode/pub";
import { activate, delay, extApi, getRandomTempFolder } from "../../helpers";

describe("pub package status (legacy integration)", () => {
	// TODO(dantup): Fold these into the newer tests below that don't need a real
	//  filesystem to work.
	let tempProjectPath: string;
	let tempProjectUri: vs.Uri;

	function sdkVersion(v: string): Sdks {
		return {
			dartSdkIsFromFlutter: false,
			dartVersion: v,
			isPreReleaseSdk: false,
		};
	}

	const sdks123 = sdkVersion("1.2.3");

	beforeEach("activate", () => activate());
	beforeEach("set up project", () => {
		tempProjectPath = getRandomTempFolder();
		tempProjectUri = vs.Uri.file(tempProjectPath);
	});

	function createPubspec() {
		const pubspecPath = path.join(tempProjectPath, "pubspec.yaml");
		fs.writeFileSync(pubspecPath, `
name: foo
version: 1.0.0

# We'll never
dependencies:
		`);
	}

	function createPubspecWithoutDependencies() {
		const pubspecPath = path.join(tempProjectPath, "pubspec.yaml");
		fs.writeFileSync(pubspecPath, "");
	}

	function createPackageConfig(pubGeneratorSdkVersion = sdks123.dartVersion) {
		const dartToolPath = path.join(tempProjectPath, ".dart_tool");
		fs.mkdirSync(dartToolPath, { recursive: true });
		const packageConfigPath = path.join(dartToolPath, "package_config.json");
		fs.writeFileSync(packageConfigPath, `{ "generatorVersion": "${pubGeneratorSdkVersion}" }`);
	}

	function expectFalse(status: PubPackageStatus) {
		assert.equal(status.pubRequired, false);
	}

	function expectGet(status: PubPackageStatus) {
		assert.equal(status.pubRequired, "GET");
	}

	function expectUpgrade(status: PubPackageStatus) {
		assert.equal(status.pubRequired, "UPGRADE");
	}

	it("missing pubspec returns undefined", async () => {
		const status = getPubPackageStatus(sdks123, nullLogger, tempProjectUri);
		expectFalse(status);
	});

	it("pubspec without dependencies returns undefined", async () => {
		createPubspecWithoutDependencies();
		const status = getPubPackageStatus(sdks123, nullLogger, tempProjectUri);
		expectFalse(status);
	});

	it("pubspec but missing package_config returns GET", async () => {
		createPubspec();
		const status = getPubPackageStatus(sdks123, nullLogger, tempProjectUri);
		expectGet(status);
	});

	it("pubspec but stale package_config returns GET", async () => {
		createPackageConfig();
		await delay(1000);
		createPubspec();
		const status = getPubPackageStatus(sdks123, nullLogger, tempProjectUri);
		expectGet(status);
	});

	it("pubspec but fresh package_config returns GET", async () => {
		createPubspec();
		createPackageConfig();
		const status = getPubPackageStatus(sdks123, nullLogger, tempProjectUri);
		expectFalse(status);
	});

	it("upgraded SDK (major) returns UPGRADE", async () => {
		createPubspec();
		createPackageConfig("1.0.0");
		const status = getPubPackageStatus(sdkVersion("2.0.0"), nullLogger, tempProjectUri);
		expectUpgrade(status);
	});

	it("upgraded SDK (minor) returns UPGRADE", async () => {
		createPubspec();
		createPackageConfig("2.0.0");
		const status = getPubPackageStatus(sdkVersion("2.1.0"), nullLogger, tempProjectUri);
		expectUpgrade(status);
	});

	it("upgraded SDK (patch) returns undefined", async () => {
		createPubspec();
		createPackageConfig("2.1.1");
		const status = getPubPackageStatus(sdkVersion("2.1.0"), nullLogger, tempProjectUri);
		expectFalse(status);
	});

	it("downgraded SDK (patch) returns GET", async () => {
		createPubspec();
		createPackageConfig("2.0.0");
		const status = getPubPackageStatus(sdkVersion("1.0.0"), nullLogger, tempProjectUri);
		expectGet(status);
	});

	it("downgraded SDK (minor) returns GET", async () => {
		createPubspec();
		createPackageConfig("2.1.0");
		const status = getPubPackageStatus(sdkVersion("2.0.0"), nullLogger, tempProjectUri);
		expectGet(status);
	});

	it("downgraded SDK (patch) returns undefined", async () => {
		createPubspec();
		createPackageConfig("2.1.0");
		const status = getPubPackageStatus(sdkVersion("2.1.1"), nullLogger, tempProjectUri);
		expectFalse(status);
	});
});

describe("pub package status", () => {
	beforeEach("activate", () => activate());

	let workspace: WorkspaceInfo;

	it("no pubspec", async () => {
		workspace = {
			openFolders: ["/projects/proj1"],
			files: {},
		};

		expectStatus(workspace, []); // No projects found.
	});

	it("pubspec without dependencies", async () => {
		workspace = {
			openFolders: ["/projects/proj1"],
			files: {
				"/projects/proj1/.dart_tool/package_config.json": { mtime: 1 },
				"/projects/proj1/pubspec.yaml": { mtime: 100, content: "" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/proj1", pubRequired: false, reason: "Pubspec does not contain any dependencies" },
		]);
	});

	it("package_config is missing", async () => {
		workspace = {
			openFolders: ["/projects/proj1"],
			files: {
				"/projects/proj1/pubspec.yaml": { mtime: 100, content: "dependencies:" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/proj1", pubRequired: "GET", reason: "The .dart_tool/package_config.json file is missing" },
		]);
	});

	it("package_config is stale compared to pubspec.yaml", async () => {
		workspace = {
			openFolders: ["/projects/proj1"],
			files: {
				"/projects/proj1/.dart_tool/package_config.json": { mtime: 2 },
				"/projects/proj1/pubspec.yaml": { mtime: 100, content: "dependencies:" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/proj1", pubRequired: "GET", reason: "The pubspec.yaml file was modified more recently than the .dart_tool/package_config.json file" },
		]);
	});

	it("package_config is stale compared to pubspec.lock", async () => {
		workspace = {
			openFolders: ["/projects/proj1"],
			files: {
				"/projects/proj1/.dart_tool/package_config.json": { mtime: 2 },
				"/projects/proj1/pubspec.yaml": { mtime: 1, content: "dependencies:" },
				"/projects/proj1/pubspec.lock": { mtime: 100 },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/proj1", pubRequired: "GET", reason: "The pubspec.lock file was modified more recently than the .dart_tool/package_config.json file" },
		]);
	});

	it("pubspec lock is stale compared to pubspec", async () => {
		workspace = {
			openFolders: ["/projects/proj1"],
			files: {
				"/projects/proj1/.dart_tool/package_config.json": { mtime: 3 },
				"/projects/proj1/pubspec.yaml": { mtime: 2, content: "dependencies:" },
				"/projects/proj1/pubspec.lock": { mtime: 1 },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/proj1", pubRequired: "GET", reason: "The pubspec.yaml file was modified more recently than the pubspec.lock file" },
		]);
	});

	it("everything up-to-date", async () => {
		workspace = {
			openFolders: ["/projects/proj1"],
			files: {
				"/projects/proj1/.dart_tool/package_config.json": { mtime: 2 },
				"/projects/proj1/pubspec.yaml": { mtime: 1, content: "dependencies:" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/proj1", pubRequired: false, reason: "Up-to-date" },
		]);
	});

	it("multi-project folder, no package configs", async () => {
		workspace = {
			openFolders: ["/projects/root"],
			files: {
				"/projects/root/proj1/pubspec.yaml": { mtime: 1, content: "dependencies:" },
				"/projects/root/proj2/pubspec.yaml": { mtime: 1, content: "dependencies:" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/root/proj1", pubRequired: "GET", reason: "The .dart_tool/package_config.json file is missing" },
			{ folder: "/projects/root/proj2", pubRequired: "GET", reason: "The .dart_tool/package_config.json file is missing" },
		]);
	});

	it("multi-project folder, everything up-to-date", async () => {
		workspace = {
			openFolders: ["/projects/root"],
			files: {
				"/projects/root/proj1/.dart_tool/package_config.json": { mtime: 2 },
				"/projects/root/proj1/pubspec.yaml": { mtime: 1, content: "dependencies:" },
				"/projects/root/proj2/.dart_tool/package_config.json": { mtime: 5 },
				"/projects/root/proj2/pubspec.yaml": { mtime: 4, content: "dependencies:" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/root/proj1", pubRequired: false, reason: "Up-to-date" },
			{ folder: "/projects/root/proj2", pubRequired: false, reason: "Up-to-date" },
		]);
	});

	it("multi-root workspace, no package configs", async () => {
		workspace = {
			openFolders: ["/projects/proj1", "/projects/proj2"],
			files: {
				"/projects/proj1/pubspec.yaml": { mtime: 1, content: "dependencies:" },
				"/projects/proj2/pubspec.yaml": { mtime: 1, content: "dependencies:" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/proj1", pubRequired: "GET", reason: "The .dart_tool/package_config.json file is missing" },
			{ folder: "/projects/proj2", pubRequired: "GET", reason: "The .dart_tool/package_config.json file is missing" },
		]);
	});

	it("multi-root workspace, everything up-to-date", async () => {
		workspace = {
			openFolders: ["/projects/proj1", "/projects/proj2"],
			files: {
				"/projects/proj1/.dart_tool/package_config.json": { mtime: 2 },
				"/projects/proj1/pubspec.yaml": { mtime: 1, content: "dependencies:" },
				"/projects/proj2/.dart_tool/package_config.json": { mtime: 5 },
				"/projects/proj2/pubspec.yaml": { mtime: 4, content: "dependencies:" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/proj1", pubRequired: false, reason: "Up-to-date" },
			{ folder: "/projects/proj2", pubRequired: false, reason: "Up-to-date" },
		]);
	});

	function expectStatus(workspace: WorkspaceInfo, expectedStatuses: Array<{ folder: string, pubRequired: false | "GET" | "UPGRADE", reason?: string }>) {
		// Rewrite paths for Windows because we convert to/from URIs and VS Code's URI class always assumes the current platform.
		const fixPath = isWin ? (p: string) => `Z:${p.replaceAll("/", "\\")}` : (p: string) => p;
		workspace.openFolders = workspace.openFolders.map(fixPath);
		const fixedFiles: typeof workspace.files = {};
		for (const p of Object.keys(workspace.files))
			fixedFiles[fixPath(p)] = workspace.files[p];
		workspace.files = fixedFiles;
		expectedStatuses = expectedStatuses.map((s) => ({ ...s, folder: fixPath(s.folder) }));


		const files = workspace.files;
		const existsSync = (f: string) => !!files[f];
		const mtimeSync = (f: string) => { if (files[f] !== undefined) return new Date(files[f].mtime); else throw new Error("No file"); };
		const readFileSync = (f: string) => { if (files[f]?.content !== undefined) return files[f].content; else throw new Error("No file/content"); };

		// Project folders are anything from the openFolders and below that contain pubspecs
		// according to files.
		const foldersWithPubspecs = Object.keys(workspace.files).filter((p) => p.endsWith("pubspec.yaml")).map((p) => p.substring(0, p.length - 13));
		const projectFolders = foldersWithPubspecs.filter((p) => workspace.openFolders.find((wf) => isWithinPathOrEqual(p, wf)));

		const results = getPubWorkspaceStatus(
			workspace.sdks ?? {
				dartSdkIsFromFlutter: false,
				dartVersion: "1.2.3",
				isPreReleaseSdk: false,
			},
			extApi.logger,
			projectFolders.map(vs.Uri.file),
			false,
			existsSync,
			readFileSync,
			mtimeSync,
		).map((result) => {
			const newResult = ({ ...result, folderUri: undefined, folder: fsPath(result.folderUri) });
			delete newResult.folderUri;
			return newResult;
		});

		assert.deepStrictEqual(results, expectedStatuses);
	}
});

interface WorkspaceInfo {
	openFolders: string[],
	sdks?: Sdks,
	files: FilesInfo,
}

interface FilesInfo {
	[key: string]: FileInfo,
}

interface FileInfo {
	mtime: number,
	content?: string,
}

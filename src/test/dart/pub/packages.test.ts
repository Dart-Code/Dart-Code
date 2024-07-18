/* eslint-disable @typescript-eslint/tslint/config */
import { strict as assert } from "assert";
import * as vs from "vscode";
import { isWin } from "../../../shared/constants";
import { fsPath, isWithinPathOrEqual } from "../../../shared/utils/fs";
import { getPubWorkspaceStatus } from "../../../shared/vscode/pub";
import { activate, extApi } from "../../helpers";

describe("pub package status", () => {
	before("activate", () => activate());

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
				"/projects/proj1/.dart_tool/package_config.json": { mtime: 1, content: "{}" },
				"/projects/proj1/pubspec.yaml": { mtime: 100, content: "" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/proj1", pubRequired: false, reason: "Pubspec does not contain any dependencies" },
		]);
	});

	it("no package_config", async () => {
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
				"/projects/proj1/.dart_tool/package_config.json": { mtime: 2, content: "{}" },
				"/projects/proj1/pubspec.yaml": { mtime: 100, content: "dependencies:" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/proj1", pubRequired: "GET", reason: "The proj1/pubspec.yaml file was modified more recently than the proj1/.dart_tool/package_config.json file" },
		]);
	});

	it("package_config is stale compared to pubspec.lock", async () => {
		workspace = {
			openFolders: ["/projects/proj1"],
			files: {
				"/projects/proj1/.dart_tool/package_config.json": { mtime: 2, content: "{}" },
				"/projects/proj1/pubspec.yaml": { mtime: 1, content: "dependencies:" },
				"/projects/proj1/pubspec.lock": { mtime: 100, content: "" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/proj1", pubRequired: "GET", reason: "The proj1/pubspec.lock file was modified more recently than the proj1/.dart_tool/package_config.json file" },
		]);
	});

	it("pubspec lock is stale compared to pubspec", async () => {
		workspace = {
			openFolders: ["/projects/proj1"],
			files: {
				"/projects/proj1/.dart_tool/package_config.json": { mtime: 3, content: "{}" },
				"/projects/proj1/pubspec.yaml": { mtime: 2, content: "dependencies:" },
				"/projects/proj1/pubspec.lock": { mtime: 1, content: "" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/proj1", pubRequired: "GET", reason: "The proj1/pubspec.yaml file was modified more recently than the proj1/pubspec.lock file" },
		]);
	});

	it("everything up-to-date", async () => {
		workspace = {
			openFolders: ["/projects/proj1"],
			files: {
				"/projects/proj1/.dart_tool/package_config.json": { mtime: 2, content: "{}" },
				"/projects/proj1/pubspec.yaml": { mtime: 1, content: "dependencies:" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/proj1", pubRequired: false, reason: "Up-to-date" },
		]);
	});

	it("last used SDK is old (MAJOR)", async () => {
		workspace = {
			sdkVersion: "2.0.0",
			openFolders: ["/projects/proj1"],
			files: {
				"/projects/proj1/.dart_tool/package_config.json": { mtime: 2, content: `{ "generatorVersion": "1.2.3" }` },
				"/projects/proj1/pubspec.yaml": { mtime: 1, content: "dependencies:" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/proj1", pubRequired: "UPGRADE", reason: "The current SDK version (2.0.0) is newer than the one last used to run \"pub get\" (1.2.3)" },
		]);
	});

	it("last used SDK is old (MINOR)", async () => {
		workspace = {
			sdkVersion: "1.3.3",
			openFolders: ["/projects/proj1"],
			files: {
				"/projects/proj1/.dart_tool/package_config.json": { mtime: 2, content: `{ "generatorVersion": "1.2.3" }` },
				"/projects/proj1/pubspec.yaml": { mtime: 1, content: "dependencies:" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/proj1", pubRequired: "UPGRADE", reason: "The current SDK version (1.3.3) is newer than the one last used to run \"pub get\" (1.2.3)" },
		]);
	});

	it("last used SDK is old (PATCH)", async () => {
		workspace = {
			sdkVersion: "1.2.4",
			openFolders: ["/projects/proj1"],
			files: {
				"/projects/proj1/.dart_tool/package_config.json": { mtime: 2, content: `{ "generatorVersion": "1.2.3" }` },
				"/projects/proj1/pubspec.yaml": { mtime: 1, content: "dependencies:" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/proj1", pubRequired: false, reason: "Up-to-date" },
		]);
	});

	it("last used SDK is newer (MAJOR)", async () => {
		workspace = {
			sdkVersion: "1.2.3",
			openFolders: ["/projects/proj1"],
			files: {
				"/projects/proj1/.dart_tool/package_config.json": { mtime: 2, content: `{ "generatorVersion": "2.0.0" }` },
				"/projects/proj1/pubspec.yaml": { mtime: 1, content: "dependencies:" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/proj1", pubRequired: "GET", reason: "The current SDK version (1.2.3) is older than the one last used to run \"pub get\" (2.0.0)" },
		]);
	});

	it("last used SDK is newer (MINOR)", async () => {
		workspace = {
			sdkVersion: "1.2.3",
			openFolders: ["/projects/proj1"],
			files: {
				"/projects/proj1/.dart_tool/package_config.json": { mtime: 2, content: `{ "generatorVersion": "1.3.3" }` },
				"/projects/proj1/pubspec.yaml": { mtime: 1, content: "dependencies:" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/proj1", pubRequired: "GET", reason: "The current SDK version (1.2.3) is older than the one last used to run \"pub get\" (1.3.3)" },
		]);
	});

	it("last used SDK is newer (PATCH)", async () => {
		workspace = {
			sdkVersion: "1.2.3",
			openFolders: ["/projects/proj1"],
			files: {
				"/projects/proj1/.dart_tool/package_config.json": { mtime: 2, content: `{ "generatorVersion": "1.2.4" }` },
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
				"/projects/root/proj1/.dart_tool/package_config.json": { mtime: 2, content: "{}" },
				"/projects/root/proj1/pubspec.yaml": { mtime: 1, content: "dependencies:" },
				"/projects/root/proj2/.dart_tool/package_config.json": { mtime: 5, content: "{}" },
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
				"/projects/proj1/.dart_tool/package_config.json": { mtime: 2, content: "{}" },
				"/projects/proj1/pubspec.yaml": { mtime: 1, content: "dependencies:" },
				"/projects/proj2/.dart_tool/package_config.json": { mtime: 5, content: "{}" },
				"/projects/proj2/pubspec.yaml": { mtime: 4, content: "dependencies:" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/proj1", pubRequired: false, reason: "Up-to-date" },
			{ folder: "/projects/proj2", pubRequired: false, reason: "Up-to-date" },
		]);
	});


	for (const openOnlyChildren of [false, true]) {
		const openFolders = openOnlyChildren
			? ["/projects/root/proj1", "/projects/root/proj2", "/projects/root/proj3"]
			: ["/projects/root"];
		const name = openOnlyChildren
			? "pub workspace (only children open)"
			: "pub workspace";

		it(`${name}, no package configs`, async () => {
			workspace = {
				openFolders,
				files: {
					"/projects/root/pubspec.yaml": { mtime: 1, content: "workspace:\n- proj1\n- proj2" },
					"/projects/root/proj1/pubspec.yaml": { mtime: 1, content: "resolution: workspace\ndependencies:" },
					"/projects/root/proj2/pubspec.yaml": { mtime: 1, content: "resolution: workspace\ndependencies:" },
					// proj3 is not part of the workspace
					"/projects/root/proj3/pubspec.yaml": { mtime: 1, content: "dependencies:" },
				},
			};

			expectStatus(workspace, [
				{ folder: "/projects/root", pubRequired: "GET", reason: "The .dart_tool/package_config.json file is missing" },
				{ folder: "/projects/root/proj1", pubRequired: false, reason: "The project is part of a Pub workspace" },
				{ folder: "/projects/root/proj2", pubRequired: false, reason: "The project is part of a Pub workspace" },
				{ folder: "/projects/root/proj3", pubRequired: "GET", reason: "The .dart_tool/package_config.json file is missing" },
			]);
		});

		it(`${name}, root pubspec is new`, async () => {
			workspace = {
				openFolders,
				files: {
					"/projects/root/.dart_tool/package_config.json": { mtime: 1, content: "{}" },
					"/projects/root/pubspec.yaml": { mtime: 10, content: "workspace:\n- proj1\n- proj2" },
					"/projects/root/proj1/pubspec.yaml": { mtime: 1, content: "resolution: workspace\ndependencies:" },
					"/projects/root/proj2/pubspec.yaml": { mtime: 1, content: "resolution: workspace\ndependencies:" },
					// proj3 is not part of the workspace
					"/projects/root/proj3/.dart_tool/package_config.json": { mtime: 2, content: "{}" },
					"/projects/root/proj3/pubspec.yaml": { mtime: 1, content: "dependencies:" },
				},
			};

			expectStatus(workspace, [
				{ folder: "/projects/root", pubRequired: "GET", reason: "The root/pubspec.yaml file was modified more recently than the root/.dart_tool/package_config.json file" },
				{ folder: "/projects/root/proj1", pubRequired: false, reason: "The project is part of a Pub workspace" },
				{ folder: "/projects/root/proj2", pubRequired: false, reason: "The project is part of a Pub workspace" },
				{ folder: "/projects/root/proj3", pubRequired: false, reason: "Up-to-date" },
			]);
		});

		it(`${name}, child project pubspec is new`, async () => {
			workspace = {
				openFolders,
				files: {
					"/projects/root/.dart_tool/package_config.json": { mtime: 1, content: "{}" },
					"/projects/root/pubspec.yaml": { mtime: 1, content: "workspace:\n- proj1\n- proj2" },
					"/projects/root/proj1/pubspec.yaml": { mtime: 10, content: "resolution: workspace\ndependencies:" },
					"/projects/root/proj2/pubspec.yaml": { mtime: 1, content: "resolution: workspace\ndependencies:" },
					// proj3 is not part of the workspace
					"/projects/root/proj3/.dart_tool/package_config.json": { mtime: 2, content: "{}" },
					"/projects/root/proj3/pubspec.yaml": { mtime: 1, content: "dependencies:" },
				},
			};

			expectStatus(workspace, [
				{ folder: "/projects/root", pubRequired: "GET", reason: "The proj1/pubspec.yaml file was modified more recently than the root/.dart_tool/package_config.json file" },
				{ folder: "/projects/root/proj1", pubRequired: false, reason: "The project is part of a Pub workspace" },
				{ folder: "/projects/root/proj2", pubRequired: false, reason: "The project is part of a Pub workspace" },
				{ folder: "/projects/root/proj3", pubRequired: false, reason: "Up-to-date" },
			]);
		});

		it(`${name}, everything up-to-date`, async () => {
			workspace = {
				openFolders,
				files: {
					"/projects/root/.dart_tool/package_config.json": { mtime: 10, content: "{}" },
					"/projects/root/pubspec.yaml": { mtime: 1, content: "workspace:\n- proj1\n- proj2" },
					"/projects/root/proj1/pubspec.yaml": { mtime: 1, content: "resolution: workspace\ndependencies:" },
					"/projects/root/proj2/pubspec.yaml": { mtime: 1, content: "resolution: workspace\ndependencies:" },
					// proj3 is not part of the workspace
					"/projects/root/proj3/.dart_tool/package_config.json": { mtime: 2, content: "{}" },
					"/projects/root/proj3/pubspec.yaml": { mtime: 1, content: "dependencies:" },
				},
			};

			expectStatus(workspace, [
				{ folder: "/projects/root", pubRequired: false, reason: "Up-to-date" },
				{ folder: "/projects/root/proj1", pubRequired: false, reason: "The project is part of a Pub workspace" },
				{ folder: "/projects/root/proj2", pubRequired: false, reason: "The project is part of a Pub workspace" },
				{ folder: "/projects/root/proj3", pubRequired: false, reason: "Up-to-date" },
			]);
		});
	}

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
			{
				dartSdkIsFromFlutter: false,
				dartVersion: workspace.sdkVersion ?? "1.2.3",
				isPreReleaseSdk: false,
			},
			extApi.logger,
			projectFolders.map(vs.Uri.file),
			false,
			existsSync,
			readFileSync,
			mtimeSync,
		).map((result) => {
			// Tests use folder paths instead of URIs
			const newResult = ({ ...result, folderUri: undefined, folder: fsPath(result.folderUri), workspace: undefined });
			delete newResult.folderUri;
			// And for convenience we don't check the root flag because the other data is based on it.
			delete newResult.workspace;
			return newResult;
		});

		results.sort((a, b) => a.folder.localeCompare(b.folder));
		expectedStatuses.sort((a, b) => a.folder.localeCompare(b.folder));
		assert.deepStrictEqual(results, expectedStatuses);
	}
});

interface WorkspaceInfo {
	openFolders: string[],
	sdkVersion?: string,
	files: FilesInfo,
}

interface FilesInfo {
	[key: string]: FileInfo,
}

interface FileInfo {
	mtime: number,
	content: string,
}

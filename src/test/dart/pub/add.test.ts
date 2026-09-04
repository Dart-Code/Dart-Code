import { strict as assert } from "assert";
import * as fs from "fs";
import * as vs from "vscode";
import { PackageCacheData } from "../../../shared/pub/pub_add";
import { fsPath } from "../../../shared/utils/fs";
import { activate, createTempPubPackage, currentDoc, helloWorldExampleSubFolder, helloWorldFolder, helloWorldPubspec, privateApi, rangeOf, sb, setTestContent, waitForNextAnalysis } from "../../helpers";
import { ChildProcessSpawnStub } from "../../mocks/child_process_spawn_stub";

describe("pub add", () => {
	const pubspecPath = fsPath(helloWorldPubspec);
	beforeEach("activate", () => activate());

	function pubspecContainsPackage(packageName: string) {
		const contents = fs.readFileSync(pubspecPath);
		return contents.includes(`\n  ${packageName}:`);
	}

	function stubQuickPick(result: string | { label: string; marker?: "PATH" | "GIT"; packageNames?: string } | undefined, userInput = "") {
		const handlers: {
			onDidAccept?: () => void;
			onDidChangeValue?: (value: string) => void;
			onDidHide?: () => void;
		} = {};
		const quickPick = {
			dispose: sb.stub(),
			items: [] as any[],
			onDidAccept: sb.stub().callsFake((handler: () => void) => {
				handlers.onDidAccept = handler;
				return { dispose: () => undefined };
			}),
			onDidChangeValue: sb.stub().callsFake((handler: (value: string) => void) => {
				handlers.onDidChangeValue = handler;
				return { dispose: () => undefined };
			}),
			onDidHide: sb.stub().callsFake((handler: () => void) => {
				handlers.onDidHide = handler;
				return { dispose: () => undefined };
			}),
			placeholder: undefined as string | undefined,
			selectedItems: typeof result === "string" || !result ? [] : [result],
			show: sb.stub().callsFake(() => {
				quickPick.value = userInput;
				handlers.onDidChangeValue?.(userInput);
				handlers.onDidAccept?.();
			}),
			title: undefined as string | undefined,
			value: "",
		};

		sb.stub(vs.window, "createQuickPick").returns(quickPick as any);

		return quickPick;
	}

	it("can add a dependency using command", async () => {
		const spawn = ChildProcessSpawnStub.dartPub();
		sb.stub(privateApi.addDependencyCommand, "promptForPackageInfo").resolves("collection");
		sb.stub(vs.window, "showQuickPick").resolves([{ path: fsPath(helloWorldFolder) }]);

		await vs.commands.executeCommand("dart.addDependency");

		spawn.assertDartCalls([{ cwd: fsPath(helloWorldFolder), args: ["pub", "add", "collection"] }]);
	});

	it("can add a dependency to multiple projects", async () => {
		const spawn = ChildProcessSpawnStub.dartPub();
		sb.stub(privateApi.addDependencyCommand, "promptForPackageInfo").resolves("collection");
		sb.stub(vs.window, "showQuickPick").callsFake((items: Array<vs.QuickPickItem & { path: string }>) => {
			// Ensure the `picked` fields are set correctly.
			assert.equal(items.length, 2);
			assert.equal(items[0].path, fsPath(helloWorldFolder));
			assert.equal(items[0].picked, true);
			assert.equal(items[1].path, fsPath(helloWorldExampleSubFolder));
			assert.equal(items[1].picked, false);
			return items;
		});

		await vs.commands.executeCommand("dart.addDependency");

		spawn.assertDartCalls([
			{ cwd: fsPath(helloWorldFolder), args: ["pub", "add", "collection"] },
			{ cwd: fsPath(helloWorldExampleSubFolder), args: ["pub", "add", "collection"] },
		]);
	});

	for (const separator of [",", " ", ", "]) {
		it(`can add multiple dependencies separated by "${separator}" using command`, async () => {
			const spawn = ChildProcessSpawnStub.dartPub();
			sb.stub(privateApi.addDependencyCommand, "promptForPackageInfo").resolves(`path${separator}crypto`);
			sb.stub(vs.window, "showQuickPick").resolves([{ path: fsPath(helloWorldFolder) }]);

			await vs.commands.executeCommand("dart.addDependency");

			spawn.assertDartCalls([{ cwd: fsPath(helloWorldFolder), args: ["pub", "add", "path", "crypto"] }]);
		});
	}

	it("can add a dependency with trailing whitespace using command", async () => {
		const spawn = ChildProcessSpawnStub.dartPub();
		sb.stub(privateApi.addDependencyCommand, "promptForPackageInfo").resolves("collection ");
		sb.stub(vs.window, "showQuickPick").resolves([{ path: fsPath(helloWorldFolder) }]);

		await vs.commands.executeCommand("dart.addDependency");

		spawn.assertDartCalls([{ cwd: fsPath(helloWorldFolder), args: ["pub", "add", "collection"] }]);
	});

	it("can add a dev-dependency using command", async () => {
		const spawn = ChildProcessSpawnStub.dartPub();
		sb.stub(privateApi.addDependencyCommand, "promptForPackageInfo").resolves("collection");
		sb.stub(vs.window, "showQuickPick").resolves([{ path: fsPath(helloWorldFolder) }]);

		await vs.commands.executeCommand("dart.addDevDependency");

		spawn.assertDartCalls([{ cwd: fsPath(helloWorldFolder), args: ["pub", "add", "collection", "--dev"] }]);
	});

	it("can remove a dependency using the tree view command", async () => {
		const spawn = ChildProcessSpawnStub.dartPub();

		await vs.commands.executeCommand("_dart.removeDependency", helloWorldFolder, "convert");

		spawn.assertDartCalls([{ cwd: fsPath(helloWorldFolder), args: ["pub", "remove", "convert"] }]);
	});

	it("can add a dependency by URL by pasting", async () => {
		const spawn = ChildProcessSpawnStub.dartPub();
		sb.stub(privateApi.addDependencyCommand, "promptForPackageInfo").resolves("https://github.com/dart-lang/timing");
		sb.stub(privateApi.addDependencyCommand, "promptForPackageName").resolves("timing");
		sb.stub(privateApi.addDependencyCommand, "promptForGitRef").resolves("");
		sb.stub(privateApi.addDependencyCommand, "promptForGitPath").resolves("");
		sb.stub(vs.window, "showQuickPick").resolves([{ path: fsPath(helloWorldFolder) }]);

		await vs.commands.executeCommand("dart.addDependency");

		spawn.assertDartCalls([{ cwd: fsPath(helloWorldFolder), args: ["pub", "add", "timing", "--git-url=https://github.com/dart-lang/timing"] }]);
	});

	it("can add a dependency by URL by selecting the GIT option", async () => {
		const spawn = ChildProcessSpawnStub.dartPub();
		sb.stub(privateApi.addDependencyCommand, "promptForPackageInfo").resolves({ marker: "GIT" });
		sb.stub(privateApi.addDependencyCommand, "promptForGitUrl").resolves("https://github.com/dart-lang/timing");
		sb.stub(privateApi.addDependencyCommand, "promptForPackageName").resolves("timing");
		sb.stub(privateApi.addDependencyCommand, "promptForGitRef").resolves("");
		sb.stub(privateApi.addDependencyCommand, "promptForGitPath").resolves("");
		sb.stub(vs.window, "showQuickPick").resolves([{ path: fsPath(helloWorldFolder) }]);

		await vs.commands.executeCommand("dart.addDependency");

		spawn.assertDartCalls([{ cwd: fsPath(helloWorldFolder), args: ["pub", "add", "timing", "--git-url=https://github.com/dart-lang/timing"] }]);
	});

	it.skip("is available as a quick fix before the ignores", async () => {
		// Because we've enabled the depend_on_referenced_packages lint, we'll get two diagnostics
		// for this, but expect only one fix.
		const packageName = "built_value";
		assert.equal(pubspecContainsPackage(packageName), false);
		await waitForNextAnalysis(() => setTestContent(`import 'package:${packageName}/${packageName}.dart';`));

		const fixResults = await vs.commands.executeCommand<vs.CodeAction[]>("vscode.executeCodeActionProvider", currentDoc().uri, rangeOf(`|package:${packageName}|`));
		const addDependencyIndex = fixResults.findIndex((r) => r.title.includes(`Add '${packageName}' to dependencies`));
		const firstIgnoreIndex = fixResults.findIndex((r) => r.title.startsWith(`Ignore`));

		// TODO(dantup): This test fails because vscode.executeCodeActionProvider doesn't allow us to pass the diagnostic
		//  and therefore it's not attached to the fix, and VS Code sorts using the diagnostics.
		//  The functionality works when manually tested, and we should try to add a test if there becomes a way to
		//  fetch all code actions with context.

		assert.ok(addDependencyIndex >= 0);
		assert.ok(firstIgnoreIndex >= 0);
		assert.ok(firstIgnoreIndex >= addDependencyIndex);
	});

	it("can add from a quick fix if not listed in pubspec.yaml", async () => {
		// Because we've enabled the depend_on_referenced_packages lint, we'll get two diagnostics
		// for this, but expect only one fix.
		const packageName = "built_value";
		const spawn = ChildProcessSpawnStub.dartPub();
		await waitForNextAnalysis(() => setTestContent(`import 'package:${packageName}/${packageName}.dart';`));

		const fixResults = await vs.commands.executeCommand<vs.CodeAction[]>("vscode.executeCodeActionProvider", currentDoc().uri, rangeOf(`|package:${packageName}|`));
		const addDependencyFixes = fixResults.filter((r) => r.title.includes(`Add '${packageName}' to dependencies`));
		assert.equal(addDependencyFixes.length, 1);
		const addDependencyFix = addDependencyFixes[0];

		await vs.commands.executeCommand(addDependencyFix.command!.command, ...addDependencyFix.command!.arguments!); // eslint-disable-line @typescript-eslint/no-unsafe-argument
		spawn.assertDartCalls([{ cwd: fsPath(helloWorldFolder), args: ["pub", "add", packageName] }]);
	});

	it("can add from a quick fix if listed only in dev_dependencies and imported from lib", async () => {
		const packageName = "meta";
		assert.equal(pubspecContainsPackage(packageName), true);
		await waitForNextAnalysis(() => setTestContent(`import 'package:${packageName}/meta.dart';`));

		const fixResults = await vs.commands.executeCommand<vs.CodeAction[]>("vscode.executeCodeActionProvider", currentDoc().uri, rangeOf(`|package:${packageName}|`));
		const addDependencyFixes = fixResults.filter((r) => r.title.includes(`Add '${packageName}' to dependencies`));
		const addDevDependencyFixes = fixResults.filter((r) => r.title.includes(`Add '${packageName}' to dev_dependencies`));
		assert.equal(addDependencyFixes.length, 1);
		assert.equal(addDevDependencyFixes.length, 0);
	});

	it("cannot add from a quick fix if already listed in pubspec.yaml", async () => {
		const packageName = "convert";
		assert.equal(pubspecContainsPackage(packageName), true);
		await waitForNextAnalysis(() => setTestContent(`import 'package:${packageName}/${packageName}.dart';`));

		const fixResults = await vs.commands.executeCommand<vs.CodeAction[]>("vscode.executeCodeActionProvider", currentDoc().uri, rangeOf(`|package:${packageName}|`));
		const addDependencyFixes = fixResults.filter((r) => r.title.includes(`Add '${packageName}' to dependencies`));
		assert.equal(addDependencyFixes.length, 0);
	});

	describe("returns the correct completion items", () => {
		beforeEach(() => {
			privateApi.addDependencyCommand.cache = PackageCacheData.fromPackageNames([
				"collection",
				"convert",
				"crypto",
				"path",
				"pedantic",
			]);
		});

		it("with no user input", () => {
			const results = privateApi.addDependencyCommand.getPackageEntries("")
				.map((item) => item.label);

			assert.deepStrictEqual(results, [
				"Local Path Package",
				"Git Repository URL",
				"collection",
				"convert",
				"crypto",
				"path",
				"pedantic",
			]);
		});

		it("for Flutter SDK packages", () => {
			const results = privateApi.addDependencyCommand.getPackageEntries("flutter")
				.map((item) => item.label);

			assert.deepStrictEqual(results, [
				"flutter",
				"flutter_test",
				"flutter_driver",
				"flutter_localizations",
			]);
		});

		it("for a single package prefix", () => {
			const results = privateApi.addDependencyCommand.getPackageEntries("co")
				.map((item) => item.label);

			assert.deepStrictEqual(results, [
				"collection",
				"convert",
			]);
		});

		it("for multiple packages separated by spaces", () => {
			const results = privateApi.addDependencyCommand.getPackageEntries("path co")
				.map((item) => item.label);

			assert.deepStrictEqual(results, [
				"path collection",
				"path convert",
			]);
		});

		it("for multiple packages separated by commas", () => {
			const results = privateApi.addDependencyCommand.getPackageEntries("path,co")
				.map((item) => item.label);

			assert.deepStrictEqual(results, [
				"path,collection",
				"path,convert",
			]);
		});

		it("for multiple packages separated by commas and spaces", () => {
			const results = privateApi.addDependencyCommand.getPackageEntries("path, co")
				.map((item) => item.label);

			assert.deepStrictEqual(results, [
				"path, collection",
				"path, convert",
			]);
		});

		describe("returns only the matching item when input ends with", () => {
			// We shouldn't provide the full package list for the next package due to
			// https://github.com/Dart-Code/Dart-Code/issues/5952, they should only show
			// up when a character is typed.
			it("space", () => {
				const results = privateApi.addDependencyCommand.getPackageEntries("foo ")
					.map((item) => item.label);

				assert.deepStrictEqual(results, ["foo "]);
			});

			it("comma", () => {
				const results = privateApi.addDependencyCommand.getPackageEntries("foo,")
					.map((item) => item.label);

				// Th improve formatting, we inject a space if the user doesn't type it.
				assert.deepStrictEqual(results, ["foo, "]);
			});

			it("comma space", () => {
				const results = privateApi.addDependencyCommand.getPackageEntries("foo, ")
					.map((item) => item.label);

				assert.deepStrictEqual(results, ["foo, "]);
			});
		});

		describe("with dev: prefix", () => {
			it("and no package name", () => {
				const results = privateApi.addDependencyCommand.getPackageEntries("dev:")
					.map((item) => item.label);

				assert.deepStrictEqual(results, [
					"dev:collection",
					"dev:convert",
					"dev:crypto",
					"dev:path",
					"dev:pedantic",
				]);
			});

			it("for a single package prefix", () => {
				const results = privateApi.addDependencyCommand.getPackageEntries("dev:co")
					.map((item) => item.label);

				assert.deepStrictEqual(results, [
					"dev:collection",
					"dev:convert",
				]);
			});

			it("for multiple packages separated by spaces", () => {
				const results = privateApi.addDependencyCommand.getPackageEntries("path dev:co")
					.map((item) => item.label);

				assert.deepStrictEqual(results, [
					"path dev:collection",
					"path dev:convert",
				]);
			});

			it("for multiple packages separated by commas", () => {
				const results = privateApi.addDependencyCommand.getPackageEntries("path,dev:co")
					.map((item) => item.label);

				assert.deepStrictEqual(results, [
					"path,dev:collection",
					"path,dev:convert",
				]);
			});

			it("for multiple packages separated by commas and spaces", () => {
				const results = privateApi.addDependencyCommand.getPackageEntries("path, dev:co")
					.map((item) => item.label);

				assert.deepStrictEqual(results, [
					"path, dev:collection",
					"path, dev:convert",
				]);
			});
		});
	});

	describe("prompt helpers", () => {
		beforeEach(() => {
			privateApi.addDependencyCommand.cache = PackageCacheData.fromPackageNames([
				"collection",
				"convert",
				"crypto",
			]);
		});

		it("promptForPackageInfo - git", async () => {
			const quickPick = stubQuickPick({ label: "Git Repository URL", marker: "GIT" });

			const result = await privateApi.addDependencyCommand.promptForPackageInfo();

			assert.deepStrictEqual(result, { label: "Git Repository URL", marker: "GIT" });
			assert.equal(quickPick.placeholder, "package name(s), URL or path (use commas or spaces to separate multiple package names)");
			assert.equal(quickPick.title, "Enter package name(s), URL or local path");
			assert.ok(quickPick.dispose.calledOnce);
		});

		it("promptForPackageInfo - package name", async () => {
			const quickPick = stubQuickPick("col", "col");

			const result = await privateApi.addDependencyCommand.promptForPackageInfo();

			assert.equal(result, "col");
			assert.deepStrictEqual(quickPick.items.map((item: { label: string }) => item.label), ["collection"]);
			assert.ok(quickPick.dispose.calledOnce);
		});

		it("promptForPathPackageInfo uses supplied path and reads package name", async () => {
			const tempFolder = createTempPubPackage("sample_package");

			const result = await privateApi.addDependencyCommand.promptForPathPackageInfo(tempFolder);

			assert.deepStrictEqual(result, {
				marker: "PATH",
				packageName: "sample_package",
				path: tempFolder,
			});
		});

		it("promptForPathPackageInfo prompts for a folder when no path is supplied", async () => {
			const tempFolder = createTempPubPackage("selected_package");
			const showOpenDialog = sb.stub(vs.window, "showOpenDialog").resolves([vs.Uri.file(tempFolder)]);

			const result = await privateApi.addDependencyCommand.promptForPathPackageInfo();

			assert.ok(showOpenDialog.calledOnce);
			assert.deepStrictEqual(showOpenDialog.firstCall.args[0], {
				canSelectFiles: false,
				canSelectFolders: true,
				canSelectMany: false,
				openLabel: "Select package folder",
			});
			assert.deepStrictEqual(result, {
				marker: "PATH",
				packageName: "selected_package",
				path: tempFolder,
			});
		});

		it("promptForGitUrl uses the expected input box options", async () => {
			const showInputBox = sb.stub(vs.window, "showInputBox").callsFake(async (options) => {
				assert.deepStrictEqual(options, {
					ignoreFocusOut: true,
					placeHolder: "git repo url",
					title: "Enter a Git repository url",
				});
				return "https://github.com/dart-lang/timing";
			});

			const result = await privateApi.addDependencyCommand.promptForGitUrl();

			assert.equal(result, "https://github.com/dart-lang/timing");
			assert.equal(showInputBox.callCount, 1);
		});

		it("promptForGitPath uses the expected input box options", async () => {
			const showInputBox = sb.stub(vs.window, "showInputBox").callsFake(async (options) => {
				assert.deepStrictEqual(options, {
					ignoreFocusOut: true,
					placeHolder: "path to package",
					title: "Enter the path to the package in the repository (press <enter> for default)",
				});
				return "packages/timing";
			});

			const result = await privateApi.addDependencyCommand.promptForGitPath();

			assert.equal(result, "packages/timing");
			assert.equal(showInputBox.callCount, 1);
		});

		it("promptForGitRef uses the expected input box options", async () => {
			const showInputBox = sb.stub(vs.window, "showInputBox").callsFake(async (options) => {
				assert.deepStrictEqual(options, {
					ignoreFocusOut: true,
					placeHolder: "commit/branch",
					title: "Enter the commit/branch to use (press <enter> for default)",
				});
				return "main";
			});

			const result = await privateApi.addDependencyCommand.promptForGitRef();

			assert.equal(result, "main");
			assert.equal(showInputBox.callCount, 1);
		});

		it("promptForPackageName uses the expected input box options", async () => {
			const showInputBox = sb.stub(vs.window, "showInputBox").callsFake(async (options) => {
				assert.deepStrictEqual(options, {
					ignoreFocusOut: true,
					placeHolder: "package name",
					title: "Enter the packages name",
					value: "timing",
				});
				return "custom_timing";
			});

			const result = await privateApi.addDependencyCommand.promptForPackageName("timing");

			assert.equal(result, "custom_timing");
			assert.equal(showInputBox.callCount, 1);
		});
	});

});

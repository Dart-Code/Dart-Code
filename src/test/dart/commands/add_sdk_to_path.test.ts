import { strict as assert } from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vs from "vscode";
import { addSdkToPathAction, addSdkToPathPrompt, addedToPathPrompt, addToPathInstructionsUrl, copySdkBinPathToClipboardAction, isLinux, isMac, isWin, noSdkAvailablePrompt, noThanksAction, openInstructionsAction, sdkAlreadyOnPathPrompt, unableToAddToPathPrompt } from "../../../shared/constants";
import { ChildProcessSpawnStub } from "../../mocks/child_process_spawn_stub";
import { activate, defer, privateApi, sb } from "../../helpers";

// These tests exercise the Unix code paths in AddSdkToPath, which write to the
// user's shell profile. They redirect HOME to a temporary directory and set
// SHELL explicitly so they are independent of the machine they run on. The
// Windows branch (PowerShell script) is covered by tests that stub
// child_process.spawn and only run on Windows.
const posixOnly = !isLinux && !isMac;
const winOnly = !isWin;

describe("AddSdkToPath", () => {
	before("activate", () => activate());

	function setEnvVar(name: string, value: string | undefined): void {
		const original = process.env[name];
		if (value === undefined) {
			delete process.env[name];
		} else {
			process.env[name] = value;
		}
		defer(`restore ${name}`, () => {
			if (original === undefined) {
				delete process.env[name];
			} else {
				process.env[name] = original;
			}
		});
	}

	function useTempHome(): string {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "dart-code-add-sdk-to-path-"));
		setEnvVar("HOME", home);
		defer("remove temp home", () => fs.rmSync(home, { recursive: true, force: true }));
		return home;
	}

	function unixProfilePath(home: string, shell: string): string {
		if (shell === "zsh") {
			return path.join(home, ".zshenv");
		}
		return path.join(home, isMac ? ".bash_profile" : ".bashrc");
	}

	// Sdks fields are readonly in the type system but the object is a plain
	// mutable literal at runtime; patch them so command tests are independent
	// of which SDKs happen to be installed on the machine.
	function overrideSdks(patch: Record<string, unknown>): void {
		const sdks = privateApi.workspaceContext.sdks as unknown as Record<string, unknown>;
		const originals = new Map<string, unknown>();
		for (const key of Object.keys(patch)) {
			originals.set(key, sdks[key]);
			sdks[key] = patch[key];
		}
		defer("restore sdks", () => {
			for (const [key, value] of originals)
				sdks[key] = value;
		});
	}

	it("shows an error when no SDK path is provided", async () => {
		const showErrorMessage = sb.stub(vs.window, "showErrorMessage").resolves(undefined);

		await privateApi.addSdkToPath.addToPath("Dart", undefined);

		assert.ok(showErrorMessage.calledOnceWithExactly(noSdkAvailablePrompt));
	});

	it("appends the export line to the bash profile", async function () {
		if (posixOnly)
			return this.skip();
		setEnvVar("SHELL", "/bin/bash");
		const home = useTempHome();
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage").resolves(undefined);

		await privateApi.addSdkToPath.addToPath("Dart", "/fake/dart-sdk");

		const profile = unixProfilePath(home, "bash");
		assert.equal(fs.readFileSync(profile, "utf8"), `export PATH="${path.join("/fake/dart-sdk", "bin")}:$PATH"\n`);
		assert.ok(showInformationMessage.calledOnceWithExactly(addedToPathPrompt("Dart")));
	});

	it("appends the export line to .zshenv for zsh", async function () {
		if (posixOnly)
			return this.skip();
		setEnvVar("SHELL", "/usr/bin/zsh");
		const home = useTempHome();
		sb.stub(vs.window, "showInformationMessage").resolves(undefined);

		await privateApi.addSdkToPath.addToPath("Flutter", "/fake/flutter");

		const profile = unixProfilePath(home, "zsh");
		assert.equal(fs.readFileSync(profile, "utf8"), `export PATH="${path.join("/fake/flutter", "bin")}:$PATH"\n`);
	});

	it("reports when the SDK is already on PATH", async function () {
		if (posixOnly)
			return this.skip();
		setEnvVar("SHELL", "/bin/bash");
		const home = useTempHome();
		const exportLine = `export PATH="${path.join("/fake/dart-sdk", "bin")}:$PATH"\n`;
		fs.writeFileSync(unixProfilePath(home, "bash"), exportLine);
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage").resolves(undefined);

		await privateApi.addSdkToPath.addToPath("Dart", "/fake/dart-sdk");

		assert.equal(fs.readFileSync(unixProfilePath(home, "bash"), "utf8"), exportLine);
		assert.ok(showInformationMessage.calledOnceWithExactly(sdkAlreadyOnPathPrompt("Dart")));
	});

	it("separates the export line from existing content without a trailing newline", async function () {
		if (posixOnly)
			return this.skip();
		setEnvVar("SHELL", "/bin/bash");
		const home = useTempHome();
		const profile = unixProfilePath(home, "bash");
		fs.writeFileSync(profile, "existing content");
		sb.stub(vs.window, "showInformationMessage").resolves(undefined);

		await privateApi.addSdkToPath.addToPath("Dart", "/fake/dart-sdk");

		assert.equal(
			fs.readFileSync(profile, "utf8"),
			`existing content\nexport PATH="${path.join("/fake/dart-sdk", "bin")}:$PATH"\n`,
		);
	});

	it("shows manual instructions when the shell is unsupported", async function () {
		if (posixOnly)
			return this.skip();
		setEnvVar("SHELL", "/bin/fish");
		const home = useTempHome();
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage").resolves(noThanksAction);

		await privateApi.addSdkToPath.addToPath("Dart", "/fake/dart-sdk");

		assert.ok(showInformationMessage.calledOnce);
		assert.deepEqual(showInformationMessage.firstCall.args, [addSdkToPathPrompt("Dart"), openInstructionsAction, copySdkBinPathToClipboardAction, noThanksAction]);
		assert.equal(fs.existsSync(path.join(home, ".bashrc")), false);
		assert.equal(fs.existsSync(path.join(home, ".zshenv")), false);
	});

	it("uses the warning prompt for manual instructions after an automatic failure", async function () {
		if (posixOnly)
			return this.skip();
		setEnvVar("SHELL", "/bin/bash");
		const home = useTempHome();
		// Make the profile path a directory so appending fails.
		fs.mkdirSync(unixProfilePath(home, "bash"));
		const showWarningMessage = sb.stub(vs.window, "showWarningMessage").resolves(noThanksAction);

		await privateApi.addSdkToPath.addToPath("Dart", "/fake/dart-sdk");

		assert.ok(showWarningMessage.calledOnce);
		assert.deepEqual(showWarningMessage.firstCall.args, [unableToAddToPathPrompt("Dart"), openInstructionsAction, copySdkBinPathToClipboardAction, noThanksAction]);
	});

	it("opens the instructions URL from the manual instructions prompt", async function () {
		if (posixOnly || !addToPathInstructionsUrl)
			return this.skip();
		setEnvVar("SHELL", "/bin/fish");
		useTempHome();
		const openInBrowser = sb.stub(privateApi.envUtils, "openInBrowser").resolves(true);
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		showInformationMessage.onFirstCall().resolves(openInstructionsAction);
		showInformationMessage.onSecondCall().resolves(noThanksAction);

		await privateApi.addSdkToPath.addToPath("Dart", "/fake/dart-sdk");

		assert.ok(openInBrowser.calledOnceWithExactly(addToPathInstructionsUrl));
	});

	it("copies the SDK bin path to the clipboard from the manual instructions prompt", async function () {
		if (posixOnly || !addToPathInstructionsUrl)
			return this.skip();
		setEnvVar("SHELL", "/bin/fish");
		useTempHome();
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		showInformationMessage.onFirstCall().resolves(copySdkBinPathToClipboardAction);
		showInformationMessage.onSecondCall().resolves(noThanksAction);

		await privateApi.addSdkToPath.addToPath("Dart", "/fake/dart-sdk");

		// vs.env.clipboard cannot be stubbed, so verify the real clipboard like
		// the debug command tests do.
		assert.equal(await vs.env.clipboard.readText(), path.join("/fake/dart-sdk", "bin"));
	});

	it("reports already-on-PATH when the update fails but PATH contains the SDK", async function () {
		if (posixOnly)
			return this.skip();
		setEnvVar("SHELL", "/bin/bash");
		const originalPath = process.env.PATH;
		setEnvVar("PATH", `${originalPath ?? ""}:/fake/dart-sdk/bin`);
		const home = useTempHome();
		// Make the profile path a directory so appending fails.
		fs.mkdirSync(unixProfilePath(home, "bash"));
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage").resolves(undefined);

		await privateApi.addSdkToPath.addToPath("Dart", "/fake/dart-sdk");

		assert.ok(showInformationMessage.calledOnceWithExactly(sdkAlreadyOnPathPrompt("Dart")));
	});

	it("promptToAddToPath asks and adds to PATH when accepted", async function () {
		if (posixOnly)
			return this.skip();
		setEnvVar("SHELL", "/bin/bash");
		const home = useTempHome();
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage").resolves(addSdkToPathAction);

		await privateApi.addSdkToPath.promptToAddToPath("Dart", "/fake/dart-sdk");

		// addToPath shows a second prompt with the result, so check each call.
		assert.deepEqual(showInformationMessage.firstCall.args, [addSdkToPathPrompt("Dart"), addSdkToPathAction, noThanksAction]);
		assert.deepEqual(showInformationMessage.secondCall.args, [addedToPathPrompt("Dart")]);
		assert.equal(
			fs.readFileSync(unixProfilePath(home, "bash"), "utf8"),
			`export PATH="${path.join("/fake/dart-sdk", "bin")}:$PATH"\n`,
		);
	});

	it("promptToAddToPath does nothing when declined", async function () {
		if (posixOnly)
			return this.skip();
		setEnvVar("SHELL", "/bin/bash");
		const home = useTempHome();
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage").resolves(noThanksAction);

		await privateApi.addSdkToPath.promptToAddToPath("Dart", "/fake/dart-sdk");

		assert.ok(showInformationMessage.calledOnce);
		assert.equal(fs.existsSync(unixProfilePath(home, "bash")), false);
	});

	it("promptToAddToPath shows manual instructions when automatic add is unavailable", async function () {
		if (posixOnly)
			return this.skip();
		setEnvVar("SHELL", "/bin/fish");
		useTempHome();
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage").resolves(noThanksAction);

		await privateApi.addSdkToPath.promptToAddToPath("Dart", "/fake/dart-sdk");

		assert.ok(showInformationMessage.calledOnce);
		assert.deepEqual(showInformationMessage.firstCall.args, [addSdkToPathPrompt("Dart"), openInstructionsAction, copySdkBinPathToClipboardAction, noThanksAction]);
	});

	it("dart.addSdkToPath adds the workspace Dart SDK to the profile", async function () {
		if (posixOnly)
			return this.skip();
		setEnvVar("SHELL", "/bin/bash");
		const home = useTempHome();
		sb.stub(vs.window, "showInformationMessage").resolves(undefined);
		const dartSdk = privateApi.workspaceContext.sdks.dart;
		if (!dartSdk)
			return this.skip();

		await vs.commands.executeCommand("dart.addSdkToPath");

		assert.ok(
			fs
				.readFileSync(unixProfilePath(home, "bash"), "utf8")
				.includes(`export PATH="${path.join(dartSdk, "bin")}:$PATH"`),
		);
	});

	it("flutter.addSdkToPath adds the workspace Flutter SDK to the profile", async function () {
		if (posixOnly)
			return this.skip();
		setEnvVar("SHELL", "/bin/bash");
		const home = useTempHome();
		overrideSdks({ flutter: "/fake/flutter-sdk" });
		sb.stub(vs.window, "showInformationMessage").resolves(undefined);

		await vs.commands.executeCommand("flutter.addSdkToPath");

		assert.ok(
			fs
				.readFileSync(unixProfilePath(home, "bash"), "utf8")
				.includes(`export PATH="${path.join("/fake/flutter-sdk", "bin")}:$PATH"`),
		);
	});

	it("flutter.addSdkToPath shows an error when no Flutter SDK is available", async () => {
		overrideSdks({ flutter: undefined });
		const showErrorMessage = sb.stub(vs.window, "showErrorMessage").resolves(undefined);

		await vs.commands.executeCommand("flutter.addSdkToPath");

		assert.ok(showErrorMessage.calledOnceWithExactly(noSdkAvailablePrompt));
	});

	it("dart.addSdkToPath delegates to flutter.addSdkToPath when the Dart SDK comes from Flutter", async function () {
		if (posixOnly)
			return this.skip();
		setEnvVar("SHELL", "/bin/bash");
		const home = useTempHome();
		const realDartBin = path.join(privateApi.workspaceContext.sdks.dart ?? "", "bin");
		overrideSdks({ flutter: "/fake/flutter-sdk", dartSdkIsFromFlutter: true });
		sb.stub(vs.window, "showInformationMessage").resolves(undefined);

		await vs.commands.executeCommand("dart.addSdkToPath");

		const profile = fs.readFileSync(unixProfilePath(home, "bash"), "utf8");
		assert.ok(profile.includes(`export PATH="${path.join("/fake/flutter-sdk", "bin")}:$PATH"`));
		assert.ok(!profile.includes(realDartBin));
	});

	it("dart.addSdkToPath uses the Dart SDK directly when it is not from Flutter", async function () {
		if (posixOnly)
			return this.skip();
		setEnvVar("SHELL", "/bin/bash");
		const home = useTempHome();
		overrideSdks({ dart: "/fake/dart-sdk", flutter: "/fake/flutter-sdk", dartSdkIsFromFlutter: false });
		sb.stub(vs.window, "showInformationMessage").resolves(undefined);

		await vs.commands.executeCommand("dart.addSdkToPath");

		const profile = fs.readFileSync(unixProfilePath(home, "bash"), "utf8");
		assert.ok(profile.includes(`export PATH="${path.join("/fake/dart-sdk", "bin")}:$PATH"`));
		assert.ok(!profile.includes("/fake/flutter-sdk"));
	});

	it("addToPathWindows runs the PowerShell script and reports success", async function () {
		if (winOnly)
			return this.skip();
		const spawn = ChildProcessSpawnStub.powershellAddToPath({ result: () => ({ exitCode: 0 }) });
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage").resolves(undefined);

		await privateApi.addSdkToPath.addToPath("Dart", "C:\\fake\\dart-sdk");

		assert.ok(showInformationMessage.calledOnceWithExactly(addedToPathPrompt("Dart")));
		assert.equal(spawn.calls.length, 1);
		const call = spawn.calls[0];
		assert.equal(call.bin, "powershell");
		assert.ok(call.args?.includes("-File"));
		assert.ok(call.args?.some((arg) => arg.replace(/\\/g, "/").endsWith("/add_to_path.ps1")));
		assert.equal(call.args?.[call.args.length - 1], path.join("C:\\fake\\dart-sdk", "bin"));
	});

	it("addToPathWindows reports already-on-PATH for the script's exit code 12345", async function () {
		if (winOnly)
			return this.skip();
		ChildProcessSpawnStub.powershellAddToPath({ result: () => ({ exitCode: 12345 }) });
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage").resolves(undefined);

		await privateApi.addSdkToPath.addToPath("Dart", "C:\\fake\\dart-sdk");

		assert.ok(showInformationMessage.calledOnceWithExactly(sdkAlreadyOnPathPrompt("Dart")));
	});

	it("addToPathWindows shows manual instructions when the script fails", async function () {
		if (winOnly)
			return this.skip();
		ChildProcessSpawnStub.powershellAddToPath({ result: () => ({ exitCode: 1, stderr: "failure" }) });
		const showWarningMessage = sb.stub(vs.window, "showWarningMessage").resolves(noThanksAction);

		await privateApi.addSdkToPath.addToPath("Dart", "C:\\fake\\dart-sdk");

		assert.deepEqual(showWarningMessage.firstCall.args, [unableToAddToPathPrompt("Dart"), openInstructionsAction, copySdkBinPathToClipboardAction, noThanksAction]);
	});

	it("addToPathWindows shows manual instructions when PowerShell cannot be spawned", async function () {
		if (winOnly)
			return this.skip();
		ChildProcessSpawnStub.powershellAddToPath({ result: () => ({ error: new Error("spawn powershell ENOENT") }) });
		const showWarningMessage = sb.stub(vs.window, "showWarningMessage").resolves(noThanksAction);

		await privateApi.addSdkToPath.addToPath("Dart", "C:\\fake\\dart-sdk");

		assert.deepEqual(showWarningMessage.firstCall.args, [unableToAddToPathPrompt("Dart"), openInstructionsAction, copySdkBinPathToClipboardAction, noThanksAction]);
	});
});

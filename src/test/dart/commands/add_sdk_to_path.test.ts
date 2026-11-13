import { strict as assert } from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vs from "vscode";
import { addSdkToPathAction, addSdkToPathPrompt, addedToPathPrompt, addToPathInstructionsUrl, copySdkPathToClipboardAction, isLinux, isMac, noSdkAvailablePrompt, noThanksAction, openInstructionsAction, sdkAlreadyOnPathPrompt, unableToAddToPathPrompt } from "../../../shared/constants";
import { activate, defer, privateApi, sb } from "../../helpers";

// These tests exercise the Unix code paths in AddSdkToPath, which write to the
// user's shell profile. They redirect HOME to a temporary directory and set
// SHELL explicitly so they are independent of the machine they run on. The
// Windows branch (PowerShell script) is not covered here.
const posixOnly = !isLinux && !isMac;

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
		assert.deepEqual(showInformationMessage.firstCall.args, [addSdkToPathPrompt("Dart"), openInstructionsAction, copySdkPathToClipboardAction, noThanksAction]);
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
		assert.deepEqual(showWarningMessage.firstCall.args, [unableToAddToPathPrompt("Dart"), openInstructionsAction, copySdkPathToClipboardAction, noThanksAction]);
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
		showInformationMessage.onFirstCall().resolves(copySdkPathToClipboardAction);
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
		assert.deepEqual(showInformationMessage.firstCall.args, [addSdkToPathPrompt("Dart"), openInstructionsAction, copySdkPathToClipboardAction, noThanksAction]);
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
});

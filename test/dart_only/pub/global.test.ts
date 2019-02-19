import * as assert from "assert";
import * as vs from "vscode";
import { VersionStatus } from "../../../src/pub/global";
import { activate, defer, extApi, sb } from "../../helpers";

const alreadyInstalledPackage = "devtools";
const definitelyNotInstalledPackage = "path";

describe("pub global", () => {
	beforeEach("activate", () => activate(null));

	it("reports not-installed for a package that's not installed", async () => {
		const status = await extApi.pubGlobal.getInstalledStatus(definitelyNotInstalledPackage, definitelyNotInstalledPackage);
		assert.equal(status, VersionStatus.NotInstalled);
	});

	it("reports valid for a package that's installed and up-to-date", async () => {
		const status = await extApi.pubGlobal.getInstalledStatus(alreadyInstalledPackage, alreadyInstalledPackage, "0.0.1");
		assert.equal(status, VersionStatus.Valid);
	});

	it("reports out-of-date for a package installed but old", async () => {
		// DevTools is installed by CI scripts. Probably it'll never reach v999.999.999.
		const status = await extApi.pubGlobal.getInstalledStatus(alreadyInstalledPackage, alreadyInstalledPackage, "999.999.999");
		assert.equal(status, VersionStatus.UpdateRequired);
	});

	it("can install a package that's not installed", async () => {
		const installPrompt = sb.stub(vs.window, "showWarningMessage").resolves(`Activate ${definitelyNotInstalledPackage}`);

		// Prompt to install it, and ensure it's successful.
		const installed = await extApi.pubGlobal.promptToInstallIfRequired(definitelyNotInstalledPackage, definitelyNotInstalledPackage);
		assert.equal(installed, true);
		assert.equal(installPrompt.calledOnce, true);

		// Ensure new status checks includes it.
		defer(() => extApi.pubGlobal.uninstall(definitelyNotInstalledPackage));
		const status = await extApi.pubGlobal.getInstalledStatus(definitelyNotInstalledPackage, definitelyNotInstalledPackage);
		assert.equal(status, VersionStatus.Valid);
	});

	it("does not prompt to install a package that's already installed", async () => {
		const installPrompt = sb.stub(vs.window, "showWarningMessage");

		const installed = await extApi.pubGlobal.promptToInstallIfRequired(alreadyInstalledPackage, alreadyInstalledPackage);
		assert.equal(installed, true);
		assert.equal(installPrompt.calledOnce, false);
	});
});

import * as assert from "assert";
import * as vs from "vscode";
import { twoHoursInMs } from "../../../shared/constants";
import { VersionStatus } from "../../../shared/enums";
import { activate, defer, extApi, sb } from "../../helpers";

const alreadyInstalledPackage = "devtools";
const installedButBelowMinimumPackage1 = "args";
const installedButBelowMinimumPackage1NewVersion = "1.5.1";
const installedButBelowMinimumPackage2 = "meta";
const installedButBelowMinimumPackage2NewVersion = "1.1.7";
const installedButOutOfDatePackage1 = "pedantic";
const installedButOutOfDatePackage2 = "json_annotation";
const definitelyNotInstalledPackage1 = "path";
const definitelyNotInstalledPackage2 = "usage";

describe("pub global", () => {
	beforeEach("activate", () => activate(null));

	it("reports not-installed for a package that's not installed", async () => {
		const installedVersion = await extApi.pubGlobal.getInstalledVersion(definitelyNotInstalledPackage1, definitelyNotInstalledPackage1);
		const status = await extApi.pubGlobal.checkVersionStatus(definitelyNotInstalledPackage1, installedVersion);
		assert.equal(status, VersionStatus.NotInstalled);
	});

	it("reports valid for a package that's installed and up-to-date", async () => {
		const installedVersion = await extApi.pubGlobal.getInstalledVersion(alreadyInstalledPackage, alreadyInstalledPackage);
		const status = await extApi.pubGlobal.checkVersionStatus(alreadyInstalledPackage, installedVersion, "0.0.1");
		assert.equal(status, VersionStatus.Valid);
	});

	it("reports update-required for a package installed but old", async () => {
		// DevTools is installed by CI scripts. Probably it'll never reach v999.999.999.
		const installedVersion = await extApi.pubGlobal.getInstalledVersion(alreadyInstalledPackage, alreadyInstalledPackage);
		const status = await extApi.pubGlobal.checkVersionStatus(alreadyInstalledPackage, installedVersion, "999.999.999");
		assert.equal(status, VersionStatus.UpdateRequired);
	});

	it("does not report update-available for an out-of-date package if checked within 24 hours", async () => {
		extApi.context.setPackageLastCheckedForUpdates(installedButOutOfDatePackage1, Date.now() - twoHoursInMs);

		const installedVersion = await extApi.pubGlobal.getInstalledVersion(installedButOutOfDatePackage1, installedButOutOfDatePackage1);
		const status = await extApi.pubGlobal.checkVersionStatus(installedButOutOfDatePackage1, installedVersion);
		assert.equal(status, VersionStatus.Valid);
	});

	it("does report update-available for an out-of-date package last checked over 24 hours ago", async () => {
		const twentyFiveHoursInMs = 1000 * 60 * 60 * 25;
		extApi.context.setPackageLastCheckedForUpdates(installedButOutOfDatePackage1, Date.now() - twentyFiveHoursInMs);

		const installedVersion = await extApi.pubGlobal.getInstalledVersion(installedButOutOfDatePackage1, installedButOutOfDatePackage1);
		const status = await extApi.pubGlobal.checkVersionStatus(installedButOutOfDatePackage1, installedVersion);
		assert.equal(status, VersionStatus.UpdateAvailable);
	});

	it("can install a package that's not installed", async () => {
		const installPrompt = sb.stub(vs.window, "showWarningMessage").resolves(`Activate ${definitelyNotInstalledPackage2}`);

		let installedVersion = await extApi.pubGlobal.promptToInstallIfRequired(definitelyNotInstalledPackage2, definitelyNotInstalledPackage2);
		assert.ok(installedVersion);
		assert.equal(installPrompt.calledOnce, true);

		// Ensure new status checks includes it.
		defer(() => extApi.pubGlobal.uninstall(definitelyNotInstalledPackage2));
		// Prompt to install it, and ensure it's successful.
		installedVersion = await extApi.pubGlobal.getInstalledVersion(definitelyNotInstalledPackage2, definitelyNotInstalledPackage2);
		const status = await extApi.pubGlobal.checkVersionStatus(definitelyNotInstalledPackage2, installedVersion);
		assert.equal(status, VersionStatus.Valid);
	});

	it("can prompt to update a below-minimum package", async () => {
		const installPrompt = sb.stub(vs.window, "showWarningMessage").resolves(`Update ${installedButBelowMinimumPackage1}`);

		// Prompt to update it, and ensure it's successful.
		let installedVersion = await extApi.pubGlobal.promptToInstallIfRequired(installedButBelowMinimumPackage1, installedButBelowMinimumPackage1, "", installedButBelowMinimumPackage1NewVersion);
		assert.ok(installedVersion);
		assert.equal(installPrompt.calledOnce, true);

		// Ensure new status checks includes it.
		installedVersion = await extApi.pubGlobal.getInstalledVersion(installedButBelowMinimumPackage1, installedButBelowMinimumPackage1);
		const status = await extApi.pubGlobal.checkVersionStatus(installedButBelowMinimumPackage1, installedVersion);
		assert.equal(status, VersionStatus.Valid);
	});

	it("can prompt to update an out-of-date package", async () => {
		extApi.context.setPackageLastCheckedForUpdates(installedButOutOfDatePackage1, undefined);

		const installPrompt = sb.stub(vs.window, "showWarningMessage").resolves(`Update ${installedButOutOfDatePackage1}`);

		// Prompt to update it, and ensure it's successful.
		let installedVersion = await extApi.pubGlobal.promptToInstallIfRequired(installedButOutOfDatePackage1, installedButOutOfDatePackage1, "");
		assert.ok(installedVersion);
		assert.equal(installPrompt.calledOnce, true);

		// Ensure new status checks includes it.
		installedVersion = await extApi.pubGlobal.getInstalledVersion(installedButOutOfDatePackage1, installedButOutOfDatePackage1);
		const status = await extApi.pubGlobal.checkVersionStatus(installedButOutOfDatePackage1, installedVersion);
		assert.equal(status, VersionStatus.Valid);
	});

	it("can auto-update a below-minimum package", async () => {
		extApi.context.setPackageLastCheckedForUpdates(installedButOutOfDatePackage1, undefined);
		const installPrompt = sb.stub(vs.window, "showWarningMessage");

		// Ensure we're not prompted but it's updated.
		let installedVersion = await extApi.pubGlobal.promptToInstallIfRequired(installedButBelowMinimumPackage2, installedButBelowMinimumPackage2, "", installedButBelowMinimumPackage2NewVersion, undefined, true);
		assert.ok(installedVersion);
		assert.equal(installPrompt.called, false);

		// Ensure new status checks includes it.
		installedVersion = await extApi.pubGlobal.getInstalledVersion(installedButBelowMinimumPackage2, installedButBelowMinimumPackage2);
		const status = await extApi.pubGlobal.checkVersionStatus(installedButBelowMinimumPackage2, installedVersion);
		assert.equal(status, VersionStatus.Valid);
	});

	it("can auto-update an out-of-date package", async () => {
		const installPrompt = sb.stub(vs.window, "showWarningMessage");

		// Ensure we're not prompted but it's updated.
		let installedVersion = await extApi.pubGlobal.promptToInstallIfRequired(installedButOutOfDatePackage2, installedButOutOfDatePackage2, "", undefined, undefined, true);
		assert.ok(installedVersion);
		assert.equal(installPrompt.called, false);

		// Ensure new status checks includes it.
		installedVersion = await extApi.pubGlobal.getInstalledVersion(installedButOutOfDatePackage2, installedButOutOfDatePackage2);
		const status = await extApi.pubGlobal.checkVersionStatus(installedButOutOfDatePackage2, installedVersion);
		assert.equal(status, VersionStatus.Valid);
	});

	it("does not prompt to install a package that's already installed", async () => {
		const installPrompt = sb.stub(vs.window, "showWarningMessage");

		const installedVersion = await extApi.pubGlobal.promptToInstallIfRequired(alreadyInstalledPackage, alreadyInstalledPackage);
		assert.ok(installedVersion);
		assert.equal(installPrompt.calledOnce, false);
	});
});

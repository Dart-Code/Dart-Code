import * as path from "path";
import * as vs from "vscode";
import { noRepeatPromptThreshold, pubGlobalDocsUrl, pubPath } from "../../shared/constants";
import { LogCategory, VersionStatus } from "../../shared/enums";
import { DartSdks, Logger } from "../../shared/interfaces";
import { logProcess } from "../../shared/logging";
import { PubApi } from "../../shared/pub/api";
import { usingCustomScript, versionIsAtLeast } from "../../shared/utils";
import { envUtils } from "../../shared/vscode/utils";
import { Context } from "../../shared/vscode/workspace";
import { safeToolSpawn } from "../utils/processes";

export class PubGlobal {
	constructor(private readonly logger: Logger, private context: Context, private sdks: DartSdks, private pubApi: PubApi) { }

	public async promptToInstallIfRequired(packageName: string, packageID: string, moreInfoLink = pubGlobalDocsUrl, requiredVersion: string, customActivateScript?: string, autoUpdate: boolean = false): Promise<boolean> {
		const versionStatus = customActivateScript ? VersionStatus.UpdateRequired : await this.getInstalledStatus(packageName, packageID, requiredVersion);
		if (versionStatus === VersionStatus.Valid)
			return true;

		const moreInfo = "More Info";
		const activateForMe = versionStatus === VersionStatus.NotInstalled ? `Activate ${packageName}` : `Update ${packageName}`;
		const message = versionStatus === VersionStatus.NotInstalled
			? `${packageName} needs to be installed with 'pub global activate ${packageID}' to use this feature.`
			: (
				versionStatus === VersionStatus.UpdateRequired
					? `${packageName} needs to be updated with 'pub global activate ${packageID}' to use this feature.`
					: `A new version of ${packageName} is available and can be installed with 'pub global activate ${packageID}'.`
			);

		let action =
			// If we need an update and we're allowed to auto-update, to the same as if the user
			// clicked the activate button, otherwise prompt them.
			// TODO: VERIFY THIS:
			//    Custom activate scripts bypass the check and are always just immediately called.
			customActivateScript
				|| (autoUpdate && (versionStatus === VersionStatus.UpdateRequired || versionStatus === VersionStatus.UpdateAvailable))
				? activateForMe
				: await vs.window.showWarningMessage(message, activateForMe, moreInfo);

		if (action === moreInfo) {
			await envUtils.openInBrowser(moreInfoLink);
			return false;
		} else if (action === activateForMe) {
			const actionName = versionStatus === VersionStatus.NotInstalled ? `Activating ${packageName}` : `Updating ${packageName}`;

			const args = ["global", "activate", packageID];
			await this.runCommandWithProgress(packageName, `${actionName}...`, args, customActivateScript);
			if (await this.getInstalledStatus(packageName, packageID) === VersionStatus.Valid) {
				return true;
			} else {
				action = await vs.window.showErrorMessage(`${actionName} failed. Please try running 'pub global activate ${packageID}' manually.`, moreInfo);
				if (action === moreInfo) {
					await envUtils.openInBrowser(moreInfoLink);
				}
				return false;
			}
		}

		return false;
	}

	public async uninstall(packageID: string): Promise<void> {
		const args = ["global", "deactivate", packageID];
		await this.runCommand(packageID, args);
	}

	public async getInstalledStatus(packageName: string, packageID: string, requiredVersion?: string): Promise<VersionStatus> {
		const output = await this.runCommand(packageName, ["global", "list"]);
		const versionMatch = new RegExp(`^${packageID} (\\d+\\.\\d+\\.\\d+)(?: at| from|$|\\-|\\+)`, "m");
		const match = versionMatch.exec(output);

		// No match = not installed.
		if (!match)
			return VersionStatus.NotInstalled;

		// If we need a specific version, check it here.
		if (requiredVersion && !versionIsAtLeast(match[1], requiredVersion))
			return VersionStatus.UpdateRequired;

		// If we haven't checked in the last 24 hours, check if there's an update available.
		const lastChecked = this.context.getPackageLastCheckedForUpdates(packageID);
		if (!lastChecked || lastChecked <= Date.now() - noRepeatPromptThreshold) {
			this.context.setPackageLastCheckedForUpdates(packageID, Date.now());
			try {
				const pubPackage = await this.pubApi.getPackage(packageID);
				if (!versionIsAtLeast(match[1], pubPackage.latest.version))
					return VersionStatus.UpdateAvailable;
			} catch (e) {
				// If we fail to call the API to check for a new version, then we can run
				// with what we have.
				this.logger.warn(`Failed to check for new version of ${packageID}: ${e}`, LogCategory.CommandProcesses);
				return VersionStatus.Valid;
			}
		}

		// Otherwise, we're installed and have a new enough version.
		return VersionStatus.Valid;
	}

	private runCommandWithProgress(packageName: string, title: string, args: string[], customActivateScript: string | undefined): Thenable<string> {
		return vs.window.withProgress({
			location: vs.ProgressLocation.Notification,
			title,
		}, (_) => this.runCommand(packageName, args, customActivateScript));
	}

	private runCommand(packageName: string, args: string[], customScript?: string | undefined): Thenable<string> {
		const { binPath, binArgs } = usingCustomScript(
			path.join(this.sdks.dart, pubPath),
			args,
			{ customScript, customScriptReplacesNumArgs: 3 },
		);

		return new Promise((resolve, reject) => {
			this.logger.info(`Spawning ${binPath} with args ${JSON.stringify(binArgs)}`);
			const proc = safeToolSpawn(undefined, binPath, binArgs);
			logProcess(this.logger, LogCategory.CommandProcesses, proc);

			const stdout: string[] = [];
			const stderr: string[] = [];
			proc.stdout.on("data", (data) => stdout.push(data.toString()));
			proc.stderr.on("data", (data) => stderr.push(data.toString()));
			proc.on("close", (code) => {
				if (!code) {
					resolve(stdout.join(""));
				} else {
					reject(`${packageName} exited with code ${code}.\n\n${stdout.join("")}\n\n${stderr.join("")}`);
				}
			});
		});
	}
}

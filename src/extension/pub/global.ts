import * as vs from "vscode";
import { DartCapabilities } from "../../shared/capabilities/dart";
import { moreInfoAction, noRepeatPromptThreshold, pubGlobalDocsUrl } from "../../shared/constants";
import { LogCategory, VersionStatus } from "../../shared/enums";
import { DartSdks, Logger } from "../../shared/interfaces";
import { logProcess } from "../../shared/logging";
import { getPubExecutionInfo } from "../../shared/processes";
import { PubApi } from "../../shared/pub/api";
import { pubVersionIsAtLeast } from "../../shared/utils";
import { envUtils } from "../../shared/vscode/utils";
import { Context } from "../../shared/vscode/workspace";
import { safeToolSpawn } from "../utils/processes";

export class PubGlobal {
	constructor(private readonly logger: Logger, private readonly dartCapabilities: DartCapabilities, private context: Context, private sdks: DartSdks, private pubApi: PubApi) { }

	public async installIfRequired(options: { packageName?: string; packageID: string; moreInfoLink?: string; requiredVersion?: string; updateSilently?: boolean; skipOptionalUpdates?: boolean; silent?: boolean; }): Promise<string | undefined> {
		const packageID = options.packageID;
		const packageName = options.packageName ?? packageID;
		const moreInfoLink = options.moreInfoLink ?? pubGlobalDocsUrl;
		const requiredVersion = options.requiredVersion;
		const silent = !!options.silent;
		const skipOptionalUpdates = !!options.skipOptionalUpdates;
		let updateSilently = !!options.updateSilently;

		let installedVersion = await this.getInstalledVersion(packageName, packageID);
		const versionStatus = await this.checkVersionStatus(packageID, installedVersion, requiredVersion);

		// If we have the latest version, or the update is not mandatory (UpdateRequired) and we were told to skip optional updates
		// just bail and use the current version.
		if (versionStatus === VersionStatus.Valid || (skipOptionalUpdates && versionStatus === VersionStatus.UpdateAvailable))
			return installedVersion!;

		if (silent)
			updateSilently = true;

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
			updateSilently && ((versionStatus === VersionStatus.UpdateRequired || versionStatus === VersionStatus.UpdateAvailable) || silent)
				? activateForMe
				: await vs.window.showWarningMessage(message, activateForMe, moreInfoAction);

		if (action === moreInfoAction) {
			await envUtils.openInBrowser(moreInfoLink);
			return undefined;
		} else if (action === activateForMe) {
			const actionName = versionStatus === VersionStatus.NotInstalled ? `Activating ${packageName}` : `Updating ${packageName}`;

			const args = ["global", "activate", packageID];
			try {
				if (silent)
					await this.runCommand(packageName, args);
				else
					await this.runCommandWithProgress(packageName, `${actionName}...`, args);
				installedVersion = await this.getInstalledVersion(packageName, packageID);
				const newVersionStatus = await this.checkVersionStatus(packageID, installedVersion);
				if (newVersionStatus !== VersionStatus.Valid) {
					this.logger.warn(`After installing ${packageID}, version status was ${VersionStatus[newVersionStatus]} and not Valid!`);
				}
				return installedVersion;
			} catch (e) {
				this.logger.error(e);
				if (!silent) {
					action = await vs.window.showErrorMessage(`${actionName} failed. Please try running 'pub global activate ${packageID}' manually.`, moreInfoAction);
					if (action === moreInfoAction) {
						await envUtils.openInBrowser(moreInfoLink);
					}
				}
				return undefined;
			}
		}

		return undefined;
	}

	public async uninstall(packageID: string): Promise<void> {
		const args = ["global", "deactivate", packageID];
		await this.runCommand(packageID, args);
	}

	public async checkVersionStatus(packageID: string, installedVersion: string | undefined, requiredVersion?: string): Promise<VersionStatus> {
		if (!installedVersion) {
			this.logger.info(`${packageID} has no installed version, returning NotInstalled`);
			return VersionStatus.NotInstalled;
		}

		// If we need a specific version, check it here.
		if (requiredVersion && !pubVersionIsAtLeast(installedVersion, requiredVersion)) {
			this.logger.info(`${packageID} version ${installedVersion} is not at least ${requiredVersion} so returning UpdateRequired`);
			return VersionStatus.UpdateRequired;
		}

		// If we haven't checked in the last 24 hours, check if there's an update available.
		const lastChecked = this.context.getPackageLastCheckedForUpdates(packageID);
		if (!lastChecked || lastChecked <= Date.now() - noRepeatPromptThreshold) {
			this.context.setPackageLastCheckedForUpdates(packageID, Date.now());
			try {
				const pubPackage = await this.pubApi.getPackage(packageID);
				if (!pubVersionIsAtLeast(installedVersion, pubPackage.latest.version)) {
					if (pubPackage.latest.retracted) {
						this.logger.info(`${packageID} version ${installedVersion} is is retracted, so even though it's newer than ${pubPackage.latest.version}, returning Valid to avoid potentially installing repeatedly`);
						return VersionStatus.Valid;
					} else {
						this.logger.info(`${packageID} version ${installedVersion} is not at least ${pubPackage.latest.version} so returning UpdateAvailable`);
						return VersionStatus.UpdateAvailable;
					}
				}
			} catch (e) {
				// If we fail to call the API to check for a new version, then we can run
				// with what we have.
				this.logger.warn(`Failed to check for new version of ${packageID}: ${e}`, LogCategory.CommandProcesses);
				return VersionStatus.Valid;
			}
		}

		// Otherwise, we're installed and have a new enough version.
		this.logger.info(`${packageID} version ${installedVersion} appears to be latest so returning Valid`);
		return VersionStatus.Valid;
	}

	public async getInstalledVersion(packageName: string, packageID: string): Promise<string | undefined> {
		const output = await this.runCommand(packageName, ["global", "list"]);
		const versionMatch = new RegExp(`^${packageID} (\\d+\\.\\d+\\.\\d+[\\w.\\-+]*)(?: |$)`, "m");
		const match = versionMatch.exec(output);
		const installedVersion = match ? match[1] : undefined;
		return installedVersion;
	}

	private runCommandWithProgress(packageName: string, title: string, args: string[]): Thenable<string> {
		return vs.window.withProgress({
			location: vs.ProgressLocation.Notification,
			title,
		}, () => this.runCommand(packageName, args));
	}

	private runCommand(packageName: string, args: string[]): Thenable<string> {
		const pubExecution = getPubExecutionInfo(this.dartCapabilities, this.sdks.dart, args);

		return new Promise((resolve, reject) => {
			this.logger.info(`Spawning ${pubExecution.executable} with args ${JSON.stringify(pubExecution.args)}`);
			const proc = safeToolSpawn(undefined, pubExecution.executable, pubExecution.args);
			logProcess(this.logger, LogCategory.CommandProcesses, proc);

			const stdout: string[] = [];
			const stderr: string[] = [];
			proc.stdout.on("data", (data: Buffer | string) => stdout.push(data.toString()));
			proc.stderr.on("data", (data: Buffer | string) => stderr.push(data.toString()));
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

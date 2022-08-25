import { ExtensionContext } from "vscode";
import { fsPath, mkDirRecursive } from "../utils/fs";

export class Context {
	private constructor(private readonly context: ExtensionContext) { }

	public static for(context: ExtensionContext): Context {
		return new Context(context);
	}

	get extensionStoragePath(): string | undefined {
		const uri = this.context.globalStorageUri;
		const path = uri.scheme === "file" ? fsPath(uri) : undefined;
		if (path)
			mkDirRecursive(path);
		return path;
	}

	get devToolsNotificationLastShown(): number | undefined { return this.context.globalState.get("devToolsNotificationLastShown") as number; }
	set devToolsNotificationLastShown(value: number | undefined) { this.context.globalState.update("devToolsNotificationLastShown", value); }
	get devToolsNotificationDoNotShow(): boolean | undefined { return !!this.context.globalState.get("devToolsNotificationDoNotShowAgain"); }
	set devToolsNotificationDoNotShow(value: boolean | undefined) { this.context.globalState.update("devToolsNotificationDoNotShowAgain", value); }
	get breakpointInNonDebuggableFileDoNotShowAgain(): boolean | undefined { return !!this.context.globalState.get("breakpointInNonDebuggableFileDoNotShowAgain"); }
	set breakpointInNonDebuggableFileDoNotShowAgain(value: boolean | undefined) { this.context.globalState.update("breakpointInNonDebuggableFileDoNotShowAgain", value); }
	public getFlutterSurveyNotificationLastShown(id: string): number | undefined { return this.context.globalState.get(`flutterSurvey${id}NotificationLastShown`) as number; }
	public setFlutterSurveyNotificationLastShown(id: string, value: number | undefined) { this.context.globalState.update(`flutterSurvey${id}NotificationLastShown`, value); }
	public getFlutterSurveyNotificationDoNotShow(id: string): boolean | undefined { return !!this.context.globalState.get(`flutterSurvey${id}NotificationDoNotShowAgain`); }
	public setFlutterSurveyNotificationDoNotShow(id: string, value: boolean | undefined) { this.context.globalState.update(`flutterSurvey${id}NotificationDoNotShowAgain`, value); }
	get hasWarnedAboutFormatterSyntaxLimitation(): boolean { return !!this.context.globalState.get("hasWarnedAboutFormatterSyntaxLimitation"); }
	set hasWarnedAboutFormatterSyntaxLimitation(value: boolean) { this.context.globalState.update("hasWarnedAboutFormatterSyntaxLimitation", value); }
	get hasWarnedAboutPubUpgradeMajorVersionsPubpecMutation(): boolean { return !!this.context.globalState.get("hasWarnedAboutPubUpgradeMajorVersionsPubpecMutation"); }
	set hasWarnedAboutPubUpgradeMajorVersionsPubpecMutation(value: boolean) { this.context.globalState.update("hasWarnedAboutPubUpgradeMajorVersionsPubpecMutation", value); }
	get hasNotifiedAboutProfileModeDefaultConfiguration(): boolean { return !!this.context.globalState.get("hasNotifiedAboutProfileModeDefaultConfiguration"); }
	set hasNotifiedAboutProfileModeDefaultConfiguration(value: boolean) { this.context.globalState.update("hasNotifiedAboutProfileModeDefaultConfiguration", value); }
	get lastSeenVersion(): string | undefined { return this.context.globalState.get("lastSeenVersion"); }
	set lastSeenVersion(value: string | undefined) { this.context.globalState.update("lastSeenVersion", value); }
	get lastUsedNewProjectPath(): string | undefined { return this.context.globalState.get("lastUsedNewProjectPath"); }
	set lastUsedNewProjectPath(value: string | undefined) { this.context.globalState.update("lastUsedNewProjectPath", value); }

	public getPackageLastCheckedForUpdates(packageID: string): number | undefined { return this.context.globalState.get(`packageLastCheckedForUpdates:${packageID}`) as number; }
	public setPackageLastCheckedForUpdates(packageID: string, value: number | undefined) { this.context.globalState.update(`packageLastCheckedForUpdates:${packageID}`, value); }

	public update(key: string, value: any): any {
		return this.context.globalState.update(key, value);
	}
	public get(key: string): any {
		return this.context.globalState.get(key);
	}

	public asAbsolutePath(relativePath: string): string {
		return this.context.asAbsolutePath(relativePath);
	}
}

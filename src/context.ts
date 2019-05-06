import { ExtensionContext } from "vscode";

export class Context {

	private context: ExtensionContext;

	private constructor(context: ExtensionContext) {
		this.context = context;
	}

	public static for(context: ExtensionContext): Context {
		return new Context(context);
	}

	get devToolsNotificationsShown(): number | undefined { return (this.context.globalState.get("devToolsNotificationsShown") as number) || 0; }
	set devToolsNotificationsShown(value: number | undefined) { this.context.globalState.update("devToolsNotificationsShown", value); }
	get devToolsNotificationLastShown(): number | undefined { return this.context.globalState.get("devToolsNotificationLastShown") as number; }
	set devToolsNotificationLastShown(value: number | undefined) { this.context.globalState.update("devToolsNotificationLastShown", value); }
	get devToolsNotificationDoNotShow(): boolean | undefined { return !!this.context.globalState.get("devToolsNotificationDoNotShowAgain"); }
	set devToolsNotificationDoNotShow(value: boolean | undefined) { this.context.globalState.update("devToolsNotificationDoNotShowAgain", value); }
	get flutterSurvey2019Q2NotificationLastShown(): number | undefined { return this.context.globalState.get("flutterSurvey2019Q2NotificationLastShown") as number; }
	set flutterSurvey2019Q2NotificationLastShown(value: number | undefined) { this.context.globalState.update("flutterSurvey2019Q2NotificationLastShown", value); }
	get flutterSurvey2019Q2NotificationDoNotShow(): boolean | undefined { return !!this.context.globalState.get("flutterSurvey2019Q2NotificationDoNotShowAgain"); }
	set flutterSurvey2019Q2NotificationDoNotShow(value: boolean | undefined) { this.context.globalState.update("flutterSurvey2019Q2NotificationDoNotShowAgain", value); }
	get hasWarnedAboutFormatterSyntaxLimitation(): boolean { return !!this.context.globalState.get("hasWarnedAboutFormatterSyntaxLimitation"); }
	set hasWarnedAboutFormatterSyntaxLimitation(value: boolean) { this.context.globalState.update("hasWarnedAboutFormatterSyntaxLimitation", value); }
	get lastSeenVersion(): string | undefined { return this.context.globalState.get("lastSeenVersion"); }
	set lastSeenVersion(value: string | undefined) { this.context.globalState.update("lastSeenVersion", value); }

	public getPackageLastCheckedForUpdates(packageID: string): number | undefined { return this.context.globalState.get(`packageLastCheckedForUpdates:${packageID}`) as number; }
	public setPackageLastCheckedForUpdates(packageID: string, value: number | undefined) { this.context.globalState.update(`packageLastCheckedForUpdates:${packageID}`, value); }

	public update(key: string, value: any): any {
		return this.context.globalState.update(key, value);
	}
	public get(key: string): any {
		return this.context.globalState.get(key);
	}

	get subscriptions(): Array<{ dispose(): any }> { return this.context.subscriptions; }
}

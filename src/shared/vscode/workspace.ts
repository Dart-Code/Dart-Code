import { ExtensionContext } from "vscode";

export class Context {
	private context: ExtensionContext;

	private constructor(context: ExtensionContext) {
		this.context = context;
	}

	public static for(context: ExtensionContext): Context {
		return new Context(context);
	}

	get devToolsNotificationLastShown(): number | undefined { return this.context.globalState.get("devToolsNotificationLastShown") as number; }
	set devToolsNotificationLastShown(value: number | undefined) { this.context.globalState.update("devToolsNotificationLastShown", value); }
	get devToolsNotificationDoNotShow(): boolean | undefined { return !!this.context.globalState.get("devToolsNotificationDoNotShowAgain"); }
	set devToolsNotificationDoNotShow(value: boolean | undefined) { this.context.globalState.update("devToolsNotificationDoNotShowAgain", value); }
	public getFlutterSurveyNotificationLastShown(id: string): number | undefined { return this.context.globalState.get(`flutterSurvey${id}NotificationLastShown`) as number; }
	public setFlutterSurveyNotificationLastShown(id: string, value: number | undefined) { this.context.globalState.update(`flutterSurvey${id}NotificationLastShown`, value); }
	public getFlutterSurveyNotificationDoNotShow(id: string): boolean | undefined { return !!this.context.globalState.get(`flutterSurvey${id}NotificationDoNotShowAgain`); }
	public setFlutterSurveyNotificationDoNotShow(id: string, value: boolean | undefined) { this.context.globalState.update(`flutterSurvey${id}NotificationDoNotShowAgain`, value); }
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

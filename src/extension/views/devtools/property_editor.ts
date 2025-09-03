import * as vs from "vscode";
import { DartCapabilities } from "../../../shared/capabilities/dart";
import { IAmDisposable } from "../../../shared/interfaces";
import { disposeAll } from "../../../shared/utils";
import { DevToolsManager } from "../../sdk/dev_tools/manager";
import { WebViewUrls } from "../shared";
import { MySimpleBaseWebViewProvider } from "./base_view_provider";

export class PropertyEditor implements IAmDisposable {
	protected readonly disposables: vs.Disposable[] = [];

	constructor(
		readonly devTools: DevToolsManager,
		dartCapabilities: DartCapabilities,
	) {
		const webViewProvider = new MyWebViewProvider(devTools, dartCapabilities);
		this.disposables.push(webViewProvider);
		this.disposables.push(vs.window.registerWebviewViewProvider("flutterPropertyEditor", webViewProvider, { webviewOptions: { retainContextWhenHidden: true } }));
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}

class MyWebViewProvider extends MySimpleBaseWebViewProvider {
	get pageName(): string {
		return "Flutter Property Editor";
	}
	get pageRoute(): string {
		return "propertyEditor";
	}
	get pageUrls(): Promise<WebViewUrls | undefined> {
		return this.getPageUrls();
	}

	private async getPageUrls(): Promise<WebViewUrls | undefined> {
		const urls = await super.pageUrls;
		if (!urls)
			return undefined;

		const dtdUri = await this.devTools.dtdUri;
		return {
			viewUrl: urls.viewUrl,
			authUrls: dtdUri ? (urls.authUrls ?? []).concat([dtdUri]) : urls.authUrls,
		};
	}
}


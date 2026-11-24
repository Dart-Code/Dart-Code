import * as vs from "vscode";
import { DartCapabilities } from "../../../shared/capabilities/dart";
import { IAmDisposable, Logger } from "../../../shared/interfaces";
import { disposeAll } from "../../../shared/utils";
import { DevToolsManager } from "../../sdk/dev_tools/manager";
import { MySimpleBaseWebViewProvider } from "./base_view_provider";

export class PropertyEditor implements IAmDisposable {
	protected readonly disposables: IAmDisposable[] = [];

	constructor(
		devTools: DevToolsManager,
		dartCapabilities: DartCapabilities,
		logger: Logger,
	) {
		const webViewProvider = new MyWebViewProvider(devTools, dartCapabilities, logger);
		this.disposables.push(webViewProvider);
		this.disposables.push(vs.window.registerWebviewViewProvider("flutterPropertyEditor", webViewProvider, { webviewOptions: { retainContextWhenHidden: true } }));
	}

	public dispose(): void {
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
}


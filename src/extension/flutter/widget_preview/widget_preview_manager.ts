import * as vs from "vscode";
import { FLUTTER_WIDGET_PREVIEW_SUPPORTED_CONTEXT } from "../../../shared/constants.contexts";
import { IAmDisposable, Logger } from "../../../shared/interfaces";
import { disposeAll, PromiseCompleter } from "../../../shared/utils";
import { FlutterWidgetPreviewServer } from "../../flutter/widget_preview_server";
import { exposeWebViewUrls, WebViewUrls } from "../../views/shared";
import { WidgetPreviewEmbeddedView, WidgetPreviewSidebarView, WidgetPreviewView } from "./webviews";

/**
 * Manages Flutter Widget Preview functionality.
 */
export class FlutterWidgetPreviewManager implements IAmDisposable {
	private readonly disposables: vs.Disposable[] = [];
	private server: FlutterWidgetPreviewServer;
	private view?: WidgetPreviewView;
	private setUpPreviewPromise: Promise<void> | undefined;
	private hasShownProgress = false;

	constructor(
		private readonly logger: Logger,
		readonly flutterSdkPath: string,
		private readonly dtdUri: Promise<string | undefined> | undefined,
		devtoolsServerUri: Promise<string | undefined> | undefined,
		readonly tempWorkingDirectory: string,
		private readonly location: "sidebar" | "beside",
	) {
		// Start the preview server.
		this.server = new FlutterWidgetPreviewServer(
			this.logger,
			flutterSdkPath,
			dtdUri,
			devtoolsServerUri,
			tempWorkingDirectory,
		);
		this.disposables.push(this.server);

		// Register a command to show the preview.
		this.disposables.push(vs.commands.registerCommand("flutter.showWidgetPreview", () => this.showPreview()));

		// Set a context to indicate that this feature is available (used in package.json to control
		// the visibility of commands).
		void vs.commands.executeCommand("setContext", FLUTTER_WIDGET_PREVIEW_SUPPORTED_CONTEXT, true);

		// If using the sidebar, set up the view immediately so it can be visible before running any
		// command.
		if (this.location === "sidebar")
			void this.setUpPreview();
	}

	private async setUpPreview(): Promise<void> {
		if (!this.setUpPreviewPromise)
			this.setUpPreviewPromise = this.setUpPreviewImpl();

		return this.setUpPreviewPromise;
	}

	private async setUpPreviewImpl(): Promise<void> {
		try {
			const completer = new PromiseCompleter<WebViewUrls>();
			const pageTitle = "Flutter Widget Preview";

			const view = this.view = this.location === "sidebar"
				? new WidgetPreviewSidebarView(() => this.showProgressIfRequired(), completer.promise)
				: new WidgetPreviewEmbeddedView(this.logger, completer.promise, pageTitle);
			view.onDispose(() => this.view = undefined);

			const dtdUri = await this.dtdUri;
			const previewUrls: WebViewUrls = {
				viewUrl: await this.server.previewUrl,
				authUrls: dtdUri ? [dtdUri] : undefined,
			};
			completer.resolve(await exposeWebViewUrls(previewUrls));
		} catch (e) {
			const message = `Failed to set up Widget Preview: ${e}`;
			this.logger.error(message);
			vs.window.showErrorMessage(message);
		}
	}

	public showProgressIfRequired() {
		// Ensure progress is shown if the server is not ready yet.
		if (!this.hasShownProgress) {
			this.hasShownProgress = true;
			vs.window.withProgress(
				{
					title: "Initializing Flutter Widget Preview…",
					location: vs.ProgressLocation.Notification,
					cancellable: false,
				},
				() => this.server.previewUrl,
			);
		}
	}

	public async showPreview(): Promise<void> {
		this.showProgressIfRequired();
		await this.setUpPreview();
		this.view?.show();
	}

	public dispose(): void {
		disposeAll(this.disposables);
	}
}

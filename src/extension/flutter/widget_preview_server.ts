import * as path from "path";
import { flutterPath } from "../../shared/constants";
import { LogCategory } from "../../shared/enums";
import { Logger } from "../../shared/interfaces";
import { CategoryLogger } from "../../shared/logging";
import { UnknownNotification } from "../../shared/services/interfaces";
import { StdIOService } from "../../shared/services/stdio_service";
import { PromiseCompleter } from "../../shared/utils";
import { config } from "../config";
import { getGlobalFlutterArgs, getToolEnv } from "../utils/processes";

export class FlutterWidgetPreviewServer extends StdIOService<UnknownNotification> {
	private readonly previewUrlCompleter = new PromiseCompleter<string>();
	public readonly previewUrl = this.previewUrlCompleter.promise;

	constructor(
		logger: Logger,
		readonly flutterSdkPath: string,
		readonly dtdUri: Promise<string | undefined> | undefined,
		readonly devToolsServerUri: Promise<string | undefined> | undefined,
		readonly tempWorkingDirectory: string,
	) {
		super(new CategoryLogger(logger, LogCategory.FlutterWidgetPreview), config.maxLogLineLength, true, true);

		void Promise.all([
			dtdUri ?? Promise.resolve(),
			devToolsServerUri ?? Promise.resolve(),
		]).then(() => this.start());
	}

	private async start(): Promise<void> {
		try {
			const flutterExecutable = path.join(this.flutterSdkPath, flutterPath);
			const args = getGlobalFlutterArgs();
			// If we add new flags here, we must use capabilities to ensure we only pass them
			// to SDKs that support them, since users may have the preview enabled on earlier
			// versions now.
			args.push("widget-preview", "start", "--machine", "--web-server");

			const dtdUri = await this.dtdUri;
			const devToolsServerUri = await this.devToolsServerUri;

			if (dtdUri)
				args.push("--dtd-url", dtdUri);
			if (devToolsServerUri)
				args.push("--devtools-server-address", devToolsServerUri);
			this.createProcess(this.tempWorkingDirectory, flutterExecutable, args, { toolEnv: getToolEnv() });
		} catch (e) {
			this.logger.error(`Failed to start Widget Preview server: ${e}`);
		}
	}

	protected shouldHandleMessage(message: string): boolean {
		return message.startsWith("[{") && message.endsWith("}]");
	}

	protected async handleNotification(evt: UnknownNotification): Promise<void> {
		switch (evt.event) {
			case "widget_preview.started":
				this.previewUrlCompleter.resolve(evt.params.url as string);
				break;
			case "widget_preview.initializing": {
				const pid = evt.params.pid as number | undefined;
				if (pid)
					this.additionalPidsToTerminate.push(pid);
				break;
			}
		}
	}

	protected handleExit(code: number | null, signal: NodeJS.Signals | null) {
		super.handleExit(code, signal);
		// If it never started up, we'll need to signal it's broken to anyone
		// waiting on this url.
		this.previewUrlCompleter.reject(`Widget Preview server process terminated`);
	}
}

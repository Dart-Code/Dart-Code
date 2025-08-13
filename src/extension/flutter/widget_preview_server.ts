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
		readonly logger: Logger,
		readonly flutterSdkPath: string,
		readonly dtdUri: string | undefined,
		readonly tempWorkingDirectory: string,
	) {
		super(new CategoryLogger(logger, LogCategory.FlutterWidgetPreview), config.maxLogLineLength, true, true);

		const flutterExecutable = path.join(this.flutterSdkPath, flutterPath);
		const args = getGlobalFlutterArgs();
		args.push("widget-preview", "start", "--machine", "--web-server");
		// TODO(dantup): Pass DTD + DevTools server
		// https://github.com/flutter/flutter/issues/173617
		// if (dtdUri)
		// 	args.push("--dtd-uri", dtdUri);
		// if (devToolsServerUri)
		// 	args.push("--devtools-server-address", devToolsServerUri);
		this.createProcess(tempWorkingDirectory, flutterExecutable, args, { toolEnv: getToolEnv() });
	}

	protected shouldHandleMessage(message: string): boolean {
		return message.startsWith("[{") && message.endsWith("}]");
	}

	protected async handleNotification(evt: UnknownNotification): Promise<void> {
		switch (evt.event) {
			case "widget_preview.started":
				this.previewUrlCompleter.resolve(evt.params.url as string);
				break;
		}
	}

	protected handleExit(code: number | null, signal: NodeJS.Signals | null) {
		super.handleExit(code, signal);
		// If it never started up, we'll need to signal it's broken to anyone
		// waiting on this url.
		this.previewUrlCompleter.reject(`Widget Preview server process terminated`);
	}
}

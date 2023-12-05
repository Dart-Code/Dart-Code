import { URI } from "vscode-uri";
import { IAmDisposable, Logger } from "../interfaces";
import { errorString } from "../utils";
import { VMEvent, VmServiceConnection } from "./dart_debug_protocol";

/**
 * A handler for functionality that currently requires the VM Service connection and is expected to work
 * in noDebug mode where the debug adapter does not connect the VM Service (and therefore does not
 * forward events).
 *
 * This class may ultimately become a Dart Tooling Daemon handler (connecting there instead of the VM
 * Service), and/or it may be removed if we return to connecting to the VM Service in noDebug modes.
 */
export class ToolEventHandler implements IAmDisposable {
	constructor(
		private readonly logger: Logger,
		private readonly devToolsLocation: string,
		private readonly jumpToLineColInUri: (uri: URI, line: number, col: number, inOtherEditorColumn: boolean) => void,
		private readonly cancelInspectWidget: () => void,
	) { }

	public isInspectingWidget = false;
	public autoCancelNextInspectWidgetMode = false;

	private connections: VmServiceConnection[] = [];

	public async connect(configuration: { [key: string]: any }, vmServiceUri: string): Promise<void> {
		// Currently we only handle navigate when in noDebug mode so we can avoid the connection for
		// debug runs.
		if (!configuration.noDebug)
			return;

		try {
			const connection = new VmServiceConnection(vmServiceUri);
			this.connections.push(connection);
			connection.onOpen(() => {
				connection.on("ToolEvent", (event: VMEvent) => {
					const data = event.extensionData;
					this.handle({ kind: event.extensionKind, data });
				}).catch((error) => {
					this.logger.info(errorString(error));
				});
			});
			connection.onError((error) => {
				this.logger.info(errorString(error));
			});
		} catch (error) {
			this.logger.info(errorString(error));
		}
	}

	public handle(body: any): boolean {
		const kind = body.kind;
		const data = body.data;
		switch (kind) {
			case "navigate":
				const uri: string | undefined = data.resolvedFileUri ?? data.resolvedUri ?? data.fileUri ?? data.uri ?? data.file;
				const lineString: string | number | undefined = data.line;
				const line = lineString ? typeof lineString === "string" ? parseInt(lineString) : lineString : undefined;
				const colString: string | number | undefined = data.column;
				const col = colString ? typeof colString === "string" ? parseInt(colString) : colString : undefined;
				const isFlutterInspectorNavigation = data.source === "flutter.inspector";
				if (uri && uri.startsWith("file://") && line && col) {
					// Only navigate if it's not from inspector, or is from inspector but we're not in full-width mode.
					const navigate = !isFlutterInspectorNavigation || this.devToolsLocation !== "active";
					if (navigate)
						this.jumpToLineColInUri(URI.parse(uri), line, col, true);
					if (isFlutterInspectorNavigation && this.isInspectingWidget && this.autoCancelNextInspectWidgetMode) {
						// Add a short delay because this will remove the visible selection.
						setTimeout(() => this.cancelInspectWidget(), 1000);
					}
				}
				return true;
			default:
				return false;
		}
	}

	public dispose(): any {
		for (const connection of this.connections) {
			try {
				connection.close();
			} catch (error) {
				this.logger.info(errorString(error));
			}
		}
		this.connections.length = 0;
	}
}

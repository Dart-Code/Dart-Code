import * as vs from "vscode";
import { SIDEBAR_AVAILABLE_PREFIX } from "../../../shared/constants.contexts";
import { Event, EventEmitter } from "../../../shared/events";
import { IAmDisposable } from "../../../shared/interfaces";
import { disposeAll } from "../../../shared/utils";
import { firstNonEditorColumn } from "../../../shared/vscode/utils";
import { perSessionWebviewStateKey } from "../../extension";

// TODO(dantup): Consider if we need to handle keydown/launchUrl/clipboard-write as in DevTools?
//  They would first need implementing in the widget preview to pass up via postMessage.

const pageScript = `
const vscode = acquireVsCodeApi();
const originalState = vscode.getState()?.${perSessionWebviewStateKey};
const originalFrameUrl = originalState?.frameUrl;

window.addEventListener('load', (event) => {
	// Restore previous frame if we had one.
	const widgetPreviewFrame = document.getElementById('widgetPreviewFrame');
	if (originalFrameUrl && (widgetPreviewFrame.src === "about:blank" || widgetPreviewFrame.src === "")) {
		console.log(\`Restoring Widget Preview frame \${originalFrameUrl}\`);
		widgetPreviewFrame.src = originalFrameUrl;
	}
});
`;

const scriptNonce = Buffer.from(pageScript).toString("base64");
const frameCss = "position: absolute; top: 0; left: 0; width: 100%; height: 100%";
const cssNonce = Buffer.from(frameCss).toString("base64");

function getPageHtmlSource(widgetPreviewUri: string): string {
	return `
		<html>
		<head>
		<meta http-equiv="Content-Security-Policy" content="default-src 'self' 'nonce-${scriptNonce}' 'nonce-${cssNonce}' http://${vs.Uri.parse(widgetPreviewUri).authority}; frame-src *;">
		<script nonce="${scriptNonce}">${pageScript}</script>
		<style nonce="${cssNonce}">#widgetPreviewFrame { ${frameCss} }</style>
		</head>
		<body><iframe id="widgetPreviewFrame" src="${widgetPreviewUri}" frameborder="0" allow="clipboard-read; clipboard-write; cross-origin-isolated"></iframe></body>
		</html>
	`;
}

export abstract class WidgetPreviewView implements IAmDisposable {
	private onDisposeEmitter: EventEmitter<void> = new EventEmitter<void>();
	public readonly onDispose: Event<void> = this.onDisposeEmitter.event;

	abstract show(): void;

	public dispose(): void {
		this.onDisposeEmitter.fire();
	}
}

export class WidgetPreviewEmbeddedView extends WidgetPreviewView {
	private readonly panel: vs.WebviewPanel;

	constructor(readonly widgetPreviewUri: string, readonly pageTitle: string) {
		super();

		const column = firstNonEditorColumn() ?? vs.ViewColumn.Beside;
		this.panel = vs.window.createWebviewPanel("dartWidgetPreview", pageTitle, column, {
			enableScripts: true,
			localResourceRoots: [],
			retainContextWhenHidden: true,
		});
		this.panel.onDidDispose(() => this.dispose(true));

		this.panel.webview.html = getPageHtmlSource(widgetPreviewUri);
	}

	public show(): void {
		this.panel.reveal();
	}

	public dispose(panelDisposed = false): void {
		if (!panelDisposed)
			this.panel.dispose();
		super.dispose();
	}
}

export class WidgetPreviewSidebarView extends WidgetPreviewView {
	protected readonly disposables: vs.Disposable[] = [];
	protected readonly webViewProvider: WidgetPreviewSidebarViewProvider;

	constructor(
		private readonly previewUrl: string,
	) {
		super();

		void vs.commands.executeCommand("setContext", `${SIDEBAR_AVAILABLE_PREFIX}widgetPreview`, true);
		this.webViewProvider = new WidgetPreviewSidebarViewProvider(this.previewUrl);
		this.disposables.push(this.webViewProvider);
		this.disposables.push(vs.window.registerWebviewViewProvider(`sidebarWidgetPreview`, this.webViewProvider, { webviewOptions: { retainContextWhenHidden: true } }));
	}

	public show(): void {
		void vs.commands.executeCommand(`sidebarWidgetPreview.focus`);
		this.webViewProvider.webviewView?.show(true);
	}

	public dispose(): void {
		disposeAll(this.disposables);
	}
}

class WidgetPreviewSidebarViewProvider implements vs.WebviewViewProvider {
	protected readonly disposables: vs.Disposable[] = [];
	public webviewView: vs.WebviewView | undefined;

	constructor(
		private readonly previewUrl: string
	) { }

	public async resolveWebviewView(webviewView: vs.WebviewView, _context: vs.WebviewViewResolveContext<unknown>, _token: vs.CancellationToken): Promise<void> {
		if (this.webviewView !== webviewView) {
			this.webviewView = webviewView;
		}

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [],
		};

		webviewView.webview.html = getPageHtmlSource(this.previewUrl);
	}

	public dispose(): void {
		disposeAll(this.disposables);
	}
}

import * as vs from "vscode";

export function showCode(editor: vs.TextEditor, displayRange: vs.Range, highlightRange: vs.Range, selectionRange?: vs.Range): void {
	if (selectionRange)
		editor.selection = new vs.Selection(selectionRange.start, selectionRange.end);

	// Ensure the code is visible on screen.
	editor.revealRange(displayRange, vs.TextEditorRevealType.InCenterIfOutsideViewport);

	// TODO: Implement highlighting
	// See https://github.com/Microsoft/vscode/issues/45059
}

class EnvUtils {
	public async openInBrowser(url: string): Promise<boolean> {
		return vs.env.openExternal(vs.Uri.parse(url));
	}

	public async asExternalUri(uri: vs.Uri): Promise<vs.Uri> {
		// TODO: Remove this scheme mapping when https://github.com/microsoft/vscode/issues/84819
		// is resolved.
		const scheme = uri.scheme;
		const fakeScheme = scheme === "ws" ? "http" : "https";
		const mappedUri = await vs.env.asExternalUri(uri.with({ scheme: fakeScheme }));
		return mappedUri.with({ scheme });
	}
}

export const envUtils = new EnvUtils();

import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { Logger } from "../../shared/interfaces";
import { mkDirRecursive } from "../../shared/utils/fs";
import { ColorRangeComputer } from "../../shared/vscode/color_range_computer";
import { isAnalyzable } from "../utils";

export class FlutterColorDecorations implements vs.Disposable {
	private readonly subscriptions: vs.Disposable[] = [];
	private readonly computer: ColorRangeComputer;
	private activeEditor?: vs.TextEditor;
	private updateTimeout?: NodeJS.Timeout;

	private readonly decorationTypes: { [key: string]: vs.TextEditorDecorationType } = {};

	constructor(private readonly logger: Logger, private readonly imageStoragePath: string) {
		this.computer = new ColorRangeComputer();
		this.subscriptions.push(vs.workspace.onDidChangeTextDocument((e) => {
			if (this.activeEditor && e.document === this.activeEditor.document) {
				// Delay this so if we're getting lots of updates we don't flicker.
				if (this.updateTimeout)
					clearTimeout(this.updateTimeout);
				this.updateTimeout = setTimeout(() => this.update(), 1000);
			}
		}));
		this.subscriptions.push(vs.window.onDidChangeActiveTextEditor((e) => {
			this.setTrackingFile(e);
			this.update();
		}));
		if (vs.window.activeTextEditor) {
			this.setTrackingFile(vs.window.activeTextEditor);
			this.update();
		}
	}

	private update() {
		if (!this.activeEditor)
			return;

		const results = this.computer.compute(this.activeEditor.document);

		// Each color needs to be its own decoration, so here we update our main list
		// with any new ones we hadn't previously created.
		for (const colorHex of Object.keys(results)) {
			const filePath = this.createImageFile(colorHex);
			if (filePath && !this.decorationTypes[colorHex])
				this.decorationTypes[colorHex] = vs.window.createTextEditorDecorationType({
					gutterIconPath: vs.Uri.file(filePath),
					gutterIconSize: "50%",
				});
		}

		for (const colorHex of Object.keys(this.decorationTypes)) {
			this.activeEditor.setDecorations(
				this.decorationTypes[colorHex],
				results[colorHex] || [],
			);
		}
	}

	private setTrackingFile(editor: vs.TextEditor) {
		if (editor && isAnalyzable(editor.document)) {
			this.activeEditor = editor;
		} else
			this.activeEditor = undefined;
	}

	private createImageFile(hex: string): string | undefined {
		// Add a version number to the folder in case we need to change these
		// and invalidate the old ones.
		const imageFolder = path.join(this.imageStoragePath, "v1");
		mkDirRecursive(imageFolder);
		const file = path.join(imageFolder, `${hex}.svg`);
		if (fs.existsSync(file))
			return file;

		try {
			const hex6 = hex.substr(2);
			const opacity = parseInt(hex.substr(0, 2), 16) / 255;
			const imageContents = svgContents
				.replace("{HEX-6}", hex6)
				.replace("{OPACITY}", opacity.toString());
			fs.writeFileSync(file, imageContents);
			return file;
		} catch (e) {
			this.logger.warn(e);
		}
	}

	public dispose() {
		this.activeEditor = undefined;
		this.subscriptions.forEach((s) => s.dispose());
	}
}

const svgContents = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
	<rect fill="#{HEX-6}" x="0" y="0" width="16" height="16" fill-opacity="{OPACITY}" />
</svg>
`;

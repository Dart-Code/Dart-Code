import { FlutterOutline } from "../../shared/analysis/lsp/custom_protocol";
import { Logger } from "../../shared/interfaces";
import { fsPath } from "../../shared/utils/fs";
import { IconRangeComputerLsp } from "../../shared/vscode/icon_range_computer";
import { LspAnalyzer } from "../analysis/analyzer_lsp";
import { FlutterIconDecorations } from "./flutter_icon_decorations";

export class FlutterIconDecorationsLsp extends FlutterIconDecorations {
	private readonly computer: IconRangeComputerLsp;
	constructor(logger: Logger, private readonly analyzer: LspAnalyzer) {
		super(logger);
		this.computer = new IconRangeComputerLsp(logger);

		this.subscriptions.push(this.analyzer.fileTracker.onFlutterOutline.listen(async (op) => {
			if (this.activeEditor && fsPath(this.activeEditor.document.uri) === fsPath(op.uri)) {
				this.update(op.outline);
			}
		}));
	}

	protected update(outline?: FlutterOutline) {
		if (!this.activeEditor)
			return;

		if (!outline)
			outline = this.analyzer.fileTracker.getFlutterOutlineFor(this.activeEditor.document.uri);

		if (!outline)
			return;

		const results = this.computer.compute(outline);

		this.render(results);
	}
}

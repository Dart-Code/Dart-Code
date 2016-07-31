"use strict";

import { HoverProvider, Hover, TextDocument, Position, CancellationToken } from "vscode";
import {Analyzer} from "./analyzer";
import * as as from "./analysis_server_types";

export class DartHoverProvider implements HoverProvider {
	private analyzer: Analyzer;
	constructor(analyzer: Analyzer) {
		this.analyzer = analyzer;
	}

	provideHover(document: TextDocument, position: Position, token: CancellationToken): Thenable<Hover> {
		return new Promise<Hover>((resolve, reject) => {
			this.analyzer.analysisGetHover({
				file: document.fileName,
				offset: document.offsetAt(position)
			}).then(resp => {
				if (resp.hovers.length == 0)
					resolve(null);
				else
					// TODO: Add Range (probably will reduce calls to the API as mouse moves?)
					resolve(new Hover(resp.hovers.map(this.getHoverData)));
			});
		});
	}

	private getHoverData(hover: as.HoverInformation): string {
		return (
			(hover.dartdoc != null ? hover.dartdoc + "\r\n" : "")
			+ hover.elementDescription
		).trim();
	}
}
"use strict";

import { HoverProvider, Hover, TextDocument, Position, CancellationToken, Range } from "vscode";
import { Analyzer } from "../analysis/analyzer";
import * as as from "../analysis/analysis_server_types";
import { logError } from "../utils";
import { vsCodeVersion } from "../config";

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
				if (resp.hovers.length == 0) {
					resolve(null);
				} else {
					let hover = resp.hovers[0];
					let data = this.getHoverData(hover);
					if (data) {
						let range = new Range(
							document.positionAt(hover.offset),
							document.positionAt(hover.offset + hover.length)
						);
						resolve(new Hover(
							[{ language: 'dart', value: data.displayString }, data.documentation || undefined],
							range
						));
					} else {
						resolve(null);
					}
				}
			}, e => { logError(e); reject(); });
		});
	}

	private getHoverData(hover: as.HoverInformation): any {
		if (!hover.elementDescription) return null;

		let elementDescription = hover.elementDescription;
		let elementKind = hover.elementKind;
		let dartdoc: string = hover.dartdoc;
		let containingClassDescription = hover.containingClassDescription;
		let propagatedType = hover.propagatedType;
		let callable = (elementKind == "function" || elementKind == "method");
		let field = (elementKind == "getter" || elementKind == "setter" || elementKind == "field");
		let containingLibraryName = hover.containingLibraryName;

		let displayString: string = "";
		if (containingClassDescription && callable) displayString += containingClassDescription + ".";
		if (containingClassDescription && field) displayString += containingClassDescription + " ";
		if (elementDescription) displayString += (hover.isDeprecated ? "(deprecated) " : "") + `${elementDescription}\n`;
		if (propagatedType) displayString += `propogated type: ${propagatedType.trim()}`;

		let documentation = DartHoverProvider.cleanDartdoc(dartdoc);
		if (containingLibraryName) documentation = `_${containingLibraryName}_\r\n\r\n` + (documentation != null ? documentation : "");

		return {
			displayString: displayString.trim(),
			documentation: documentation
		}
	}

	private static cleanDartdoc(doc: string): string {
		if (!doc)
			return null;

		// Clean up some dart.core dartdoc.
		let index = doc.indexOf("## Other resources");
		if (index != -1)
			doc = doc.substring(0, index);

		// Remove colons from old-style references like [:foo:].
		doc = doc.replace(/\[:\S+:\]/g, (match) => `[${match.substring(2, match.length - 2)}]`);

		// Change any links without hyperlinks to just code syntax.
		// That is, anything in [squares] that isn't a [link](http://blah).
		// Note: To ensure we get things at the end, we need to match "not a paren or end of string"
		// and we need to put that character back in since the regex consumed it.
		doc = doc.replace(/\[(\S+)\]([^(]|$)/g, (match, one, two) => `\`${one}\`${two}`);

		return doc;
	}
}

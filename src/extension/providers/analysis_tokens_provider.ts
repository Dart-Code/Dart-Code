import { CancellationToken, DocumentSemanticTokensProvider, SemanticTokens, SemanticTokensBuilder, SemanticTokensLegend, TextDocument, TextLine } from "vscode";
import { HighlightRegionType } from "../../shared/analysis_server_types";
import { MappedRegion, removeOverlappings } from "../../shared/utils/region_split";
import { DasAnalyzer } from "../analysis/analyzer_das";

const emptyBuffer = new Uint32Array();

export class AnalysisTokensProvider implements DocumentSemanticTokensProvider {

	constructor(private readonly analyzer: DasAnalyzer) { }

	public async provideDocumentSemanticTokens(document: TextDocument, token: CancellationToken): Promise<SemanticTokens> {
		const dasHightlights = await this.analyzer.fileTracker.awaitHighlights(document.uri, token);

		if (!dasHightlights) {
			// no data available, so don't report any tokens
			return new SemanticTokens(emptyBuffer);
		}

		// map to token types declared in the legend, filter out regions we're not
		// interested in (like directives or set literals. Those have child regions, we only
		// care about those).
		let mapped = dasHightlights.map<MappedRegion | undefined>((token) => {
			const type = this.mappedType(token.type);
			if (type === undefined) return undefined;

			return new MappedRegion(
				token.offset,
				token.length,
				type,
				this.modifierBitmask(token.type),
			);
		}).filter((r): r is MappedRegion => r !== undefined);

		// split at line endings and nested regions. We map first so that tokens we're not
		// insterested in (like set literals) don't cause many tokens when we split at nested
		// regions.
		mapped = splitRegions(mapped, document);

		const builder = new SemanticTokensBuilder();
		mapped.forEach((region) => {
			const start = document.positionAt(region.offset);
			builder.push(start.line, start.character, region.length, region.tokenType, region.tokenModifier);
		});

		return new SemanticTokens(builder.build());
	}

	private mappedType(regionType: HighlightRegionType): number | undefined {
		// mapping oriented on how the IntelliJ plugin handles highlighting:
		// https://github.com/JetBrains/intellij-plugins/blob/e280cb041505b0fb706d1ce852e3c1f38ffdf896/Dart/src/com/jetbrains/lang/dart/ide/annotator/DartAnnotator.java#L48-L143
		switch (regionType) {
			case "ANNOTATION":
				return Type.annotation;
			case "BUILT_IN":
			case "KEYWORD":
			case "LITERAL_BOOLEAN":
			case "TYPE_NAME_DYNAMIC":
				return Type.keyword;
			case "CLASS":
				return Type.class;
			case "ENUM":
				return Type.enum;
			case "TYPE_PARAMETER":
				return Type.parameterType;
			case "INSTANCE_METHOD_DECLARATION":
			case "INSTANCE_METHOD_REFERENCE":
			case "STATIC_METHOD_DECLARATION":
			case "STATIC_METHOD_REFERENCE":
			case "TOP_LEVEL_FUNCTION_DECLARATION":
			case "TOP_LEVEL_FUNCTION_REFERENCE":
			case "LOCAL_FUNCTION_DECLARATION":
			case "LOCAL_FUNCTION_REFERENCE":
			case "CONSTRUCTOR":
				return Type.function;
			case "DYNAMIC_PARAMETER_DECLARATION":
			case "DYNAMIC_PARAMETER_REFERENCE":
			case "PARAMETER_DECLARATION":
			case "PARAMETER_REFERENCE":
				return Type.parameter;
			case "COMMENT_BLOCK":
			case "COMMENT_END_OF_LINE":
			case "COMMENT_DOCUMENTATION":
				return Type.comment;
			case "DYNAMIC_TYPE":
			case "FUNCTION_TYPE_ALIAS":
				return Type.type;
			case "STATIC_FIELD_DECLARATION":
			case "STATIC_SETTER_DECLARATION":
			case "STATIC_SETTER_REFERENCE":
			case "STATIC_GETTER_DECLARATION":
			case "STATIC_GETTER_REFERENCE":
			case "INSTANCE_FIELD_DECLARATION":
			case "INSTANCE_FIELD_REFERENCE":
			case "INSTANCE_GETTER_DECLARATION":
			case "INSTANCE_SETTER_REFERENCE":
			case "TOP_LEVEL_GETTER_DECLARATION":
			case "TOP_LEVEL_GETTER_REFERENCE":
			case "TOP_LEVEL_SETTER_DECLARATION":
			case "TOP_LEVEL_SETTER_REFERENCE":
			case "ENUM_CONSTANT":
				return Type.property;
			case "TOP_LEVEL_VARIABLE_DECLARATION":
			case "LOCAL_VARIABLE_DECLARATION":
			case "LOCAL_VARIABLE_REFERENCE":
			case "DYNAMIC_LOCAL_VARIABLE_DECLARATION":
			case "DYNAMIC_LOCAL_VARIABLE_REFERENCE":
				return Type.variable;
			case "LABEL":
				return Type.label;
			case "LIBRARY_NAME":
				return Type.namespace;
			case "LITERAL_DOUBLE":
			case "LITERAL_INTEGER":
				return Type.number;
			case "LITERAL_STRING":
				return Type.string;
		}
	}

	private modifierBitmask(regionType: HighlightRegionType): number {
		// tslint:disable: no-bitwise
		let modifier = 0;
		if (AnalysisTokensProvider.staticRegionTypes.has(regionType)) {
			modifier |= 1 << Modifier.static;
		}
		if (AnalysisTokensProvider.declarationRegionTypes.has(regionType)) {
			modifier |= 1 << Modifier.declaration;
		}
		if (regionType === "COMMENT_DOCUMENTATION") {
			modifier |= 1 << Modifier.documentationComment;
		}
		// tslint:enable: no-bitwise
		return modifier;
	}

	private static staticRegionTypes: Set<HighlightRegionType> = new Set([
		"STATIC_GETTER_DECLARATION",
		"STATIC_SETTER_DECLARATION",
		"STATIC_FIELD_DECLARATION",
		"STATIC_METHOD_DECLARATION",
		"STATIC_GETTER_REFERENCE",
		"STATIC_SETTER_REFERENCE",
		"ENUM_CONSTANT",
	]);

	private static declarationRegionTypes: Set<HighlightRegionType> = new Set([
		"INSTANCE_FIELD_DECLARATION",
		"INSTANCE_GETTER_DECLARATION",
		"INSTANCE_METHOD_DECLARATION",
		"INSTANCE_SETTER_DECLARATION",
		"STATIC_FIELD_DECLARATION",
		"STATIC_GETTER_DECLARATION",
		"STATIC_METHOD_DECLARATION",
		"TOP_LEVEL_FUNCTION_DECLARATION",
		"TOP_LEVEL_VARIABLE_DECLARATION",
		"TOP_LEVEL_SETTER_DECLARATION",
		"TOP_LEVEL_GETTER_DECLARATION",
		"STATIC_METHOD_DECLARATION",
		"TOP_LEVEL_FUNCTION_DECLARATION",
		"DYNAMIC_LOCAL_VARIABLE_DECLARATION",
		"DYNAMIC_PARAMETER_DECLARATION",
		"PARAMETER_DECLARATION",
		"LOCAL_FUNCTION_DECLARATION",
		"LOCAL_VARIABLE_DECLARATION",
	]);
}

enum Modifier {
	// these are standardized by VS Code
	abstract,
	async,
	declaration,
	deprecated,
	documentation,
	member,
	modification,
	static,
	// Dart-specific additions.
	documentationComment,
}

enum Type {
	// these are standardized by VS Code
	comment,
	string,
	keyword,
	number,
	regexp,
	operator,
	namespace,
	type,
	struct,
	class,
	interface,
	enum,
	parameterType,
	function,
	macro,
	variable,
	constant,
	parameter,
	property,
	label,
	// Dart-specific additions
	annotation,
}

export const dasTokenLegend: SemanticTokensLegend = {
	tokenModifiers: Object.keys(Modifier).filter((k) => typeof Modifier[k as any] === "number"),
	tokenTypes: Object.keys(Type).filter((k) => typeof Type[k as any] === "number"),
};

/**
 * Transforms mapped highlight regions into something than be sent to VS Code for highlighting.
 * In particular, this includes
 *  - sorting tokens by their start positions, so that they can be encoded by deltas
 *  - splitting multi-line tokens at each covered line ending
 *  - flattening nested regions
 *
 * @param regions unsorted regions reported by the analyzer
 * @param document the matching document providing line endings
 */
function splitRegions(regions: MappedRegion[], document: TextDocument): MappedRegion[] {
	regions = removeOverlappings(regions); // will also take care of sorting them

	function startOf(line: TextLine): number {
		return document.offsetAt(line.range.start);
	}

	function endOf(line: TextLine): number {
		return document.offsetAt(line.range.end);
	}

	const output = Array<MappedRegion>();
	regions.forEach((region) => {
		const startLine = document.positionAt(region.offset).line;
		const endLine = document.positionAt(region.endOffset - 1).line;

		if (startLine === endLine) {
			output.push(region); // nothing to transform
		} else {
			// add the part of the first line that belongs to the region
			output.push(region.copyWithRange(region.offset, endOf(document.lineAt(startLine))));

			// lines in between can just be added in entirely
			for (let line = startLine + 1; line < endLine; line++) {
				const textLine = document.lineAt(line);
				output.push(region.copyWithRange(startOf(textLine), endOf(textLine)));
			}

			// add the part of the last line that belongs to the region
			output.push(region.copyWithRange(startOf(document.lineAt(endLine)), region.endOffset));
		}
	});
	return output;
}

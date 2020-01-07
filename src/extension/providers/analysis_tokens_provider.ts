import { CancellationToken, SemanticTokens, SemanticTokensBuilder, SemanticTokensLegend, SemanticTokensProvider, SemanticTokensRequestOptions, TextDocument } from "vscode";
import { HighlightRegion, HighlightRegionType } from "../../shared/analysis_server_types";
import { DasAnalyzer } from "../analysis/analyzer_das";

const emptyBuffer = new Uint32Array();

export class AnalysisTokensProvider implements SemanticTokensProvider {

	constructor(private readonly analyzer: DasAnalyzer) { }

	public async provideSemanticTokens(document: TextDocument, options: SemanticTokensRequestOptions, token: CancellationToken): Promise<SemanticTokens> {
		let dasHightlights: HighlightRegion[] | undefined;

		for (let i = 0; i < 5; i++) {
			dasHightlights = this.analyzer.fileTracker.getHighlightsFor(document.uri);
			if (dasHightlights) break;

			await new Promise((resolve) => setTimeout(resolve, (i + 1) * 1000).unref());
			if (token?.isCancellationRequested ?? false) break;
		}

		if (!dasHightlights) {
			// no data available, so don't report any tokens
			return new SemanticTokens(emptyBuffer);
		}

		// tokens must be sorted because VS Code encodes positions with deltas
		dasHightlights.sort((a, b) => a.offset - b.offset);

		const builder = new SemanticTokensBuilder();
		dasHightlights.forEach((token) => {
			const type = this.mappedType(token.type);
			if (type === undefined) return;

			const location = document.positionAt(token.offset);
			builder.push(location.line, location.character, token.length, type, 0);
		});

		return new SemanticTokens(builder.build());
	}

	private mappedType(regionType: HighlightRegionType): number| undefined {
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

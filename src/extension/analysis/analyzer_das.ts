import * as vs from "vscode";
import { LogCategory } from "../../shared/enums";
import { Logger } from "../../shared/interfaces";

export function getSymbolKindForElementKind(logger: Logger, kind: ElementKind | string): vs.SymbolKind {
	switch (kind) {
		case "CLASS":
		case "CLASS_TYPE_ALIAS":
		case "MIXIN":
			return vs.SymbolKind.Class;
		case "COMPILATION_UNIT":
		case "EXTENSION":
			return vs.SymbolKind.Module;
		case "CONSTRUCTOR":
		case "CONSTRUCTOR_INVOCATION":
			return vs.SymbolKind.Constructor;
		case "ENUM":
			return vs.SymbolKind.Enum;
		case "ENUM_CONSTANT":
			return vs.SymbolKind.EnumMember;
		case "FIELD":
			return vs.SymbolKind.Field;
		case "FILE":
			return vs.SymbolKind.File;
		case "FUNCTION":
		case "FUNCTION_INVOCATION":
		case "FUNCTION_TYPE_ALIAS":
			return vs.SymbolKind.Function;
		case "GETTER":
			return vs.SymbolKind.Property;
		case "LABEL":
			return vs.SymbolKind.Module;
		case "LIBRARY":
			return vs.SymbolKind.Namespace;
		case "LOCAL_VARIABLE":
			return vs.SymbolKind.Variable;
		case "METHOD":
			return vs.SymbolKind.Method;
		case "PARAMETER":
		case "PREFIX":
			return vs.SymbolKind.Variable;
		case "SETTER":
			return vs.SymbolKind.Property;
		case "TOP_LEVEL_VARIABLE":
		case "TYPE_PARAMETER":
			return vs.SymbolKind.Variable;
		case "UNIT_TEST_GROUP":
			return vs.SymbolKind.Module;
		case "UNIT_TEST_TEST":
			return vs.SymbolKind.Method;
		case "UNKNOWN":
			return vs.SymbolKind.Object;
		default:
			logger.error(`Unknown kind: ${kind}`, LogCategory.Analyzer);
			return vs.SymbolKind.Object;
	}
}

/**
 * An enumeration of the kinds of elements.
 */
export type ElementKind =
	"CLASS"
	| "CLASS_TYPE_ALIAS"
	| "COMPILATION_UNIT"
	| "CONSTRUCTOR"
	| "CONSTRUCTOR_INVOCATION"
	| "ENUM"
	| "ENUM_CONSTANT"
	| "EXTENSION"
	| "FIELD"
	| "FILE"
	| "FUNCTION"
	| "FUNCTION_INVOCATION"
	| "FUNCTION_TYPE_ALIAS"
	| "GETTER"
	| "LABEL"
	| "LIBRARY"
	| "LOCAL_VARIABLE"
	| "METHOD"
	| "MIXIN"
	| "PARAMETER"
	| "PREFIX"
	| "SETTER"
	| "TOP_LEVEL_VARIABLE"
	| "TYPE_ALIAS"
	| "TYPE_PARAMETER"
	| "UNIT_TEST_GROUP"
	| "UNIT_TEST_TEST"
	| "UNKNOWN";

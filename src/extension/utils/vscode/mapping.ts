import * as path from "path";
import { CompletionItemKind } from "vscode";
import * as as from "../../analysis/analysis_server_types";

export function getSuggestionKind(kind: as.CompletionSuggestionKind, label: string): CompletionItemKind {
	switch (kind) {
		case "ARGUMENT_LIST":
			return CompletionItemKind.Variable;
		case "IMPORT":
			return label.startsWith("dart:")
				? CompletionItemKind.Module
				: path.extname(label.toLowerCase()) === ".dart"
					? CompletionItemKind.File
					: CompletionItemKind.Folder;
		case "IDENTIFIER":
			return CompletionItemKind.Variable;
		case "INVOCATION":
			return CompletionItemKind.Method;
		case "KEYWORD":
			return CompletionItemKind.Keyword;
		case "NAMED_ARGUMENT":
			return CompletionItemKind.Variable;
		case "OPTIONAL_ARGUMENT":
			return CompletionItemKind.Variable;
		case "PARAMETER":
			return CompletionItemKind.Value;
	}
}

export function getElementKind(kind: as.ElementKind): CompletionItemKind {
	switch (kind) {
		case "CLASS":
		case "CLASS_TYPE_ALIAS":
			return CompletionItemKind.Class;
		case "COMPILATION_UNIT":
			return CompletionItemKind.Module;
		case "CONSTRUCTOR":
		case "CONSTRUCTOR_INVOCATION":
			return CompletionItemKind.Constructor;
		case "ENUM":
			return CompletionItemKind.Enum;
		case "ENUM_CONSTANT":
			return CompletionItemKind.EnumMember;
		case "FIELD":
			return CompletionItemKind.Field;
		case "FILE":
			return CompletionItemKind.File;
		case "FUNCTION":
		case "FUNCTION_TYPE_ALIAS":
			return CompletionItemKind.Function;
		case "GETTER":
			return CompletionItemKind.Property;
		case "LABEL":
		case "LIBRARY":
			return CompletionItemKind.Module;
		case "LOCAL_VARIABLE":
			return CompletionItemKind.Variable;
		case "METHOD":
			return CompletionItemKind.Method;
		case "PARAMETER":
		case "PREFIX":
			return CompletionItemKind.Variable;
		case "SETTER":
			return CompletionItemKind.Property;
		case "TOP_LEVEL_VARIABLE":
		case "TYPE_PARAMETER":
			return CompletionItemKind.Variable;
		case "UNIT_TEST_GROUP":
			return CompletionItemKind.Module;
		case "UNIT_TEST_TEST":
			return CompletionItemKind.Method;
		case "UNKNOWN":
			return CompletionItemKind.Value;
	}
}

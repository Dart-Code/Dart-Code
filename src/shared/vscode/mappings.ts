import * as vs from "vscode";

const iconsForKind: { [key in vs.SymbolKind]: string } = {
	[vs.SymbolKind.Array]: "indexer",
	[vs.SymbolKind.Boolean]: "boolean",
	[vs.SymbolKind.Class]: "class",
	[vs.SymbolKind.Constant]: "constant",
	[vs.SymbolKind.Constructor]: "method",
	[vs.SymbolKind.Enum]: "enumerator",
	[vs.SymbolKind.EnumMember]: "enumerator-item",
	[vs.SymbolKind.Event]: "event",
	[vs.SymbolKind.Field]: "field",
	[vs.SymbolKind.File]: "file",
	[vs.SymbolKind.Function]: "method",
	[vs.SymbolKind.Interface]: "interface",
	[vs.SymbolKind.Key]: "string",
	[vs.SymbolKind.Method]: "method",
	[vs.SymbolKind.Module]: "namespace",
	[vs.SymbolKind.Namespace]: "namespace",
	[vs.SymbolKind.Null]: "boolean", // 🤷‍♂️ https://github.com/microsoft/vscode/blob/a6ee65e647e6eeb1b6926d4100276e7afff14510/src/vs/editor/contrib/documentSymbols/media/symbol-icons.css#L107
	[vs.SymbolKind.Number]: "numeric",
	[vs.SymbolKind.Object]: "namespace",
	[vs.SymbolKind.Operator]: "operator",
	[vs.SymbolKind.Package]: "namespace",
	[vs.SymbolKind.Property]: "property",
	[vs.SymbolKind.String]: "string",
	[vs.SymbolKind.Struct]: "structure",
	[vs.SymbolKind.TypeParameter]: "type-parameter",
	[vs.SymbolKind.Variable]: "variable",
};

export function getIconForSymbolKind(kind: vs.SymbolKind): string {
	return iconsForKind[kind] || "field";
}

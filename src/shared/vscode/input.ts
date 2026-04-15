import * as vs from "vscode";

export type UserInputOrSettings = { value: string } | "SETTINGS";
export type PickableSetting = vs.QuickPickItem & ({
	settingKind: "STRING" | "ENUM" | "BOOL",
	currentValue: any,
	setValue: (newValue: any) => Promise<void>,
	enumValues?: string[],
} | {
	settingKind: "MULTI_ENUM",
	currentValue: any[],
	setValue: (newValue: any[]) => Promise<void>,
	enumValues: Array<{ group?: string, values: string[] }>,
});

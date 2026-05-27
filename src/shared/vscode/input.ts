import * as vs from "vscode";

export type UserInputOrSettings = { value: string } | "SETTINGS";

interface DoNotAskOption {
	doNotAskNextTimeOption?: {
		currentValue: boolean,
		inverted?: boolean,
		setValue: (newValue: boolean | undefined) => Promise<void>,
	},
}

export type PickableSetting = vs.QuickPickItem & DoNotAskOption & ({
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

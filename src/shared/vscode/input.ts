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
	settingKind: "STRING" | "ENUM",
	currentValue: string,
	setValue(newValue: string | undefined): Promise<void>,
	enumValues?: string[],
} | {
	settingKind: "BOOL",
	currentValue: string,
	setValue(newValue: boolean | undefined): Promise<void>,
	enumValues?: string[],
} | {
	settingKind: "MULTI_ENUM",
	currentValue: string[],
	setValue(newValue: string[]): Promise<void>,
	enumValues: string[],
});

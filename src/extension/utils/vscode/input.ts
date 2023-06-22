import * as vs from "vscode";
import { Context } from "../../../shared/vscode/workspace";

export async function showInputBoxWithSettings(
	context: Context,
	options: {
		ignoreFocusOut: boolean,
		title: string,
		prompt: string,
		placeholder: string,
		value: string,
		validation: (s: string) => string | undefined,
	},
): Promise<UserInputOrSettings | undefined> {
	const input = vs.window.createInputBox();
	input.ignoreFocusOut = options.ignoreFocusOut;
	input.title = options.title;
	input.prompt = options.prompt;
	input.placeholder = options.placeholder;
	input.value = options.value;
	if (options.validation) {
		input.onDidChangeValue((s) => {
			input.validationMessage = options.validation(s);
		});
	}
	input.buttons = [
		{
			iconPath: {
				dark: vs.Uri.file(context.asAbsolutePath("media/commands/settings.svg")),
				light: vs.Uri.file(context.asAbsolutePath("media/commands/settings.svg")),
			},
			tooltip: "Settings",
		},
	];

	const name = await new Promise<UserInputOrSettings | undefined>((resolve) => {
		input.onDidTriggerButton(async (e) => {
			resolve("SETTINGS");
			input.hide();
		});

		input.onDidAccept(() => {
			// Don't accept while there's a validation error.
			if (input.validationMessage)
				return;
			input.value ? resolve({ value: input.value }) : resolve(undefined);
		});
		input.onDidHide(() => {
			resolve(undefined);
		});
		input.show();
	});

	input.dispose();

	return name;
}


export async function showSimpleSettingsEditor(title: string, placeholder: string, getItems: () => PickableSetting[]): Promise<void> {
	while (true) {
		const quickPick = vs.window.createQuickPick<PickableSetting>();
		quickPick.title = title;
		quickPick.placeholder = placeholder;
		quickPick.items = getItems();

		const selectedSetting = await new Promise<PickableSetting | undefined>((resolve) => {
			quickPick.onDidAccept(() => resolve(quickPick.selectedItems && quickPick.selectedItems[0]));
			quickPick.onDidHide(() => resolve(undefined));
			quickPick.show();
		});

		quickPick.dispose();

		if (selectedSetting) {
			await editSetting(selectedSetting);
		} else {
			return;
		}
	}
}

export async function editSetting(setting: PickableSetting) {
	const title = setting.label;
	let placeholder = `Select an option for ${setting.label} (or 'Escape' to cancel)`;
	const prompt = setting.detail;
	const value = setting.currentValue;
	switch (setting.settingKind) {
		case "STRING":
			const stringResult = await vs.window.showInputBox({ prompt, title, value });
			if (stringResult !== undefined)
				await setting.setValue(stringResult);
			break;
		case "ENUM": {
			const quickPick = vs.window.createQuickPick();
			quickPick.placeholder = placeholder;
			quickPick.title = title;
			quickPick.items = setting.enumValues!.map((v) => ({ label: v } as vs.QuickPickItem));
			quickPick.activeItems = quickPick.items.filter((item) => item.label === setting.currentValue);

			const accepted = await new Promise<boolean>((resolve) => {
				quickPick.onDidAccept(() => resolve(true));
				quickPick.onDidHide(() => resolve(false));
				quickPick.show();
			});
			const enumResult = accepted && quickPick.activeItems.length ? quickPick.activeItems[0].label : undefined;
			quickPick.dispose();

			if (enumResult !== undefined)
				await setting.setValue(enumResult);
			break;
		}
		case "MULTI_ENUM": {
			placeholder = `Select options for ${setting.label} (or 'Escape' to cancel)`;
			const quickPick = vs.window.createQuickPick();
			quickPick.canSelectMany = true;
			quickPick.placeholder = placeholder;
			quickPick.title = title;
			const items: vs.QuickPickItem[] = [];
			for (const group of setting.enumValues) {
				items.push({ label: group.group, kind: vs.QuickPickItemKind.Separator } as vs.QuickPickItem);
				for (const value of group.values) {
					items.push({ label: value } as vs.QuickPickItem);
				}
			}
			quickPick.items = items;
			quickPick.selectedItems = quickPick.items.filter((item) => setting.currentValue.find((current) => current === item.label));

			const accepted = await new Promise<boolean>((resolve) => {
				quickPick.onDidAccept(() => resolve(true));
				quickPick.onDidHide(() => resolve(false));
				quickPick.show();
			});
			quickPick.dispose();

			if (accepted)
				await setting.setValue(quickPick.selectedItems.map((item) => item.label));
			break;
		}
		case "BOOL":
			const boolResult = await vs.window.showQuickPick(
				[
					{ label: "enable" } as vs.QuickPickItem,
					{ label: "disable" } as vs.QuickPickItem,
				],
				{ placeHolder: placeholder, title },
			);
			if (boolResult !== undefined)
				await setting.setValue(boolResult.label === "enable");
			break;
	}
}

type UserInputOrSettings = { value: string } | "SETTINGS";
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

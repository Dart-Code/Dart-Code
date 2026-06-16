import * as vs from "vscode";
import { PickableSetting, UserInputOrSettings } from "../../../shared/vscode/input";
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
		input.onDidTriggerButton(async () => {
			resolve("SETTINGS");
			input.hide();
		});

		input.onDidAccept(() => {
			// Don't accept while there's a validation error.
			if (input.validationMessage)
				return;
			if (input.value)
				resolve({ value: input.value });
			else
				resolve(undefined);
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
			quickPick.onDidAccept(() => resolve(quickPick.selectedItems?.[0]));
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

export async function editSetting(setting: PickableSetting, showDoNotAskNextTime = false): Promise<boolean> {
	const title = setting.label;
	let placeholder = `Select an option for ${setting.label} (or 'Escape' to cancel)`;
	const prompt = setting.detail;
	// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
	const value = setting.currentValue;
	switch (setting.settingKind) {
		case "STRING": {
			const stringResult = await vs.window.showInputBox({ prompt, title, value: value as string | undefined });
			const accepted = stringResult !== undefined;
			if (accepted)
				await setting.setValue(stringResult);
			return accepted;
		}
		case "ENUM": {
			const quickPick = vs.window.createQuickPick();
			quickPick.placeholder = placeholder;
			quickPick.title = title;
			quickPick.items = setting.enumValues!.map((v) => ({ label: v } satisfies vs.QuickPickItem));
			quickPick.activeItems = quickPick.items.filter((item) => item.label === setting.currentValue);

			const accepted = await new Promise<boolean>((resolve) => {
				quickPick.onDidAccept(() => resolve(true));
				quickPick.onDidHide(() => resolve(false));
				quickPick.show();
			});
			const enumResult = accepted && quickPick.activeItems.length ? quickPick.activeItems[0].label : undefined;

			if (enumResult !== undefined)
				await setting.setValue(enumResult);

			quickPick.dispose();
			return accepted;
		}
		case "MULTI_ENUM": {
			placeholder = `Select ${setting.label} (or 'Escape' to cancel)`;
			const quickPick = vs.window.createQuickPick<vs.QuickPickItem & { isDoNotAskNextTime?: boolean }>();
			const doNotAskOption = showDoNotAskNextTime ? setting.doNotAskNextTimeOption : undefined;
			const doNotAskOptionChecked = doNotAskOption && (doNotAskOption.inverted ? !doNotAskOption.currentValue : doNotAskOption.currentValue);
			quickPick.canSelectMany = true;
			quickPick.placeholder = placeholder;
			quickPick.title = title;
			const items: Array<vs.QuickPickItem & { isDoNotAskNextTime?: boolean }> = [];
			for (const value of setting.enumValues) {
				items.push({ label: value } satisfies vs.QuickPickItem);
			}
			if (doNotAskOption) {
				items.push({ kind: vs.QuickPickItemKind.Separator, label: "" });
				items.push({ label: "Don't ask next time", isDoNotAskNextTime: true, });
			}
			quickPick.items = items;
			quickPick.selectedItems = items.filter((item) => setting.currentValue.includes(item.label) || (doNotAskOptionChecked && item.isDoNotAskNextTime));

			const accepted = await new Promise<boolean>((resolve) => {
				quickPick.onDidAccept(() => resolve(true));
				quickPick.onDidHide(() => resolve(false));
				quickPick.show();
			});

			if (accepted) {
				if (doNotAskOption) {
					const doNotAskOptionSelected = quickPick.selectedItems.some((item) => item.isDoNotAskNextTime);
					const doNotAskConfigValue = doNotAskOption.inverted ? !doNotAskOptionSelected : doNotAskOptionSelected;
					await doNotAskOption.setValue(doNotAskConfigValue);
				}
				await setting.setValue(quickPick.selectedItems.filter((item) => !item.isDoNotAskNextTime).map((item) => item.label));
			}

			quickPick.dispose();
			return accepted;
		}
		case "BOOL": {
			const boolResult = await vs.window.showQuickPick(
				[
					{ label: "enable" } satisfies vs.QuickPickItem,
					{ label: "disable" } satisfies vs.QuickPickItem,
				],
				{ placeHolder: placeholder, title },
			);
			const accepted = boolResult !== undefined;
			if (accepted)
				await setting.setValue(boolResult.label === "enable");
			return accepted;
		}
	}
}

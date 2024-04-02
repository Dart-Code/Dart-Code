import * as vs from "vscode";

const statusBars: { [key: string]: vs.LanguageStatusItem } = {};

export function getLanguageStatusItem(id: string, selector: vs.DocumentSelector): Omit<vs.LanguageStatusItem, "dispose"> {
	return statusBars[id] ?? (statusBars[id] = vs.languages.createLanguageStatusItem(id, selector));
}

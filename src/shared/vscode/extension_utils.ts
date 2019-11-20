import * as fs from "fs";
import * as path from "path";
import { extensions, Uri } from "vscode";
import { dartCodeExtensionIdentifier, flutterExtensionIdentifier } from "../constants";
import * as dartdoc from "../utils/dartdocs";

export const extensionPath = extensions.getExtension(dartCodeExtensionIdentifier)!.extensionPath;
export const extensionVersion = getExtensionVersion();
export const vsCodeVersionConstraint = getVsCodeVersionConstraint();
export const isDevExtension = checkIsDevExtension();
export const hasFlutterExtension = checkHasFlutterExtension();
export const docsIconPathFormat = Uri.file(path.join(extensionPath, "media/doc-icons/material/")).toString() + "$1%402x.png";

export function readJson(file: string) {
	return JSON.parse(fs.readFileSync(file).toString());
}

function getExtensionVersion(): string {
	const packageJson = readJson(path.join(extensionPath, "package.json"));
	return packageJson.version;
}

function getVsCodeVersionConstraint(): string {
	const packageJson = readJson(path.join(extensionPath, "package.json"));
	return packageJson.engines.vscode;
}

function checkIsDevExtension() {
	return extensionVersion.endsWith("-dev");
}

export function checkHasFlutterExtension() {
	return extensions.getExtension(flutterExtensionIdentifier) !== undefined;
}

export function cleanDartdoc(doc: string | undefined) {
	return dartdoc.cleanDartdoc(doc, docsIconPathFormat);
}

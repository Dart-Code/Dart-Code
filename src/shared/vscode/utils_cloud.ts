import * as vs from "vscode";

export const isTheia = vs.env.appName?.includes("Theia") ?? false;
export const isCloudShell = vs.env.appName?.includes("Cloud Shell") ?? false;
export const isKnownCloudIde = isTheia || isCloudShell;

export const cloudShellDefaultFlutterRunAdditionalArgs = ["--web-hostname", "any", "--disable-dds"];

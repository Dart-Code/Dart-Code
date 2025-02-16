import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { flutterPath } from "../../shared/constants";
import { Logger, Sdks } from "../../shared/interfaces";
import { getRandomInt, tryDeleteFile } from "../../shared/utils/fs";
import { FlutterSampleSnippet } from "../../shared/vscode/interfaces";
import { runToolProcess } from "../utils/processes";

export async function getFlutterSnippets(logger: Logger, sdks: Sdks): Promise<FlutterSampleSnippet[]> {
	if (!sdks.flutter)
		throw new Error("Flutter SDK not available");

	const binPath = path.join(sdks.flutter, flutterPath);

	const fileName = `flutter-samples-${getRandomInt(0x1000, 0x10000).toString(16)}.txt`;
	const tempPath = path.join(os.tmpdir(), fileName);

	try {
		const res = await runToolProcess(logger, undefined, binPath, ["create", "--list-samples", tempPath]);
		if (res.exitCode !== 0)
			throw new Error(`Failed to get Flutter samples from SDK (${res.exitCode})\n\n${res.stderr}\n\n${res.stdout}`);

		const json = fs.readFileSync(tempPath, { encoding: "utf8" });

		return JSON.parse(json);
	} finally {
		tryDeleteFile(tempPath);
	}
}

import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as vs from "vscode";
import { activate, doc, getPositionOf, setTestContent, editor, ensureTestContent, delay, waitFor } from "../../helpers";

describe("organize directives", () => {

	before(() => activate());

	it("sorts imports", async () => {
		await setTestContent(`
import "dart:collection";
import "dart:async";

main() async {
  await new Future.delayed(const Duration(seconds: 1));
  HashSet hash = new HashSet();
}
		`);

		const oldVersion = doc.version;
		await vs.commands.executeCommand("dart.organizeDirectives");

		// Wait a while since text editor commands are fire-and-forget
		await waitFor(() => doc.version !== oldVersion, 500);

		await ensureTestContent(`
import "dart:async";
import "dart:collection";

main() async {
  await new Future.delayed(const Duration(seconds: 1));
  HashSet hash = new HashSet();
}
		`);
	});

	it("removes unused imports", async () => {
		await setTestContent(`
import "dart:collection";
import "dart:async";

main() async {
  await new Future.delayed(const Duration(seconds: 1));
}
		`);

		const oldVersion = doc.version;
		await vs.commands.executeCommand("dart.organizeDirectives");

		// Wait a while since text editor commands are fire-and-forget
		await waitFor(() => doc.version !== oldVersion, 500);

		ensureTestContent(`
import "dart:async";

main() async {
  await new Future.delayed(const Duration(seconds: 1));
}
		`);
	});
});

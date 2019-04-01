import * as vs from "vscode";
import { activate, ensureTestContent, setTestContent, waitForEditorChange } from "../../helpers";

describe("organize imports", () => {

	beforeEach("activate", () => activate());

	it("sorts imports", async () => {
		await setTestContent(`
import "dart:collection";
import "dart:async";

main() async {
  await new Future.delayed(const Duration(seconds: 1));
  HashSet hash = new HashSet();
}
		`);

		await waitForEditorChange(() => vs.commands.executeCommand("_dart.organizeImports"));

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

		await waitForEditorChange(() => vs.commands.executeCommand("_dart.organizeImports"));

		await ensureTestContent(`
import "dart:async";

main() async {
  await new Future.delayed(const Duration(seconds: 1));
}
		`);
	});
});

import { activate, ensureTestContent, executeOrganizeImportsCodeAction, setTestContent } from "../../helpers";

describe("organize imports", () => {
	beforeEach("activate", function () {
		if (process.env.BUILD_VERSION === "beta" && new Date().getFullYear() === 2023) {
			// Temporary skip while until this issue is fixed/explained.
			// https://github.com/microsoft/vscode/issues/199548
			this.skip();
		}
	});
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

		await executeOrganizeImportsCodeAction();

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

		await executeOrganizeImportsCodeAction();

		await ensureTestContent(`
import "dart:async";

main() async {
  await new Future.delayed(const Duration(seconds: 1));
}
		`);
	});
});

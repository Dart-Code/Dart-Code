import { activate, ensureTestContent, executeSortMembersCodeAction, setTestContent } from "../../helpers";

describe("sort members", () => {
	beforeEach("activate", function () {
		if (process.env.BUILD_VERSION === "beta" && new Date().getFullYear() === 2023) {
			// Temporary skip while until this issue is fixed/explained.
			// https://github.com/microsoft/vscode/issues/199548
			this.skip();
		}
	});
	beforeEach("activate", () => activate());

	it("sorts members", async () => {
		await setTestContent(`
int b;
int a;
class Person {
  int b;
  int a;
  bb() {}
  aa() {}
}
dd() {}
cc() {}
		`);

		await executeSortMembersCodeAction();

		// b&a inside the class seem sorted the wrong way?
		// https://github.com/dart-lang/sdk/issues/32683
		await ensureTestContent(`
int a;
int b;
cc() {}
dd() {}
class Person {
  int b;
  int a;
  aa() {}
  bb() {}
}
		`);
	});
});

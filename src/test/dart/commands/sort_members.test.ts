import { activate, ensureTestContent, executeSortMembersCodeAction, setTestContent } from "../../helpers";

describe("sort members", () => {

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

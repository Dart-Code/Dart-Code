import "package:test/test.dart";

// This comment is extracted by the test and compared to a text representation
// built from the tree provider in the test. It must be maintained to match
// the results from teh tests below.
// == EXPECTED RESULTS ==
// test/tree_test.dart (fail.svg)
//     failing group 1 (fail.svg)
//         group 1.1 (pass.svg)
//             passing test 1 (pass.svg)
//         passing test 1 (pass.svg)
//         failing test 1 (fail.svg)
//         skipped test 1 (skip.svg)
//     skipped group 2 (fail.svg)
//         skipped group 2.1 (skip.svg)
//             passing test 1 (skip.svg)
//             failing test 1 (skip.svg)
//             skipped test 1 (skip.svg)
//         passing test 1 (pass.svg)
//         failing test 1 (fail.svg)
//         skipped test 1 (skip.svg)
//     passing group 3 (pass.svg)
//         passing test 1 (pass.svg)
// == /EXPECTED RESULTS ==

void main() {
  group("failing group 1", () {
    test("passing test 1", () => expect(1, equals(1)));
    test("failing test 1", () => expect(1, equals(2)));
    test("skipped test 1", () {}, skip: true);
    group("group 1.1", () {
      test("passing test 1", () => expect(1, equals(1)));
    });
  });
  group("skipped group 2", () {
    test("passing test 1", () => expect(1, equals(1)));
    test("failing test 1", () => expect(1, equals(2)));
    test("skipped test 1", () {}, skip: true);
    group("skipped group 2.1", () {
      test("passing test 1", () => expect(1, equals(1)));
      test("failing test 1", () => expect(1, equals(2)));
      test("skipped test 1", () {}, skip: true);
    }, skip: true);
  });
  group("passing group 3", () {
    test("passing test 1", () => expect(1, equals(1)));
  });
}

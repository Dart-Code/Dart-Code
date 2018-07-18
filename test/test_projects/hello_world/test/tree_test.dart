import "package:test/test.dart";

// This comment is extracted by the test and compared to a text representation
// built from the tree provider in the test. It must be maintained to match
// the results from teh tests below.
// == EXPECTED RESULTS ==
// tree_test.dart (Failed)
//     failing group 1 (Failed)
//         failing group 1 group 1.1 (Passed)
//             failing group 1 group 1.1 passing test 1 (Passed)
//         failing group 1 passing test 1 (Passed)
//         failing group 1 failing test 1 (Failed)
//         failing group 1 skipped test 1 (Skipped)
//     skipped group 2 (Failed)
//         skipped group 2 skipped group 2.1 (Skipped)
//             skipped group 2 skipped group 2.1 passing test 1 (Skipped)
//             skipped group 2 skipped group 2.1 failing test 1 (Skipped)
//             skipped group 2 skipped group 2.1 skipped test 1 (Skipped)
//         skipped group 2 passing test 1 (Passed)
//         skipped group 2 failing test 1 (Failed)
//         skipped group 2 skipped test 1 (Skipped)
//     passing group 3 (Passed)
//         passing group 3 passing test 1 (Passed)
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

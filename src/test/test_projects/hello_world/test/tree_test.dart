import "package:test/test.dart";

// This comment is extracted by the test and compared to a text representation
// built from the tree provider in the test. It must be maintained to match
// the results from teh tests below.
// == EXPECTED RESULTS ==
// test/tree_test.dart (Failed)
//     failing group 1 (Failed)
//         group 1.1 (Passed)
//             passing test 1 (Passed)
//         passing test 1 (Passed)
//         failing test 1 (Failed)
//         skipped test 1 (Skipped)
//     skipped group 2 (Failed)
//         skipped group 2.1 (Skipped)
//             passing test 1 (Skipped)
//             failing test 1 (Skipped)
//             skipped test 1 (Skipped)
//         passing test 1 (Passed)
//         failing test 1 (Failed)
//         skipped test 1 (Skipped)
//     passing group 3 (Passed)
//         passing test 1 (Passed)
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

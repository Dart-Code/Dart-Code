import "package:test/test.dart";

import "utils.dart";

// This comment is extracted by the test and compared to a text representation
// built from the tree provider in the test. It must be maintained to match
// the results from the tests below.
// == EXPECTED RESULTS ==
// test/tree_test.dart [6/13 passed] Failed
//     (setUpAll) Passed (utils.dart)
//     (tearDownAll) Passed (utils.dart)
//     failing group 1 [2/4 passed] Failed
//         passing test 1 ${1 + 1} [1/1 passed] Passed
//             passing test 1 2 Passed
//         failing test 1 $foo [0/1 passed] Failed
//             failing test 1 some string Failed
//         skipped test 1 $foo [0/1 passed] Skipped
//             skipped test 1 some string Skipped
//         group 1.1 [1/1 passed] Passed
//             passing test 1 with ' some " quotes and newlines in name Passed
//     skipped group 2 [1/6 passed] Failed
//         passing test 1 Passed
//         failing test 1 Failed
//         skipped test 1 Skipped
//         skipped group 2.1 [0/3 passed] Skipped
//             passing test 1 Skipped
//             failing test 1 Skipped
//             skipped test 1 Skipped
//     passing group 3 [1/1 passed] Passed
//         passing test 1 Passed
// == /EXPECTED RESULTS ==

void main() {
  final foo = "some string";
  setupTests();
  group("failing group 1", () {
    test("passing test 1 ${1 + 1}", () => expect(1, equals(1)));
    test("failing test 1 $foo", () => expect(1, equals(2)));
    test("skipped test 1 $foo", () {}, skip: true);
    group("group 1.1", () {
      test('''
        passing test 1 with \' some " quotes
        and newlines in name
      ''', () => expect(1, equals(1)));
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

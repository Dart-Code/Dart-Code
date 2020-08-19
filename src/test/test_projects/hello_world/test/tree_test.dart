import "package:test/test.dart";

// This comment is extracted by the test and compared to a text representation
// built from the tree provider in the test. It must be maintained to match
// the results from the tests below.
// == EXPECTED RESULTS ==
// test/tree_test.dart [4/11 passed, {duration}ms] (fail.svg)
//     failing group 1 [2/4 passed, {duration}ms] (fail.svg)
//         group 1.1 [1/1 passed, {duration}ms] (pass.svg)
//             passing test 1 with ' some " quotes in name [{duration}ms] (pass.svg)
//         passing test 1 2 [{duration}ms] (pass.svg)
//         failing test 1 some string [{duration}ms] (fail.svg)
//         skipped test 1 [{duration}ms] (skip.svg)
//     skipped group 2 [1/6 passed, {duration}ms] (fail.svg)
//         skipped group 2.1 [0/3 passed, {duration}ms] (skip.svg)
//             passing test 1 [{duration}ms] (skip.svg)
//             failing test 1 [{duration}ms] (skip.svg)
//             skipped test 1 [{duration}ms] (skip.svg)
//         passing test 1 [{duration}ms] (pass.svg)
//         failing test 1 [{duration}ms] (fail.svg)
//         skipped test 1 [{duration}ms] (skip.svg)
//     passing group 3 [1/1 passed, {duration}ms] (pass.svg)
//         passing test 1 [{duration}ms] (pass.svg)
// == /EXPECTED RESULTS ==

void main() {
  final foo = "some string";
  group("failing group 1", () {
    test("passing test 1 ${1 + 1}", () => expect(1, equals(1)));
    test("failing test 1 $foo", () => expect(1, equals(2)));
    test("skipped test 1", () {}, skip: true);
    group("group 1.1", () {
      test("passing test 1 with ' some \" quotes in name",
          () => expect(1, equals(1)));
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

import "package:test/test.dart";

// This comment is extracted by the test and compared to a text representation
// built from the tree provider in the test. It must be maintained to match
// the results from the tests below.
// == EXPECTED RESULTS ==
// test/dupe_name_test.dart [2/5 passed, {duration}ms] (fail.svg)
//     group [1/2 passed, {duration}ms] (fail.svg)
//         test [{duration}ms] (pass.svg)
//         test [{duration}ms] (fail.svg)
//     group [1/3 passed, {duration}ms] (fail.svg)
//         test 1 [{duration}ms] (pass.svg)
//         test 1 [{duration}ms] (fail.svg)
//         test 2 [{duration}ms] (skip.svg)
// == /EXPECTED RESULTS ==

void main() {
  group("group", () {
    test("test", () => expect(1, equals(1)));
    test("test", () => expect(1, equals(2)));
  });
  group("group", () {
    test("test 1", () => expect(1, equals(1)));
    test("test 1", () => expect(1, equals(2)));
    test("test 2", () {}, skip: true);
  });
}

import "package:test/test.dart";

// This comment is extracted by the test and compared to a text representation
// built from the tree provider in the test. It must be maintained to match
// the results from the tests below.
// == EXPECTED RESULTS ==
// test/broken_test.dart [1/2 passed, {duration}ms] (fail.svg)
//     might fail [1/2 passed, {duration}ms] (fail.svg)
//         today [{duration}ms] (fail.svg)
//         not today [{duration}ms] (pass.svg)
// == /EXPECTED RESULTS ==

void main() {
  group("might fail", () {
    test("today", () {
      expect(1, equals(2));
    });
    test("not today", () {
      expect(1, equals(1));
    });
  });
}

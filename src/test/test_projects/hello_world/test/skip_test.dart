import "package:test/test.dart";

void main() {
  group("skipped", () {
    test("today", () => expect(1, equals(1)));
  }, skip: true);
}

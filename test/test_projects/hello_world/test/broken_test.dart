import "package:test/test.dart";

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

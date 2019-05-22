import "package:test/test.dart";

void main() {
  group("String", () {
    test(".split() splits the string on the delimiter", () {
      var string = "foo,bar,baz"; // BREAKPOINT1
      expect(string.split(","), equals(["foo", "bar", "baz"]));
    });

    test(".split() splits the string on the delimiter 2", () {
      expect("foo,bar,baz",
          allOf([contains("foo"), isNot(startsWith("bar")), endsWith("baz")]));
    });

    test(".trim() removes surrounding whitespace", () {
      var string = "  foo ";
      expect(string.trim(), equals("foo"));
    });
  });

  group("int", () {
    test(".remainder() returns the remainder of division", () {
      expect(11.remainder(3), equals(2));
    });

    test(".toRadixString() returns a hex string", () {
      expect(11.toRadixString(16), equals("b"));
    });
  });
}

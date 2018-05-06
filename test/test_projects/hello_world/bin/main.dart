main() {
  var s = "Hello!";
  var l = [0, 1];
  var m = {
    "l": l,
    "s": s,
    new DateTime.now(): "today",
    new DateTime.now().add(const Duration(days: 1)): "tomorrow",
    true: true,
    1: "one",
    1.1: "one-point-one",
  };
  if (m[true]) {
    print("Hello, world!"); // BREAKPOINT1
  }
}

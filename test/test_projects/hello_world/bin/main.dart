main() {
  var s = "Hello!";
  var l = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  final longStrings = <String>[
    "This is a long string that is 300 characters! This is a long string that is 300 characters! This is a long string that is 300 characters! This is a long string that is 300 characters! This is a long string that is 300 characters! This is a long string that is 300 characters! This is a long string!!!"
  ];
  var m = {
    "l": l,
    "longStrings": longStrings,
    "s": s,
    new DateTime(2000, 2, 14): "valentines-2000",
    new DateTime(2005, 1, 1): "new-year-2005",
    true: true,
    1: "one",
    1.1: "one-point-one",
  };
  if (m[true]) {
    print("Hello, world!"); // BREAKPOINT1
  }
}

import 'dart:developer';

main() {
  final s = "Hello!";
  final l = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  final longStrings = <String>[
    "This is a long string that is 300 characters! This is a long string that is 300 characters! This is a long string that is 300 characters! This is a long string that is 300 characters! This is a long string that is 300 characters! This is a long string that is 300 characters! This is a long string!!!"
  ];
  final tenDates = List.generate(10, (i) => DateTime(2005, 1, 1));
  final hundredDates = List.generate(100, (i) => DateTime(2005, 1, 1));
  final m = {
    "l": l,
    "longStrings": longStrings,
    "tenDates": tenDates,
    "hundredDates": hundredDates,
    "s": s,
    DateTime(2000, 2, 14): "valentines-2000",
    DateTime(2005, 1, 1): "new-year-2005",
    true: true,
    1: "one",
    1.1: "one-point-one",
  };
  if (m[true]) {
    print("Hello, world!"); // BREAKPOINT1
  }
  log("Logging from dart:developer!");
  genericMethod<bool, double, int, String>();
}

void genericMethod<TBool, TDouble, TInt, TString>() {
  int a = 1;
  print(a);
  print('TBool: ' + TBool.toString()); // BREAKPOINT2
  print('TDouble: ' + TDouble.toString());
  print('TInt: ' + TInt.toString());
  print('TString: ' + TString.toString());
}

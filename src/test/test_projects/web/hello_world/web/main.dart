import 'dart:html';

Future<void> main() async {
  // TODO: Remove this delay when breakpoints in startup code work
  // https://github.com/dart-lang/webdev/issues/830
  await Future.delayed(const Duration(seconds: 1));

  genericMethod<bool, double, int, String>();
  querySelector('#output')!.text = 'Your Dart app is running.';
  // BREAKPOINT1^
}

void genericMethod<TBool, TDouble, TInt, TString>() {
  var a = 1;
  print(a);
  print('TBool: ' + TBool.toString()); // BREAKPOINT2
  print('TDouble: ' + TDouble.toString());
  print('TInt: ' + TInt.toString());
  print('TString: ' + TString.toString());
}

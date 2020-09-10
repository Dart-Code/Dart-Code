import 'dart:html';

void main() {
  genericMethod<bool, double, int, String>();
  querySelector('#output').text = 'Your Dart app is running.';
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

import 'dart:html';

void main() {
  methodThatThrows();
  querySelector('#output')!.text = 'Your Dart app is running.';
}

void methodThatThrows() {
  throw Exception("Oops");
}

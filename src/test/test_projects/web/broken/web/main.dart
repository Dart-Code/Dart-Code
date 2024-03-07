import 'dart:html';

Future<void> main() async {
  // TODO: Remove this delay when breakpoints in startup code work
  // https://github.com/dart-lang/webdev/issues/830
  await Future.delayed(const Duration(seconds: 1));

  methodThatThrows();
  querySelector('#output')!.text = 'Your Dart app is running.';
}

void methodThatThrows() {
  throw Exception("Oops");
}


import 'dart:async';

main() async {
  Timer.periodic(Duration(milliseconds: 100), (_) => printSomething());
}

void printSomething() {
  print('NEW CONTENT');
}
		
import 'package:flutter/widgets.dart';

void main() {
  runApp(new MyBrokenHome());
}

class MyBrokenHome extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    throw new Exception("Oops");
  }
}

import 'package:flutter/widgets.dart';

void main() {
  runApp(new Column(children: [
    new Center(
        child: new Text(
      'Hello, world!',
      textDirection: TextDirection.ltr,
    )),
    new MySampleHome()
  ]));
}

class MySampleHome extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return new Container(); // BREAKPOINT1
  }
}

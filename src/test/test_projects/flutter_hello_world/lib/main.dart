import 'package:flutter/material.dart';

void main() => runApp(new MyApp());

class MyApp extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return new MaterialApp(
      title: 'Flutter Demo',
      theme: new ThemeData(primarySwatch: Colors.blue),
      home: new MyHomePage(),
    );
  }
}

class MyHomePage extends StatelessWidget {
  MyHomePage({Key key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    myTopLevelFunction();
    return new Text(
      // BREAKPOINT1^
      'Hello, world!',
      textDirection: TextDirection.ltr,
    );
  }
}

myTopLevelFunction() {
  const _ = 1;
  // BREAKPOINT2^
}

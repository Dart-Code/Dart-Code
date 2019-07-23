import 'package:flutter/material.dart';
import 'package:my_package/my_thing.dart';

main() {
  printMyThing();

  runApp(MyApp());
}

class MyApp extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Flutter Demo',
      theme: ThemeData(primarySwatch: Colors.blue),
      home: MyHomePage(),
    );
  }
}

class MyHomePage extends StatelessWidget {
  MyHomePage({Key key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Text(
      'Hello, world!',
      textDirection: TextDirection.ltr,
    );
  }
}

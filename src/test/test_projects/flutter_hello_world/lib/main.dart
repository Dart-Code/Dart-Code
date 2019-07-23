import 'dart:developer';

import 'package:flutter/material.dart';

void main() => runApp(MyApp());

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
    print("Hello, world!");
    log("Logging from dart:developer!");
    myTopLevelFunction();
    return Text(
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

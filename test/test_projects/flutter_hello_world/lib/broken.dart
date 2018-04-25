import 'package:flutter/material.dart';

void main() => runApp(new MyBrokenApp());

class MyBrokenApp extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return new MaterialApp(
      title: 'Flutter Demo',
      theme: new ThemeData(primarySwatch: Colors.blue),
      home: new MyBrokenHomePage(),
    );
  }
}

class MyBrokenHomePage extends StatelessWidget {
  MyBrokenHomePage({Key key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    throw new Exception("Oops");
  }
}

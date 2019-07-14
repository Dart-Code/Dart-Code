import 'package:flutter_web/material.dart';

void main() => runApp(MyBrokenApp());

class MyBrokenApp extends StatelessWidget {
  // This widget is the root of your application.
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Flutter Demo',
      theme: ThemeData(
        primarySwatch: Colors.blue,
      ),
      home: MyBrokenHomePage(title: 'Flutter Demo Home Page'),
    );
  }
}

class MyBrokenHomePage extends StatelessWidget {
  MyBrokenHomePage({Key key, this.title}) : super(key: key);

  final String title;

  @override
  Widget build(BuildContext context) {
    return methodThatThrows();
  }

  Widget methodThatThrows() {
    throw Exception("Oops");
  }
}

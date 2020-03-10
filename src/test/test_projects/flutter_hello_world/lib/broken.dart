import 'dart:async';

import 'package:flutter/material.dart';

void main() => runApp(MyBrokenApp());

class MyBrokenApp extends StatefulWidget {
  @override
  _MyBrokenAppState createState() => _MyBrokenAppState();
}

class _MyBrokenAppState extends State<MyBrokenApp> {
  bool shouldBeBroken = false;

  @override
  void initState() {
    super.initState();

    // Enabling structured errors has a race - we can't enable it until the app
    // is running, but if we throw an exception immediately, it may occur before
    // structured errors was enabled. So, this app waits 2 seconds before switching
    // to a widget that throws, to allow any startup things like this to occur first.
    new Timer(
      const Duration(seconds: 2),
      () => setState(() => shouldBeBroken = true),
    );
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Flutter Demo',
      theme: ThemeData(primarySwatch: Colors.blue),
      home: shouldBeBroken ? MyBrokenHomePage() : MyHomePage(),
    );
  }
}

class MyHomePage extends StatelessWidget {
  MyHomePage({Key key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Text("test");
  }
}

class MyBrokenHomePage extends StatelessWidget {
  MyBrokenHomePage({Key key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    _throwAnException();
    return Text("test");
  }

  void _throwAnException() {
    throw Exception("Oops");
  }
}

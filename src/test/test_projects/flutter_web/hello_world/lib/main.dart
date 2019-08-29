import 'package:flutter_web/material.dart';

void main() => runApp(MyApp());

class MyApp extends StatelessWidget {
  // This widget is the root of your application.
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Flutter Demo',
      theme: ThemeData(
        primarySwatch: Colors.blue,
      ),
      home: MyHomePage(title: 'Flutter Demo Home Page'),
    );
  }
}

class MyHomePage extends StatelessWidget {
  MyHomePage({Key key, this.title}) : super(key: key);

  final String title;

  @override
  Widget build(BuildContext context) {
    genericMethod<bool, double, int, String>();
    return Text(
      // BREAKPOINT1^
      'Hello, World!',
      textDirection: TextDirection.ltr,
    );
  }
}

void genericMethod<TBool, TDouble, TInt, TString>() {
  int a = 1;
  print(a);
  print('TBool: ' + TBool.toString()); // BREAKPOINT2
  print('TDouble: ' + TDouble.toString());
  print('TInt: ' + TInt.toString());
  print('TString: ' + TString.toString());
}

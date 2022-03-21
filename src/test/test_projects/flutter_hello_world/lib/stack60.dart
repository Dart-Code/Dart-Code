import 'package:flutter/material.dart';

main() {
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
  MyHomePage({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    func1();
    return Text(
      'Hello, world!',
      textDirection: TextDirection.ltr,
    );
  }
}

Future func1() async => await func2();
Future func2() async => await func3();
Future func3() async => await func4();
Future func4() async => await func5();
Future func5() async => await func6();
Future func6() async => await func7();
Future func7() async => await func8();
Future func8() async => await func9();
Future func9() async => await func10();
Future func10() async => await func11();
Future func11() async => await func12();
Future func12() async => await func13();
Future func13() async => await func14();
Future func14() async => await func15();
Future func15() async => await func16();
Future func16() async => await func17();
Future func17() async => await func18();
Future func18() async => await func19();
Future func19() async => await func20();
Future func20() async => await func21();
Future func21() async => await func22();
Future func22() async => await func23();
Future func23() async => await func24();
Future func24() async => await func25();
Future func25() async => await func26();
Future func26() async => await func27();
Future func27() async => await func28();
Future func28() async => await func29();
Future func29() async => await func30();
Future func30() async => await func31();
Future func31() async => await func32();
Future func32() async => await func33();
Future func33() async => await func34();
Future func34() async => await func35();
Future func35() async => await func36();
Future func36() async => await func37();
Future func37() async => await func38();
Future func38() async => await func39();
Future func39() async => await func40();
Future func40() async => await func41();
Future func41() async => await func42();
Future func42() async => await func43();
Future func43() async => await func44();
Future func44() async => await func45();
Future func45() async => await func46();
Future func46() async => await func47();
Future func47() async => await func48();
Future func48() async => await func49();
Future func49() async => await func50();
Future func50() async => await func51();
Future func51() async => await func52();
Future func52() async => await func53();
Future func53() async => await func54();
Future func54() async => await func55();
Future func55() async => await func56();
Future func56() async => await func57();
Future func57() async => await func58();
Future func58() async => await func59();
Future func59() async => await func60();
Future func60() async {
  print("Hello, world!"); // BREAKPOINT1
}

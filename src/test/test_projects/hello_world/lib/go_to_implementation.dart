abstract class A {
  void b();
}

class B extends A {
  void b() /* B */ {
    print("test");
  }
}

class C extends A {
  void b() /* C */ {
    print("test");
  }
}

class D extends B {
  void b() /* D */ {
    print("test");
  }
}

class E extends B {}

class F extends E {
  void b() /* F */ {
    print("test");
  }
}

class X {
  fromCallSite() {
    A e = new E();
    e.b();
  }
}

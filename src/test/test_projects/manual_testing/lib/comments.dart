/// Any line that starts with `var` or `void` should be coloured.
/// Every other line should be a comment.

// ignore_for_file: unused_element

/* test /* test */ */
var a = 1;
/** test /** test */ */
var b = 1;
/** test /* test */ */
var c = 1;
/* test /** test */ */
var d = 1;
// test
var e = 1;

/**
 * test
 *     test
 * test
 */

/*
/**
 * test
 *     test
 * test
 */
*/

// /**
//  * test
//  *     test
//  * test
//  */

/// /*
/// /**
///  * test
///  *     test
///  * test
///  */
/// */

/// test
var f = 1;

/// test
/// test
var g = 1; /// test
var h = 1; /// test
/// test


// test
var i = 1;

// test
// test
var j = 1; // test
var k = 1; // test
// test

/* // */
var l = 1;

/* /// */
var m = 1;

/*
 * // Test
 */
var n = 1;

/** // */
var o = 1;

/** /// */
var p = 1;

/**
  * // Test
  */
var q = 1;

void foo() {
  /**
    * Nested function.
    */
  bool bar() => true;
}

class ClassToAddIndenting {
  /* test /* test */ */
  var a = 1;
  /** test /** test */ */
  var b = 1;
  /** test /* test */ */
  var c = 1;
  /* test /** test */ */
  var d = 1;
  // test
  var e = 1;

  /**
   * test
   *     test
   * test
   */

  /*
  /**
   * test
   *     test
   * test
   */
  */

  // /**
  //  * test
  //  *     test
  //  * test
  //  */

  /// /*
  /// /**
  ///  * test
  ///  *     test
  ///  * test
  ///  */
  /// */

  /// test
  var f = 1;

  /// test
  /// test
  var g = 1; /// test
  var h = 1; /// test
  /// test


  // test
  var i = 1;

  // test
  // test
  var j = 1; // test
  var k = 1; // test
  // test

  /* // */
  var l = 1;

  /* /// */
  var m = 1;

  /*
  * // Test
  */
  var n = 1;

  /** // */
  var o = 1;

  /** /// */
  var p = 1;

  /**
    * // Test
    */
  var q = 1;

  void foo() {
    /**
     * Nested function.
     */
    void bar() {}
  }
}

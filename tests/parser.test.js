// Property-based tests for parser round-tripping
// Run with: node tests/parser.test.js

import fc from 'fast-check';
import assert from 'assert';
import { parse, toPlainString, Variable, Abstraction, Application } from '../src/kernel.js';

// ============================================================================
// AST Generators
// ============================================================================

// Generate valid variable names (start with letter, followed by letters/digits/primes)
const variableNameArb = fc.stringMatching(/^[a-z][a-z0-9']{0,5}$/);

// Generate a random AST with bounded depth
function astArb(maxDepth) {
  if (maxDepth <= 0) {
    return variableNameArb.map(name => new Variable(name));
  }

  const variableArb = variableNameArb.map(name => new Variable(name));

  const abstractionArb = fc.tuple(variableNameArb, astArb(maxDepth - 1))
    .map(([param, body]) => new Abstraction(param, body));

  const applicationArb = fc.tuple(astArb(maxDepth - 1), astArb(maxDepth - 1))
    .map(([func, arg]) => new Application(func, arg));

  return fc.oneof(variableArb, abstractionArb, applicationArb);
}

// ============================================================================
// String Generators (for parse-only tests)
// ============================================================================

// Generate syntactically valid lambda calculus strings
function exprStringArb(maxDepth) {
  if (maxDepth <= 0) {
    return variableNameArb;
  }

  const variableStr = variableNameArb;

  const abstractionStr = fc.tuple(variableNameArb, exprStringArb(maxDepth - 1))
    .map(([param, body]) => `λ${param}.${body}`);

  const applicationStr = fc.tuple(exprStringArb(maxDepth - 1), exprStringArb(maxDepth - 1))
    .map(([func, arg]) => `(${func} ${arg})`);

  return fc.oneof(variableStr, abstractionStr, applicationStr);
}

// ============================================================================
// Comparison Helpers
// ============================================================================

// Compare two ASTs for structural equality (ignoring metadata like fromSubstitution)
function astEqual(a, b) {
  if (a.type !== b.type) return false;

  switch (a.type) {
    case 'variable':
      return a.name === b.name;
    case 'abstraction':
      return a.param === b.param && astEqual(a.body, b.body);
    case 'application':
      return astEqual(a.func, b.func) && astEqual(a.arg, b.arg);
    default:
      return false;
  }
}

// ============================================================================
// Tests
// ============================================================================

console.log('Property-based parser tests...\n');

// Test 1: AST round-trip (AST -> string -> AST)
console.log('Test 1: AST round-trip (AST -> string -> AST)');
{
  const result = fc.check(
    fc.property(astArb(4), (ast) => {
      const stringified = toPlainString(ast);
      const reparsed = parse(stringified);
      return astEqual(ast, reparsed);
    }),
    { numRuns: 1000 }
  );

  if (result.failed) {
    console.log('  FAILED!');
    console.log('  Counterexample:', result.counterexample);
    const ast = result.counterexample[0];
    console.log('  Original AST:', JSON.stringify(ast, null, 2));
    console.log('  Stringified:', toPlainString(ast));
    console.log('  Reparsed:', JSON.stringify(parse(toPlainString(ast)), null, 2));
    process.exit(1);
  }

  console.log(`  Passed ${result.numRuns} tests`);
}

// Test 2: String round-trip (string -> AST -> string -> AST)
console.log('\nTest 2: String round-trip (string -> AST -> string -> AST)');
{
  const result = fc.check(
    fc.property(exprStringArb(4), (str) => {
      const ast1 = parse(str);
      const stringified = toPlainString(ast1);
      const ast2 = parse(stringified);
      return astEqual(ast1, ast2);
    }),
    { numRuns: 1000 }
  );

  if (result.failed) {
    console.log('  FAILED!');
    console.log('  Counterexample:', result.counterexample);
    const str = result.counterexample[0];
    console.log('  Original string:', str);
    const ast1 = parse(str);
    console.log('  Parsed AST:', JSON.stringify(ast1, null, 2));
    const stringified = toPlainString(ast1);
    console.log('  Re-stringified:', stringified);
    const ast2 = parse(stringified);
    console.log('  Re-parsed AST:', JSON.stringify(ast2, null, 2));
    process.exit(1);
  }

  console.log(`  Passed ${result.numRuns} tests`);
}

// Test 3: Canonical form stability (stringify is idempotent after parse)
console.log('\nTest 3: Canonical form stability (stringify(parse(s)) is stable)');
{
  const result = fc.check(
    fc.property(exprStringArb(4), (str) => {
      const canonical = toPlainString(parse(str));
      const again = toPlainString(parse(canonical));
      return canonical === again;
    }),
    { numRuns: 1000 }
  );

  if (result.failed) {
    console.log('  FAILED!');
    console.log('  Counterexample:', result.counterexample);
    process.exit(1);
  }

  console.log(`  Passed ${result.numRuns} tests`);
}

// Test 4: Specific known cases that previously failed
console.log('\nTest 4: Known edge cases');
{
  const cases = [
    // Lambda in function position needs parens
    '(λx.x) y',
    // Lambda in argument position needs parens
    'f (λx.x)',
    // Nested lambdas
    'λx.λy.x',
    // Application chain
    'a b c',
    // Complex nesting
    '(λx.x x) (λy.y)',
    // Both lambda positions
    '(λf.f) (λx.x)',
  ];

  for (const input of cases) {
    const ast = parse(input);
    const stringified = toPlainString(ast);
    const reparsed = parse(stringified);
    const restringified = toPlainString(reparsed);

    // Verify round-trip works (parsed ASTs match)
    assert(astEqual(ast, reparsed), `AST mismatch for input: ${input}`);

    // Verify canonical form is stable
    assert.strictEqual(stringified, restringified, `Canonical form unstable for: ${input}`);

    console.log(`  "${input}" -> "${stringified}" -> round-trips correctly`);
  }
}

// Test 5: Whitespace tolerance
console.log('\nTest 5: Whitespace tolerance');
{
  const cases = [
    ['(λx.x)y', '((λx.x) y)'],
    ['(λx . x)  y', '((λx.x) y)'],
    ['  (λx.x) y  ', '((λx.x) y)'],
    ['λx.λy.x y', 'λx.λy.(x y)'],
    ['(  a   b  )', '(a b)'],
  ];

  for (const [input, expected] of cases) {
    const ast = parse(input);
    const stringified = toPlainString(ast);
    assert.strictEqual(stringified, expected, `Whitespace handling failed for: "${input}"`);
    console.log(`  "${input}" -> "${stringified}"`);
  }
}

// Test 6: Both lambda notations work identically
console.log('\nTest 6: Lambda notation equivalence (λ vs \\)');
{
  const cases = [
    ['λx.x', '\\x.x'],
    ['λx.λy.x', '\\x.\\y.x'],
    ['(λx.x) y', '(\\x.x) y'],
  ];

  for (const [lambda, backslash] of cases) {
    const ast1 = parse(lambda);
    const ast2 = parse(backslash);
    assert(astEqual(ast1, ast2), `Notation mismatch: "${lambda}" vs "${backslash}"`);
    console.log(`  "${lambda}" = "${backslash}"`);
  }
}

// Test 7: Error handling
console.log('\nTest 7: Error handling');
{
  const invalidInputs = [
    '(',           // unclosed paren
    ')',           // unexpected close paren
    'λx',          // missing dot
    'λ.x',         // missing param
    '(a b',        // unclosed paren
    'a b)',        // extra close paren
    '',            // empty
    '   ',         // only whitespace
  ];

  for (const input of invalidInputs) {
    let threw = false;
    try {
      parse(input);
    } catch (e) {
      threw = true;
    }
    assert(threw, `Should have thrown for invalid input: "${input}"`);
    console.log(`  "${input}" -> correctly throws error`);
  }
}

console.log('\nAll parser tests passed!');

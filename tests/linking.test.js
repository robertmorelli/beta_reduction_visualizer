// Tests for linking logic - tracing substitutions across reduction steps
// Run with: node tests/linking.test.js

import assert from 'assert';
import {
  parse,
  numberRedexes,
  reduceAt,
  clearSubstitutionMarks,
  getSubstitutions,
  getRedexArg,
  getLinkingInfo,
  getFullLinkingInfo,
  buildLinkingChain,
  toPlainString,
  getRedexCount,
  findVariableUses,
  getParameterUses,
  getRedex,
} from '../src/kernel.js';

// Helper to perform a reduction step
function reduceStep(expr, redexId) {
  const cleared = clearSubstitutionMarks(expr);
  const numbered = numberRedexes(cleared);
  const reduced = reduceAt(numbered, redexId);
  return numberRedexes(reduced);
}

// Helper to set up initial expression
function setup(exprString) {
  return numberRedexes(parse(exprString));
}

console.log('Testing linking logic...\n');

// ============================================================================
// Test 1: Identity function - simple single substitution
// ============================================================================
console.log('Test 1: Identity function (λx.x) hello');
{
  const expr0 = setup('(\\x.x) hello');
  assert.strictEqual(getRedexCount(expr0), 1, 'Should have 1 redex');

  // Check the source arg
  const sourceArg = getRedexArg(expr0, 1);
  assert.strictEqual(toPlainString(sourceArg), 'hello', 'Source arg should be "hello"');

  // Reduce
  const expr1 = reduceStep(expr0, 1);
  assert.strictEqual(toPlainString(expr1), 'hello', 'Result should be "hello"');

  // Check substitutions
  const subs = getSubstitutions(expr1);
  assert.strictEqual(subs.size, 1, 'Should have 1 source ID');
  assert.strictEqual(subs.has(1), true, 'Source ID should be 1');
  assert.strictEqual(subs.get(1).length, 1, 'Should have 1 substituted node');

  // Check linking info
  const linkInfo = getLinkingInfo(expr0, expr1, 1);
  assert.strictEqual(linkInfo.hasSubstitutions, true, 'Should have substitutions');
  assert.strictEqual(linkInfo.substitutedNodes.length, 1, 'Should have 1 substituted node');

  console.log('  ✓ Identity function test passed\n');
}

// ============================================================================
// Test 2: K combinator - variable used once
// ============================================================================
console.log('Test 2: K combinator (λx.λy.x) first second');
{
  const expr0 = setup('(\\x.\\y.x) first second');
  assert.strictEqual(getRedexCount(expr0), 1, 'Should have 1 redex initially');

  // Reduce [1]: (λx.λy.x) first -> λy.first
  const expr1 = reduceStep(expr0, 1);
  assert.strictEqual(toPlainString(expr1), '((λy.first) second)', 'After step 1');

  const subs1 = getSubstitutions(expr1);
  assert.strictEqual(subs1.get(1)?.length, 1, 'Should have 1 substituted node from redex 1');

  // Reduce [1] again: (λy.first) second -> first
  const expr2 = reduceStep(expr1, 1);
  assert.strictEqual(toPlainString(expr2), 'first', 'After step 2');

  // No substitutions because y doesn't appear in body
  const subs2 = getSubstitutions(expr2);
  assert.strictEqual(subs2.size, 0, 'No substitutions when variable not used');

  console.log('  ✓ K combinator test passed\n');
}

// ============================================================================
// Test 3: Self-application - variable used multiple times
// ============================================================================
console.log('Test 3: (λx.x x) arg - variable used twice');
{
  const expr0 = setup('(\\x.x x) arg');
  assert.strictEqual(getRedexCount(expr0), 1, 'Should have 1 redex');

  // Reduce [1]: (λx.x x) arg -> (arg arg)
  const expr1 = reduceStep(expr0, 1);
  assert.strictEqual(toPlainString(expr1), '(arg arg)', 'After reduction');

  // Should have 2 substituted nodes (both args)
  const subs = getSubstitutions(expr1);
  assert.strictEqual(subs.get(1)?.length, 2, 'Should have 2 substituted nodes');

  console.log('  ✓ Self-application test passed\n');
}

// ============================================================================
// Test 4: Boolean OR - the complex case
// (λp.λq.p p q) (λx.λy.y) (λx.λy.x) - FALSE OR TRUE = TRUE
// This test demonstrates the "unused variable" case
// ============================================================================
console.log('Test 4: Boolean OR - FALSE OR TRUE');
{
  const expr0 = setup('(\\p.\\q.p p q) (\\x.\\y.y) (\\x.\\y.x)');
  assert.strictEqual(getRedexCount(expr0), 1, 'Should have 1 redex initially');

  // Reduce [1]: substitute (λx.λy.y) for p
  // ((λp.λq.p p q) (λx.λy.y)) -> λq.(λx.λy.y) (λx.λy.y) q
  const expr1 = reduceStep(expr0, 1);
  console.log('  After [1]:', toPlainString(expr1));

  // Should now be: ((λq.((λx.λy.y) (λx.λy.y) q)) (λx.λy.x))
  // The expression has substitutions from redex 1
  const subs1 = getSubstitutions(expr1);
  assert.strictEqual(subs1.has(1), true, 'Should have substitutions from redex 1');
  // p appears twice in body, so 2 substitutions
  assert.strictEqual(subs1.get(1)?.length, 2, 'Should have 2 substituted nodes (p used twice)');

  // Should have 2 redexes now:
  // [1] = outer application (λq... (λx.λy.x))
  // [2] = inner application ((λx.λy.y) (λx.λy.y))
  const redexCount1 = getRedexCount(expr1);
  assert.strictEqual(redexCount1, 2, 'Should have 2 redexes after step 1');

  // Reduce [2]: ((λx.λy.y) (λx.λy.y)) -> λy.y
  // NOTE: x is NOT used in the body (λy.y), so NO substitutions!
  const expr2 = reduceStep(expr1, 2);
  console.log('  After [2]:', toPlainString(expr2));

  // No substitutions from redex 2 because x doesn't appear in body!
  const subs2 = getSubstitutions(expr2);
  assert.strictEqual(subs2.has(2), false, 'No substitutions from redex 2 (x not used in λy.y)');

  // Get linking info - should show no substitutions
  const linkInfo2 = getLinkingInfo(expr1, expr2, 2);
  assert.strictEqual(linkInfo2.hasSubstitutions, false, 'hasSubstitutions should be false');
  assert.notStrictEqual(linkInfo2.sourceArg, null, 'But sourceArg should exist (the arg that was dropped)');
  console.log('  Source arg for [2]:', toPlainString(linkInfo2.sourceArg));
  console.log('  Substituted nodes: none (variable not used)');

  // Reduce [1]: (λq.(λy.y q)) (λx.λy.x) -> (λy.y (λx.λy.x))
  const expr3 = reduceStep(expr2, 1);
  console.log('  After [1]:', toPlainString(expr3));

  // q IS used in the body, so we should have 1 substitution
  const subs3 = getSubstitutions(expr3);
  assert.strictEqual(subs3.has(1), true, 'Should have substitutions from redex 1');
  assert.strictEqual(subs3.get(1)?.length, 1, 'Should have 1 substituted node (q used once)');

  // Final reduction: (λy.y (λx.λy.x)) -> (λx.λy.x)
  const expr4 = reduceStep(expr3, 1);
  console.log('  After [1]:', toPlainString(expr4));
  assert.strictEqual(toPlainString(expr4), 'λx.λy.x', 'Final result should be TRUE');

  // y IS used, so we have substitution
  const subs4 = getSubstitutions(expr4);
  assert.strictEqual(subs4.has(1), true, 'Should have substitutions');

  console.log('  ✓ Boolean OR test passed\n');
}

// ============================================================================
// Test 5: buildLinkingChain helper
// ============================================================================
console.log('Test 5: buildLinkingChain');
{
  const expr0 = setup('(\\x.x) hello');
  const expr1 = reduceStep(expr0, 1);

  const steps = [
    { expr: expr0, reducedId: null },
    { expr: expr1, reducedId: 1 }
  ];

  const chain = buildLinkingChain(steps);

  assert.strictEqual(chain.length, 2, 'Chain should have 2 steps');
  assert.strictEqual(chain[0].linkingInfo, null, 'First step has no linking info');
  assert.strictEqual(chain[1].linkingInfo.hasSubstitutions, true, 'Second step has linking info');
  assert.strictEqual(toPlainString(chain[1].linkingInfo.sourceArg), 'hello', 'Source arg is hello');

  console.log('  ✓ buildLinkingChain test passed\n');
}

// ============================================================================
// Test 6: Edge case - no variable usage (argument discarded)
// ============================================================================
console.log('Test 6: Edge case - (λx.y) arg (x not used, arg discarded)');
{
  const expr0 = setup('(\\x.y) arg');
  assert.strictEqual(getRedexCount(expr0), 1, 'Should have 1 redex');

  const expr1 = reduceStep(expr0, 1);
  assert.strictEqual(toPlainString(expr1), 'y', 'Result should be y');

  // No substitutions because x doesn't appear in body
  const subs = getSubstitutions(expr1);
  assert.strictEqual(subs.size, 0, 'No substitutions when variable not used');

  const linkInfo = getLinkingInfo(expr0, expr1, 1);
  assert.strictEqual(linkInfo.hasSubstitutions, false, 'Should not have substitutions');
  assert.strictEqual(linkInfo.wasUsed, false, 'wasUsed should be false (arg was discarded)');

  console.log('  ✓ Edge case test passed\n');
}

// ============================================================================
// Test 7: wasUsed detection
// ============================================================================
console.log('Test 7: wasUsed detection');
{
  // Variable IS used
  const expr1 = setup('(\\x.x) hello');
  const linkInfo1 = getLinkingInfo(expr1, reduceStep(expr1, 1), 1);
  assert.strictEqual(linkInfo1.wasUsed, true, 'x is used in body');

  // Variable NOT used
  const expr2 = setup('(\\x.y) hello');
  const linkInfo2 = getLinkingInfo(expr2, reduceStep(expr2, 1), 1);
  assert.strictEqual(linkInfo2.wasUsed, false, 'x is not used in body');

  // Variable used multiple times
  const expr3 = setup('(\\x.x x) hello');
  const linkInfo3 = getLinkingInfo(expr3, reduceStep(expr3, 1), 1);
  assert.strictEqual(linkInfo3.wasUsed, true, 'x is used twice');

  // Variable shadowed (inner lambda uses same name)
  const expr4 = setup('(\\x.\\x.x) hello');
  const linkInfo4 = getLinkingInfo(expr4, reduceStep(expr4, 1), 1);
  assert.strictEqual(linkInfo4.wasUsed, false, 'x is shadowed by inner lambda');

  console.log('  ✓ wasUsed detection test passed\n');
}

// ============================================================================
// Test 8: findVariableUses - basic usage
// ============================================================================
console.log('Test 8: findVariableUses');
{
  // Single use
  const expr1 = setup('\\x.x');
  const uses1 = findVariableUses(expr1.body, 'x');
  assert.strictEqual(uses1.length, 1, 'Should find 1 use of x');
  assert.strictEqual(uses1[0].name, 'x', 'Found variable should be x');

  // Multiple uses
  const expr2 = setup('\\x.x x x');
  const uses2 = findVariableUses(expr2.body, 'x');
  assert.strictEqual(uses2.length, 3, 'Should find 3 uses of x');

  // No uses
  const expr3 = setup('\\x.y');
  const uses3 = findVariableUses(expr3.body, 'x');
  assert.strictEqual(uses3.length, 0, 'Should find 0 uses of x');

  // Shadowed variable
  const expr4 = setup('\\x.\\x.x');
  const uses4 = findVariableUses(expr4.body, 'x');
  assert.strictEqual(uses4.length, 0, 'Should find 0 uses of outer x (shadowed)');

  console.log('  ✓ findVariableUses test passed\n');
}

// ============================================================================
// Test 9: getParameterUses - for redexes
// ============================================================================
console.log('Test 9: getParameterUses');
{
  // Identity function: (λx.x) arg - x used once
  const expr1 = setup('(\\x.x) arg');
  const redex1 = getRedex(expr1, 1);
  const uses1 = getParameterUses(redex1);
  assert.strictEqual(uses1.length, 1, 'Should find 1 parameter use in identity');

  // Self-application: (λx.x x) arg - x used twice
  const expr2 = setup('(\\x.x x) arg');
  const redex2 = getRedex(expr2, 1);
  const uses2 = getParameterUses(redex2);
  assert.strictEqual(uses2.length, 2, 'Should find 2 parameter uses in self-app');

  // K combinator inner: (λy.first) second - y not used
  const expr3 = setup('(\\y.first) second');
  const redex3 = getRedex(expr3, 1);
  const uses3 = getParameterUses(redex3);
  assert.strictEqual(uses3.length, 0, 'Should find 0 parameter uses in K');

  // Not a redex
  const expr4 = setup('f x');
  const uses4 = getParameterUses(expr4);
  assert.strictEqual(uses4.length, 0, 'Should return empty for non-redex');

  console.log('  ✓ getParameterUses test passed\n');
}

// ============================================================================
// Test 10: getFullLinkingInfo - with parameterUses
// ============================================================================
console.log('Test 10: getFullLinkingInfo');
{
  // Identity function
  const expr0 = setup('(\\x.x) hello');
  const expr1 = reduceStep(expr0, 1);

  const fullInfo = getFullLinkingInfo(expr0, expr1, 1);
  assert.strictEqual(toPlainString(fullInfo.sourceArg), 'hello', 'Source arg is hello');
  assert.strictEqual(fullInfo.parameterUses.length, 1, 'Should have 1 parameter use');
  assert.strictEqual(fullInfo.parameterUses[0].name, 'x', 'Parameter use is x');
  assert.strictEqual(fullInfo.substitutedNodes.length, 1, 'Should have 1 substituted node');
  assert.strictEqual(fullInfo.wasUsed, true, 'Variable was used');

  // Self-application
  const expr2 = setup('(\\x.x x) arg');
  const expr3 = reduceStep(expr2, 1);

  const fullInfo2 = getFullLinkingInfo(expr2, expr3, 1);
  assert.strictEqual(fullInfo2.parameterUses.length, 2, 'Should have 2 parameter uses');
  assert.strictEqual(fullInfo2.substitutedNodes.length, 2, 'Should have 2 substituted nodes');

  // Discarded argument
  const expr4 = setup('(\\x.y) arg');
  const expr5 = reduceStep(expr4, 1);

  const fullInfo3 = getFullLinkingInfo(expr4, expr5, 1);
  assert.strictEqual(fullInfo3.parameterUses.length, 0, 'Should have 0 parameter uses');
  assert.strictEqual(fullInfo3.substitutedNodes.length, 0, 'Should have 0 substituted nodes');
  assert.strictEqual(fullInfo3.wasUsed, false, 'Variable was not used');

  console.log('  ✓ getFullLinkingInfo test passed\n');
}

console.log('All tests passed! ✓');

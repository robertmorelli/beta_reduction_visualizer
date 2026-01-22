# Kernel API Reference

The kernel (`kernel.js`) provides the core lambda calculus functionality with no external dependencies. This enables dependency injection for different UI implementations.

## AST Node Types

### `Variable`
```javascript
new Variable(name, fromSubstitution = false, sourceId = null)
```
- `name`: String - the variable name
- `fromSubstitution`: Boolean - true if this node came from a substitution
- `sourceId`: Number|null - the redex ID that produced this substitution

### `Abstraction`
```javascript
new Abstraction(param, body, fromSubstitution = false, sourceId = null)
```
- `param`: String - the bound variable name
- `body`: Expression - the lambda body
- `fromSubstitution`: Boolean - true if this node came from a substitution
- `sourceId`: Number|null - the redex ID that produced this substitution

### `Application`
```javascript
new Application(func, arg, id = null, fromSubstitution = false, sourceId = null)
```
- `func`: Expression - the function being applied
- `arg`: Expression - the argument
- `id`: Number|null - redex ID if this is a beta redex
- `fromSubstitution`: Boolean - true if this node came from a substitution
- `sourceId`: Number|null - the redex ID that produced this substitution

All node types have a `clone(fromSubstitution, sourceId)` method for creating copies with new substitution tracking.

## Parsing

### `parse(input)`
Parses a lambda calculus string into an AST.

```javascript
const ast = parse('(\\x.x) hello');
```

**Grammar:**
```
expr     = atom+                    (left-associative application)
atom     = variable | '(' expr ')' | lambda
lambda   = ('λ' | '\') variable '.' expr
variable = [a-zA-Z][a-zA-Z0-9_']*
```

## Beta Reduction

### `isRedex(expr)`
Returns `true` if the expression is a beta redex (application where func is abstraction).

### `numberRedexes(expr, counter = { val: 1 })`
Assigns sequential IDs to all redexes in the expression. Returns a new AST with IDs set.

### `reduceAt(expr, targetId)`
Performs beta reduction on the redex with the given ID. Returns a new AST with substitution marks.

### `clearSubstitutionMarks(expr)`
Removes all substitution marks (`fromSubstitution`, `sourceId`) from an expression.

### `getRedexCount(expr)`
Returns the number of redexes in the expression.

### `getRedexes(expr)`
Returns an array of `{ id, expr }` objects for all redexes.

## Free Variables and Substitution

### `freeVariables(expr)`
Returns a `Set` of free variable names in the expression.

### `freshName(name, avoid)`
Generates a fresh variable name by appending apostrophes until it's not in the `avoid` set.

### `substitute(expr, varName, replacement, markAsSubstituted = true, sourceId = null)`
Substitutes `replacement` for `varName` in `expr`. Handles alpha-conversion to avoid capture.

## Variable Usage Detection

### `variableAppearsIn(expr, varName)`
Returns `true` if `varName` appears free in `expr`. Respects shadowing.

### `isArgumentUsed(redexExpr)`
For a redex, returns `true` if the bound variable is used in the body. If `false`, the argument will be discarded during reduction.

### `findVariableUses(expr, varName)`
Returns an array of `Variable` nodes that reference `varName` in `expr`. Respects shadowing.

### `getParameterUses(redexExpr)`
For a redex, returns the `Variable` nodes in the lambda body that will be replaced during reduction.

## Linking Logic

These functions enable UI-agnostic substitution tracking across reduction steps.

### `getSubstitutions(expr)`
Returns a `Map<sourceId, Array<Node>>` of all substituted subtrees grouped by their source redex.

### `getRedexArg(expr, redexId)`
Returns the argument expression for a specific redex ID, or `null` if not found.

### `getRedex(expr, redexId)`
Returns the full redex application node for a specific redex ID, or `null` if not found.

### `getLinkingInfo(beforeExpr, afterExpr, reducedId)`
Returns linking information between two consecutive reduction steps.

```javascript
{
  sourceArg,           // Expression - the argument that was substituted
  substitutedNodes,    // Array<Node> - nodes in afterExpr marked with sourceId
  sourceId,            // Number - the redex ID
  hasSubstitutions,    // Boolean - true if any substitutions occurred
  wasUsed              // Boolean - true if the bound variable was used
}
```

### `getFullLinkingInfo(beforeExpr, afterExpr, reducedId)`
Extended linking info that includes parameter uses (the "middle" of the substitution chain).

```javascript
{
  sourceArg,           // Expression - the argument (yellow box)
  parameterUses,       // Array<Variable> - variable uses in lambda body (blue box)
  substitutedNodes,    // Array<Node> - substituted results (red box)
  sourceId,            // Number - the redex ID
  hasSubstitutions,    // Boolean - true if any substitutions occurred
  wasUsed              // Boolean - true if the bound variable was used
}
```

### `buildLinkingChain(steps)`
Builds linking info for an entire reduction history.

```javascript
const steps = [
  { expr: expr0, reducedId: null },
  { expr: expr1, reducedId: 1 },
  { expr: expr2, reducedId: 2 }
];
const chain = buildLinkingChain(steps);
// Each step now has linkingInfo property
```

## Serialization

### `toPlainString(expr)`
Converts an AST to a canonical string representation. Ensures round-tripping: `parse(toPlainString(ast))` produces an equivalent AST.

## Constants

### `EXAMPLES`
Array of example expressions with `name`, `description`, and `expr` properties.

## Usage Example

```javascript
import {
  parse,
  numberRedexes,
  reduceAt,
  clearSubstitutionMarks,
  getFullLinkingInfo,
  toPlainString
} from './kernel.js';

// Parse and prepare expression
let expr = parse('(\\x.x x) arg');
expr = numberRedexes(expr);

// Get linking info before reduction
const redexId = 1;
const beforeExpr = expr;

// Perform reduction
expr = clearSubstitutionMarks(expr);
expr = numberRedexes(expr);
expr = reduceAt(expr, redexId);
expr = numberRedexes(expr);

// Get full linking info
const linkInfo = getFullLinkingInfo(beforeExpr, expr, redexId);

console.log('Source arg:', toPlainString(linkInfo.sourceArg));
// "arg"

console.log('Parameter uses:', linkInfo.parameterUses.length);
// 2 (x appears twice in "x x")

console.log('Substituted nodes:', linkInfo.substitutedNodes.length);
// 2 (arg was copied twice)

console.log('Result:', toPlainString(expr));
// "(arg arg)"
```

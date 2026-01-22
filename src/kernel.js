// ============================================================================
// Lambda Calculus Kernel - Core AST, Parser, and Beta Reduction
// ============================================================================

// ============================================================================
// AST Node Types
// ============================================================================

export class Variable {
  constructor(name, fromSubstitution = false, sourceId = null) {
    this.type = 'variable';
    this.name = name;
    this.fromSubstitution = fromSubstitution;
    this.sourceId = sourceId; // Track which redex this came from
  }

  clone(fromSubstitution = false, sourceId = null) {
    return new Variable(
      this.name,
      fromSubstitution || this.fromSubstitution,
      sourceId !== null ? sourceId : this.sourceId
    );
  }
}

export class Abstraction {
  constructor(param, body, fromSubstitution = false, sourceId = null) {
    this.type = 'abstraction';
    this.param = param;
    this.body = body;
    this.fromSubstitution = fromSubstitution;
    this.sourceId = sourceId;
  }

  clone(fromSubstitution = false, sourceId = null) {
    return new Abstraction(
      this.param,
      this.body.clone(fromSubstitution, sourceId),
      fromSubstitution || this.fromSubstitution,
      sourceId !== null ? sourceId : this.sourceId
    );
  }
}

export class Application {
  constructor(func, arg, id = null, fromSubstitution = false, sourceId = null) {
    this.type = 'application';
    this.func = func;
    this.arg = arg;
    this.id = id;
    this.fromSubstitution = fromSubstitution;
    this.sourceId = sourceId;
  }

  clone(fromSubstitution = false, sourceId = null) {
    return new Application(
      this.func.clone(fromSubstitution, sourceId),
      this.arg.clone(fromSubstitution, sourceId),
      this.id,
      fromSubstitution || this.fromSubstitution,
      sourceId !== null ? sourceId : this.sourceId
    );
  }
}

// ============================================================================
// Parser
// ============================================================================

// Character predicates
const isWhitespace = (char) => /\s/.test(char);
const isLambdaStart = (char) => char === 'λ' || char === '\\';
const isVariableStart = (char) => /[a-zA-Z]/.test(char);
const isVariableChar = (char) => /[a-zA-Z0-9_']/.test(char);
const isAtomStart = (char) => char === '(' || isLambdaStart(char) || isVariableStart(char);

/**
 * Parses lambda calculus expressions.
 *
 * Grammar:
 *   expr     = atom+                    (left-associative application)
 *   atom     = variable | '(' expr ')' | lambda
 *   lambda   = ('λ' | '\') variable '.' expr
 *   variable = [a-zA-Z][a-zA-Z0-9_']*
 */
class Parser {
  constructor(input) {
    this.source = input.trim();
    this.position = 0;
  }

  // Character access
  currentChar() {
    return this.source[this.position];
  }

  hasMore() {
    return this.position < this.source.length;
  }

  advance() {
    const char = this.source[this.position];
    this.position++;
    return char;
  }

  // Skip over whitespace
  skipWhitespace() {
    while (this.hasMore() && isWhitespace(this.currentChar())) {
      this.advance();
    }
  }

  // Error reporting
  error(message) {
    const context = this.source.slice(Math.max(0, this.position - 10), this.position + 10);
    const pointer = ' '.repeat(Math.min(10, this.position)) + '^';
    return new Error(`${message} at position ${this.position}\n  ${context}\n  ${pointer}`);
  }

  // Parse a variable name (one or more identifier characters)
  parseVariableName() {
    const startPosition = this.position;

    while (this.hasMore() && isVariableChar(this.currentChar())) {
      this.advance();
    }

    const name = this.source.slice(startPosition, this.position);

    if (name.length === 0) {
      throw this.error('Expected variable name');
    }

    return name;
  }

  // Parse an atom: variable, parenthesized expression, or lambda
  parseAtom() {
    this.skipWhitespace();

    const char = this.currentChar();

    // Parenthesized expression
    if (char === '(') {
      this.advance(); // consume '('
      const innerExpr = this.parseExpr();
      this.skipWhitespace();

      if (this.currentChar() !== ')') {
        throw this.error("Expected ')'");
      }
      this.advance(); // consume ')'

      return innerExpr;
    }

    // Lambda abstraction
    if (isLambdaStart(char)) {
      this.advance(); // consume 'λ' or '\'
      this.skipWhitespace();

      const parameterName = this.parseVariableName();
      this.skipWhitespace();

      if (this.currentChar() !== '.') {
        throw this.error("Expected '.' after lambda parameter");
      }
      this.advance(); // consume '.'

      const body = this.parseExpr();

      return new Abstraction(parameterName, body);
    }

    // Variable
    if (isVariableStart(char)) {
      const name = this.parseVariableName();
      return new Variable(name);
    }

    throw this.error(`Unexpected character '${char}'`);
  }

  // Parse an expression: one or more atoms combined via left-associative application
  parseExpr() {
    this.skipWhitespace();

    let result = this.parseAtom();

    // Collect additional atoms and combine via left-associative application
    while (true) {
      this.skipWhitespace();

      const char = this.currentChar();
      const canContinue = this.hasMore() && char !== ')' && isAtomStart(char);

      if (!canContinue) {
        break;
      }

      const nextAtom = this.parseAtom();
      result = new Application(result, nextAtom);
    }

    return result;
  }

  // Main entry point
  parse() {
    const result = this.parseExpr();
    this.skipWhitespace();

    if (this.hasMore()) {
      throw this.error('Unexpected character (expected end of input)');
    }

    return result;
  }
}

export function parse(input) {
  const parser = new Parser(input);
  return parser.parse();
}

// ============================================================================
// Beta Reduction
// ============================================================================

export function freeVariables(expr) {
  switch (expr.type) {
    case 'variable':
      return new Set([expr.name]);
    case 'abstraction':
      const bodyFree = freeVariables(expr.body);
      bodyFree.delete(expr.param);
      return bodyFree;
    case 'application':
      const funcFree = freeVariables(expr.func);
      const argFree = freeVariables(expr.arg);
      return new Set([...funcFree, ...argFree]);
  }
}

export function freshName(name, avoid) {
  let fresh = name;
  while (avoid.has(fresh)) {
    fresh += "'";
  }
  return fresh;
}

export function substitute(expr, varName, replacement, markAsSubstituted = true, sourceId = null) {
  switch (expr.type) {
    case 'variable':
      if (expr.name === varName) {
        return replacement.clone(markAsSubstituted, sourceId);
      }
      return expr;

    case 'abstraction':
      if (expr.param === varName) {
        return expr;
      }
      const replFree = freeVariables(replacement);
      if (replFree.has(expr.param)) {
        const allFree = new Set([...replFree, ...freeVariables(expr.body)]);
        allFree.add(varName);
        const newParam = freshName(expr.param, allFree);
        const renamedBody = substitute(expr.body, expr.param, new Variable(newParam), false, null);
        return new Abstraction(
          newParam,
          substitute(renamedBody, varName, replacement, markAsSubstituted, sourceId),
          expr.fromSubstitution,
          expr.sourceId
        );
      }
      return new Abstraction(
        expr.param,
        substitute(expr.body, varName, replacement, markAsSubstituted, sourceId),
        expr.fromSubstitution,
        expr.sourceId
      );

    case 'application':
      return new Application(
        substitute(expr.func, varName, replacement, markAsSubstituted, sourceId),
        substitute(expr.arg, varName, replacement, markAsSubstituted, sourceId),
        expr.id,
        expr.fromSubstitution,
        expr.sourceId
      );
  }
}

export function isRedex(expr) {
  return expr.type === 'application' && expr.func.type === 'abstraction';
}

export function numberRedexes(expr, counter = { val: 1 }) {
  switch (expr.type) {
    case 'variable':
      return expr;
    case 'abstraction':
      return new Abstraction(
        expr.param,
        numberRedexes(expr.body, counter),
        expr.fromSubstitution,
        expr.sourceId
      );
    case 'application':
      let id = null;
      if (isRedex(expr)) {
        id = counter.val++;
      }
      return new Application(
        numberRedexes(expr.func, counter),
        numberRedexes(expr.arg, counter),
        id,
        expr.fromSubstitution,
        expr.sourceId
      );
  }
}

export function clearSubstitutionMarks(expr) {
  switch (expr.type) {
    case 'variable':
      return new Variable(expr.name, false, null);
    case 'abstraction':
      return new Abstraction(expr.param, clearSubstitutionMarks(expr.body), false, null);
    case 'application':
      return new Application(
        clearSubstitutionMarks(expr.func),
        clearSubstitutionMarks(expr.arg),
        expr.id,
        false,
        null
      );
  }
}

export function reduceAt(expr, targetId) {
  switch (expr.type) {
    case 'variable':
      return expr;
    case 'abstraction':
      return new Abstraction(
        expr.param,
        reduceAt(expr.body, targetId),
        expr.fromSubstitution,
        expr.sourceId
      );
    case 'application':
      if (expr.id === targetId && isRedex(expr)) {
        const lambda = expr.func;
        const result = substitute(lambda.body, lambda.param, expr.arg, true, targetId);
        return result;
      }
      return new Application(
        reduceAt(expr.func, targetId),
        reduceAt(expr.arg, targetId),
        expr.id,
        expr.fromSubstitution,
        expr.sourceId
      );
  }
}

export function getRedexCount(expr) {
  let count = 0;
  function traverse(e) {
    switch (e.type) {
      case 'variable':
        break;
      case 'abstraction':
        traverse(e.body);
        break;
      case 'application':
        if (isRedex(e)) count++;
        traverse(e.func);
        traverse(e.arg);
        break;
    }
  }
  traverse(expr);
  return count;
}

export function getRedexes(expr) {
  const redexes = [];
  function traverse(e) {
    switch (e.type) {
      case 'variable':
        break;
      case 'abstraction':
        traverse(e.body);
        break;
      case 'application':
        if (isRedex(e)) {
          redexes.push({ id: e.id, expr: e });
        }
        traverse(e.func);
        traverse(e.arg);
        break;
    }
  }
  traverse(expr);
  return redexes;
}

export function toPlainString(expr) {
  switch (expr.type) {
    case 'variable':
      return expr.name;
    case 'abstraction':
      return `λ${expr.param}.${toPlainString(expr.body)}`;
    case 'application': {
      // Wrap abstractions in parens to ensure correct round-tripping.
      // Without this, `(λx.x) y` stringifies to `(λx.x y)` which parses as `λx.(x y)`.
      const funcNeedsParens = expr.func.type === 'abstraction';
      const argNeedsParens = expr.arg.type === 'abstraction';
      const funcStr = funcNeedsParens ? `(${toPlainString(expr.func)})` : toPlainString(expr.func);
      const argStr = argNeedsParens ? `(${toPlainString(expr.arg)})` : toPlainString(expr.arg);
      return `(${funcStr} ${argStr})`;
    }
  }
}

// ============================================================================
// Variable Usage Detection
// ============================================================================

/**
 * Check if a variable appears free in an expression.
 * Used to detect when a lambda argument will be discarded.
 */
export function variableAppearsIn(expr, varName) {
  switch (expr.type) {
    case 'variable':
      return expr.name === varName;
    case 'abstraction':
      // Variable is shadowed if it matches the parameter
      if (expr.param === varName) return false;
      return variableAppearsIn(expr.body, varName);
    case 'application':
      return variableAppearsIn(expr.func, varName) || variableAppearsIn(expr.arg, varName);
  }
}

/**
 * For a redex (application where func is abstraction), check if the
 * bound variable is used in the body. If not, the argument will be discarded.
 */
export function isArgumentUsed(redexExpr) {
  if (!isRedex(redexExpr)) return false;
  const lambda = redexExpr.func;
  return variableAppearsIn(lambda.body, lambda.param);
}

/**
 * Find all uses of a variable in an expression.
 * Returns an array of Variable nodes that reference the given variable name.
 * Respects shadowing (inner lambdas with same parameter name).
 */
export function findVariableUses(expr, varName) {
  const uses = [];

  function traverse(e) {
    switch (e.type) {
      case 'variable':
        if (e.name === varName) {
          uses.push(e);
        }
        break;
      case 'abstraction':
        // Stop if variable is shadowed
        if (e.param !== varName) {
          traverse(e.body);
        }
        break;
      case 'application':
        traverse(e.func);
        traverse(e.arg);
        break;
    }
  }

  traverse(expr);
  return uses;
}

/**
 * For a redex, get the parameter uses in the lambda body.
 * These are the Variable nodes that will be replaced during beta reduction.
 * Returns an empty array if the redex is not valid or the variable is not used.
 */
export function getParameterUses(redexExpr) {
  if (!isRedex(redexExpr)) return [];
  const lambda = redexExpr.func;
  return findVariableUses(lambda.body, lambda.param);
}

/**
 * Get linking info extended with parameter uses.
 * This adds the "middle" part of the substitution chain:
 * source arg (yellow) -> parameter uses (blue) -> substituted results (red)
 */
export function getFullLinkingInfo(beforeExpr, afterExpr, reducedId) {
  const redex = getRedex(beforeExpr, reducedId);
  const sourceArg = redex ? redex.arg : null;
  const wasUsed = redex ? isArgumentUsed(redex) : false;
  const parameterUses = redex ? getParameterUses(redex) : [];
  const substitutions = getSubstitutions(afterExpr);
  const substitutedNodes = substitutions.get(reducedId) || [];

  return {
    sourceArg,
    parameterUses,      // Variable nodes in lambda body (blue boxes)
    substitutedNodes,   // Substituted expressions in result (red boxes)
    sourceId: reducedId,
    hasSubstitutions: substitutedNodes.length > 0,
    wasUsed
  };
}

// ============================================================================
// Linking Logic - for tracing substitutions across reduction steps
// ============================================================================

/**
 * Get all substituted subtrees in an expression, grouped by their source redex.
 * Returns a Map from sourceId to array of expression nodes.
 */
export function getSubstitutions(expr) {
  const substitutions = new Map();

  function traverse(e, inSubstitution = false) {
    // If this node starts a substitution (not already inside one)
    if (e.fromSubstitution && !inSubstitution) {
      const sourceId = e.sourceId;
      if (!substitutions.has(sourceId)) {
        substitutions.set(sourceId, []);
      }
      substitutions.get(sourceId).push(e);
      // Mark that we're now inside a substitution
      inSubstitution = true;
    }

    switch (e.type) {
      case 'variable':
        break;
      case 'abstraction':
        traverse(e.body, inSubstitution);
        break;
      case 'application':
        traverse(e.func, inSubstitution);
        traverse(e.arg, inSubstitution);
        break;
    }
  }

  traverse(expr);
  return substitutions;
}

/**
 * Get the argument expression for a specific redex ID in an expression.
 * Returns null if the redex is not found.
 */
export function getRedexArg(expr, redexId) {
  function find(e) {
    switch (e.type) {
      case 'variable':
        return null;
      case 'abstraction':
        return find(e.body);
      case 'application':
        if (e.id === redexId && isRedex(e)) {
          return e.arg;
        }
        return find(e.func) || find(e.arg);
    }
  }
  return find(expr);
}

/**
 * Get the full redex expression (the application) for a specific redex ID.
 * Returns null if the redex is not found.
 */
export function getRedex(expr, redexId) {
  function find(e) {
    switch (e.type) {
      case 'variable':
        return null;
      case 'abstraction':
        return find(e.body);
      case 'application':
        if (e.id === redexId && isRedex(e)) {
          return e;
        }
        return find(e.func) || find(e.arg);
    }
  }
  return find(expr);
}

/**
 * Get linking info between two consecutive steps.
 * Given the expression before reduction and the redex that was reduced,
 * returns info about what was substituted.
 *
 * @param {Object} beforeExpr - Expression before reduction (with redex IDs)
 * @param {Object} afterExpr - Expression after reduction (with substitution marks)
 * @param {number} reducedId - The redex ID that was reduced
 * @returns {Object} Linking info: { sourceArg, substitutedNodes, wasUsed }
 */
export function getLinkingInfo(beforeExpr, afterExpr, reducedId) {
  const redex = getRedex(beforeExpr, reducedId);
  const sourceArg = redex ? redex.arg : null;
  const wasUsed = redex ? isArgumentUsed(redex) : false;
  const substitutions = getSubstitutions(afterExpr);
  const substitutedNodes = substitutions.get(reducedId) || [];

  return {
    sourceArg,
    substitutedNodes,
    sourceId: reducedId,
    hasSubstitutions: substitutedNodes.length > 0,
    wasUsed  // true if the variable was used in the body, false if discarded
  };
}

/**
 * Build a complete chain of substitution links across all steps.
 * Each step contains: { expr, reducedId, linkingInfo }
 *
 * @param {Array} steps - Array of { expr, reducedId } objects
 * @returns {Array} Steps with linking info added
 */
export function buildLinkingChain(steps) {
  return steps.map((step, index) => {
    let linkingInfo = null;

    if (index > 0 && step.reducedId !== null) {
      const prevExpr = steps[index - 1].expr;
      linkingInfo = getLinkingInfo(prevExpr, step.expr, step.reducedId);
    }

    return {
      ...step,
      linkingInfo
    };
  });
}

// ============================================================================
// Example Expressions
// ============================================================================

export const EXAMPLES = [
  {
    name: 'Identity',
    description: 'The simplest function - returns its argument',
    expr: '(\\x.x) hello'
  },
  {
    name: 'K Combinator',
    description: 'Takes two args, returns the first (TRUE in Church encoding)',
    expr: '(\\x.\\y.x) first second'
  },
  {
    name: 'S Combinator',
    description: 'The universal combinator - substitution',
    expr: '(\\x.\\y.\\z.x z (y z)) a b c'
  },
  {
    name: 'Church Numeral 2',
    description: 'Number 2 applied to successor and zero',
    expr: '(\\f.\\x.f (f x)) (\\n.succ n) zero'
  },
  {
    name: 'Boolean AND',
    description: 'TRUE AND FALSE = FALSE',
    expr: '(\\p.\\q.p q p) (\\x.\\y.x) (\\x.\\y.y)'
  },
  {
    name: 'Boolean OR',
    description: 'FALSE OR TRUE = TRUE',
    expr: '(\\p.\\q.p p q) (\\x.\\y.y) (\\x.\\y.x)'
  },
  {
    name: 'Church Addition',
    description: 'Add 2 + 2 in Church numerals',
    expr: '(\\m.\\n.\\f.\\x.m f (n f x)) (\\f.\\x.f (f x)) (\\f.\\x.f (f x)) s z'
  },
  {
    name: 'Omega',
    description: 'Self-application - infinite loop (careful!)',
    expr: '(\\x.x x) (\\x.x x)'
  },
];

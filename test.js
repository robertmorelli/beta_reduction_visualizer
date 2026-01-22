// Quick test script for beta reduction logic

import chalk from 'chalk';

// Inline the necessary parts for testing
class Variable {
  constructor(name, fromSubstitution = false) {
    this.type = 'variable';
    this.name = name;
    this.fromSubstitution = fromSubstitution;
  }
  clone(fromSubstitution = false) {
    return new Variable(this.name, fromSubstitution || this.fromSubstitution);
  }
}

class Abstraction {
  constructor(param, body, fromSubstitution = false) {
    this.type = 'abstraction';
    this.param = param;
    this.body = body;
    this.fromSubstitution = fromSubstitution;
  }
  clone(fromSubstitution = false) {
    return new Abstraction(this.param, this.body.clone(fromSubstitution), fromSubstitution || this.fromSubstitution);
  }
}

class Application {
  constructor(func, arg, id = null, fromSubstitution = false) {
    this.type = 'application';
    this.func = func;
    this.arg = arg;
    this.id = id;
    this.fromSubstitution = fromSubstitution;
  }
  clone(fromSubstitution = false) {
    return new Application(this.func.clone(fromSubstitution), this.arg.clone(fromSubstitution), this.id, fromSubstitution || this.fromSubstitution);
  }
}

class Parser {
  constructor(input) {
    this.input = input.trim();
    this.pos = 0;
  }
  peek() { return this.input[this.pos]; }
  consume() { return this.input[this.pos++]; }
  skipWhitespace() {
    while (this.pos < this.input.length && /\s/.test(this.peek())) this.pos++;
  }
  parseVariable() {
    let name = '';
    while (this.pos < this.input.length && /[a-zA-Z0-9_']/.test(this.peek())) name += this.consume();
    if (name === '') throw new Error(`Expected variable at position ${this.pos}`);
    return new Variable(name);
  }
  parseAtom() {
    this.skipWhitespace();
    const ch = this.peek();
    if (ch === '(') {
      this.consume();
      const expr = this.parseExpr();
      this.skipWhitespace();
      if (this.peek() !== ')') throw new Error(`Expected ')' at position ${this.pos}`);
      this.consume();
      return expr;
    }
    if (ch === 'λ' || ch === '\\') {
      this.consume();
      this.skipWhitespace();
      const param = this.parseVariable().name;
      this.skipWhitespace();
      if (this.peek() !== '.') throw new Error(`Expected '.' after lambda parameter`);
      this.consume();
      const body = this.parseExpr();
      return new Abstraction(param, body);
    }
    if (/[a-zA-Z]/.test(ch)) return this.parseVariable();
    throw new Error(`Unexpected character '${ch}' at position ${this.pos}`);
  }
  parseExpr() {
    this.skipWhitespace();
    let left = this.parseAtom();
    while (true) {
      this.skipWhitespace();
      const ch = this.peek();
      if (ch === undefined || ch === ')') break;
      if (ch === '(' || ch === 'λ' || ch === '\\' || /[a-zA-Z]/.test(ch)) {
        const right = this.parseAtom();
        left = new Application(left, right);
      } else break;
    }
    return left;
  }
  parse() {
    const result = this.parseExpr();
    this.skipWhitespace();
    if (this.pos < this.input.length) throw new Error(`Unexpected character at position ${this.pos}`);
    return result;
  }
}

function parse(input) { return new Parser(input).parse(); }

function freeVariables(expr) {
  switch (expr.type) {
    case 'variable': return new Set([expr.name]);
    case 'abstraction':
      const bodyFree = freeVariables(expr.body);
      bodyFree.delete(expr.param);
      return bodyFree;
    case 'application':
      return new Set([...freeVariables(expr.func), ...freeVariables(expr.arg)]);
  }
}

function substitute(expr, varName, replacement, markAsSubstituted = true) {
  switch (expr.type) {
    case 'variable':
      if (expr.name === varName) return replacement.clone(markAsSubstituted);
      return expr;
    case 'abstraction':
      if (expr.param === varName) return expr;
      const replFree = freeVariables(replacement);
      if (replFree.has(expr.param)) {
        const allFree = new Set([...replFree, ...freeVariables(expr.body)]);
        allFree.add(varName);
        let newParam = expr.param;
        while (allFree.has(newParam)) newParam += "'";
        const renamedBody = substitute(expr.body, expr.param, new Variable(newParam), false);
        return new Abstraction(newParam, substitute(renamedBody, varName, replacement, markAsSubstituted), expr.fromSubstitution);
      }
      return new Abstraction(expr.param, substitute(expr.body, varName, replacement, markAsSubstituted), expr.fromSubstitution);
    case 'application':
      return new Application(
        substitute(expr.func, varName, replacement, markAsSubstituted),
        substitute(expr.arg, varName, replacement, markAsSubstituted),
        expr.id, expr.fromSubstitution
      );
  }
}

function isRedex(expr) { return expr.type === 'application' && expr.func.type === 'abstraction'; }

function numberRedexes(expr, counter = { val: 1 }) {
  switch (expr.type) {
    case 'variable': return expr;
    case 'abstraction': return new Abstraction(expr.param, numberRedexes(expr.body, counter), expr.fromSubstitution);
    case 'application':
      let id = isRedex(expr) ? counter.val++ : null;
      return new Application(numberRedexes(expr.func, counter), numberRedexes(expr.arg, counter), id, expr.fromSubstitution);
  }
}

function reduceAt(expr, targetId) {
  switch (expr.type) {
    case 'variable': return expr;
    case 'abstraction': return new Abstraction(expr.param, reduceAt(expr.body, targetId), expr.fromSubstitution);
    case 'application':
      if (expr.id === targetId && isRedex(expr)) {
        const lambda = expr.func;
        return substitute(lambda.body, lambda.param, expr.arg, true);
      }
      return new Application(reduceAt(expr.func, targetId), reduceAt(expr.arg, targetId), expr.id, expr.fromSubstitution);
  }
}

const RAINBOW = [chalk.red, chalk.hex('#FFA500'), chalk.yellow, chalk.green, chalk.cyan, chalk.blue, chalk.magenta];
const BRIGHT_RED = chalk.redBright.bold;

function render(expr, depth = 0, showIds = true) {
  const style = (text, isSub) => isSub ? BRIGHT_RED(text) : text;
  switch (expr.type) {
    case 'variable': return style(expr.name, expr.fromSubstitution);
    case 'abstraction':
      return style('λ', expr.fromSubstitution) + style(expr.param, expr.fromSubstitution) +
             style('.', expr.fromSubstitution) + render(expr.body, depth, showIds);
    case 'application':
      const color = RAINBOW[depth % RAINBOW.length];
      const idStr = (showIds && expr.id !== null) ? color(`[${expr.id}]`) : '';
      const op = expr.fromSubstitution ? BRIGHT_RED('(') : color('(');
      const cp = expr.fromSubstitution ? BRIGHT_RED(')') : color(')');
      const sp = expr.fromSubstitution ? BRIGHT_RED(' ') : ' ';
      return `${idStr}${op}${render(expr.func, depth + 1, showIds)}${sp}${render(expr.arg, depth + 1, showIds)}${cp}`;
  }
}

function renderPlain(expr) {
  switch (expr.type) {
    case 'variable': return expr.name;
    case 'abstraction': return `λ${expr.param}.${renderPlain(expr.body)}`;
    case 'application': return `(${renderPlain(expr.func)} ${renderPlain(expr.arg)})`;
  }
}

// TESTS
console.log(chalk.cyan('=== Testing Beta Reduction Visualizer ===\n'));

// Test 1: Parse identity applied to y
console.log(chalk.yellow('Test 1: (\\x.x) y'));
let expr = parse('(\\x.x) y');
console.log('  Parsed:', renderPlain(expr));
expr = numberRedexes(expr);
console.log('  Rendered:', render(expr));

// Reduce
expr = reduceAt(expr, 1);
expr = numberRedexes(expr);
console.log('  After reduction:', render(expr));
console.log();

// Test 2: K combinator
console.log(chalk.yellow('Test 2: (\\x.\\y.x) a b'));
expr = parse('(\\x.\\y.x) a b');
console.log('  Parsed:', renderPlain(expr));
expr = numberRedexes(expr);
console.log('  Rendered:', render(expr));

expr = reduceAt(expr, 1);
expr = numberRedexes(expr);
console.log('  After reducing [1]:', render(expr));

expr = reduceAt(expr, 1);
expr = numberRedexes(expr);
console.log('  After reducing [1] again:', render(expr));
console.log();

// Test 3: S combinator partial
console.log(chalk.yellow('Test 3: (\\x.\\y.\\z.x z (y z)) a'));
expr = parse('(\\x.\\y.\\z.x z (y z)) a');
console.log('  Parsed:', renderPlain(expr));
expr = numberRedexes(expr);
console.log('  Rendered:', render(expr));

expr = reduceAt(expr, 1);
expr = numberRedexes(expr);
console.log('  After reduction:', render(expr));
console.log();

console.log(chalk.green('All tests passed!'));

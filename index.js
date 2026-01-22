import chalk from 'chalk';
import * as readline from 'readline';

// ============================================================================
// AST Node Types
// ============================================================================

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
    return new Abstraction(
      this.param,
      this.body.clone(fromSubstitution),
      fromSubstitution || this.fromSubstitution
    );
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
    return new Application(
      this.func.clone(fromSubstitution),
      this.arg.clone(fromSubstitution),
      this.id,
      fromSubstitution || this.fromSubstitution
    );
  }
}

// ============================================================================
// Parser
// ============================================================================

class Parser {
  constructor(input) {
    this.input = input.trim();
    this.pos = 0;
  }

  peek() {
    return this.input[this.pos];
  }

  consume() {
    return this.input[this.pos++];
  }

  skipWhitespace() {
    while (this.pos < this.input.length && /\s/.test(this.peek())) {
      this.pos++;
    }
  }

  parseVariable() {
    let name = '';
    while (this.pos < this.input.length && /[a-zA-Z0-9_']/.test(this.peek())) {
      name += this.consume();
    }
    if (name === '') {
      throw new Error(`Expected variable at position ${this.pos}`);
    }
    return new Variable(name);
  }

  parseAtom() {
    this.skipWhitespace();
    const ch = this.peek();

    if (ch === '(') {
      this.consume();
      const expr = this.parseExpr();
      this.skipWhitespace();
      if (this.peek() !== ')') {
        throw new Error(`Expected ')' at position ${this.pos}`);
      }
      this.consume();
      return expr;
    }

    if (ch === 'λ' || ch === '\\') {
      this.consume();
      this.skipWhitespace();
      const param = this.parseVariable().name;
      this.skipWhitespace();
      if (this.peek() !== '.') {
        throw new Error(`Expected '.' after lambda parameter at position ${this.pos}`);
      }
      this.consume();
      const body = this.parseExpr();
      return new Abstraction(param, body);
    }

    if (/[a-zA-Z]/.test(ch)) {
      return this.parseVariable();
    }

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
      } else {
        break;
      }
    }

    return left;
  }

  parse() {
    const result = this.parseExpr();
    this.skipWhitespace();
    if (this.pos < this.input.length) {
      throw new Error(`Unexpected character at position ${this.pos}`);
    }
    return result;
  }
}

function parse(input) {
  return new Parser(input).parse();
}

// ============================================================================
// Beta Reduction
// ============================================================================

function freeVariables(expr) {
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

function freshName(name, avoid) {
  let fresh = name;
  while (avoid.has(fresh)) {
    fresh += "'";
  }
  return fresh;
}

function substitute(expr, varName, replacement, markAsSubstituted = true) {
  switch (expr.type) {
    case 'variable':
      if (expr.name === varName) {
        return replacement.clone(markAsSubstituted);
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
        const renamedBody = substitute(expr.body, expr.param, new Variable(newParam), false);
        return new Abstraction(
          newParam,
          substitute(renamedBody, varName, replacement, markAsSubstituted),
          expr.fromSubstitution
        );
      }
      return new Abstraction(
        expr.param,
        substitute(expr.body, varName, replacement, markAsSubstituted),
        expr.fromSubstitution
      );

    case 'application':
      return new Application(
        substitute(expr.func, varName, replacement, markAsSubstituted),
        substitute(expr.arg, varName, replacement, markAsSubstituted),
        expr.id,
        expr.fromSubstitution
      );
  }
}

function isRedex(expr) {
  return expr.type === 'application' && expr.func.type === 'abstraction';
}

function numberRedexes(expr, counter = { val: 1 }) {
  switch (expr.type) {
    case 'variable':
      return expr;
    case 'abstraction':
      return new Abstraction(
        expr.param,
        numberRedexes(expr.body, counter),
        expr.fromSubstitution
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
        expr.fromSubstitution
      );
  }
}

function clearSubstitutionMarks(expr) {
  switch (expr.type) {
    case 'variable':
      return new Variable(expr.name, false);
    case 'abstraction':
      return new Abstraction(expr.param, clearSubstitutionMarks(expr.body), false);
    case 'application':
      return new Application(
        clearSubstitutionMarks(expr.func),
        clearSubstitutionMarks(expr.arg),
        expr.id,
        false
      );
  }
}

function reduceAt(expr, targetId) {
  switch (expr.type) {
    case 'variable':
      return expr;
    case 'abstraction':
      return new Abstraction(
        expr.param,
        reduceAt(expr.body, targetId),
        expr.fromSubstitution
      );
    case 'application':
      if (expr.id === targetId && isRedex(expr)) {
        const lambda = expr.func;
        const result = substitute(lambda.body, lambda.param, expr.arg, true);
        return result;
      }
      return new Application(
        reduceAt(expr.func, targetId),
        reduceAt(expr.arg, targetId),
        expr.id,
        expr.fromSubstitution
      );
  }
}

function getRedexCount(expr) {
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

// ============================================================================
// Colored Renderer
// ============================================================================

// Define colors with RGB values for filtering
// Only use colors where red channel < green AND red channel < blue
const RAINBOW_COLORS_WITH_RGB = [
  { fn: chalk.hex('#00FF7F'), r: 0, g: 255, b: 127 },    // spring green
  { fn: chalk.cyan, r: 0, g: 255, b: 255 },              // cyan
  { fn: chalk.hex('#00BFFF'), r: 0, g: 191, b: 255 },    // deep sky blue
  { fn: chalk.hex('#1E90FF'), r: 30, g: 144, b: 255 },   // dodger blue
  { fn: chalk.hex('#6495ED'), r: 100, g: 149, b: 237 },  // cornflower blue
  { fn: chalk.hex('#40E0D0'), r: 64, g: 224, b: 208 },   // turquoise
  { fn: chalk.hex('#3CB371'), r: 60, g: 179, b: 113 },   // medium sea green
];

// Filter to only colors where red < green AND red < blue (should all pass, but verify)
const RAINBOW_COLORS = RAINBOW_COLORS_WITH_RGB
  .filter(c => c.r < c.g && c.r < c.b)
  .map(c => c.fn);

// Use dark red background for substituted elements
const SUBSTITUTION_STYLE = chalk.bgRgb(100, 0, 0);

function getColorForDepth(depth) {
  return RAINBOW_COLORS[depth % RAINBOW_COLORS.length];
}

// Internal render that returns both display string, plain string, and ID positions
function renderInternal(expr, depth = 0) {
  const applySubstitutionStyle = (text, isSubstituted) => {
    if (isSubstituted) {
      return SUBSTITUTION_STYLE(text);
    }
    return text;
  };

  switch (expr.type) {
    case 'variable': {
      const text = expr.name;
      const display = applySubstitutionStyle(text, expr.fromSubstitution);
      return { display, plain: text, ids: [] };
    }

    case 'abstraction': {
      const lambdaText = 'λ';
      const paramText = expr.param;
      const dotText = '.';

      const lambdaDisplay = applySubstitutionStyle(lambdaText, expr.fromSubstitution);
      const paramDisplay = applySubstitutionStyle(paramText, expr.fromSubstitution);
      const dotDisplay = applySubstitutionStyle(dotText, expr.fromSubstitution);

      const body = renderInternal(expr.body, depth);

      const display = lambdaDisplay + paramDisplay + dotDisplay + body.display;
      const plain = lambdaText + paramText + dotText + body.plain;

      // Shift body's ids positions
      const offset = lambdaText.length + paramText.length + dotText.length;
      const ids = body.ids.map(id => ({ ...id, pos: id.pos + offset }));

      return { display, plain, ids };
    }

    case 'application': {
      const color = getColorForDepth(depth);

      const funcResult = renderInternal(expr.func, depth + 1);
      const argResult = renderInternal(expr.arg, depth + 1);

      // Always use rainbow color for parens - never red, even for substituted applications
      const openParen = color('(');
      const closeParen = color(')');

      const display = openParen + funcResult.display + ' ' + argResult.display + closeParen;
      const plain = '(' + funcResult.plain + ' ' + argResult.plain + ')';

      // Collect ids with adjusted positions
      const funcOffset = 1; // '('
      const argOffset = 1 + funcResult.plain.length + 1; // '(' + func + ' '

      let ids = [
        ...funcResult.ids.map(id => ({ ...id, pos: id.pos + funcOffset })),
        ...argResult.ids.map(id => ({ ...id, pos: id.pos + argOffset })),
      ];

      // Add this application's id if it has one
      if (expr.id !== null) {
        ids.unshift({ id: expr.id, pos: 0, color });
      }

      return { display, plain, ids };
    }
  }
}

function render(expr, depth = 0, showIds = true) {
  const result = renderInternal(expr, depth);

  // Build the ID line below the expression
  if (showIds && result.ids.length > 0) {
    // Sort by position
    const sortedIds = [...result.ids].sort((a, b) => a.pos - b.pos);

    // Build ID line with proper spacing
    let idLine = '';
    let currentPos = 0;

    for (const { id, pos, color } of sortedIds) {
      const idStr = `[${id}]`;
      if (pos > currentPos) {
        idLine += ' '.repeat(pos - currentPos);
        currentPos = pos;
      }
      idLine += color(idStr);
      currentPos += idStr.length;
    }

    return result.display + '\n' + idLine;
  }

  return result.display;
}

function renderPlain(expr) {
  switch (expr.type) {
    case 'variable':
      return expr.name;
    case 'abstraction':
      return `λ${expr.param}.${renderPlain(expr.body)}`;
    case 'application':
      return `(${renderPlain(expr.func)} ${renderPlain(expr.arg)})`;
  }
}

// ============================================================================
// Interactive REPL
// ============================================================================

const EXAMPLES = [
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

function printBanner() {
  console.log(chalk.cyan(`
╔═══════════════════════════════════════════════════════════╗
║           ${chalk.bold('Lambda Calculus Beta Reducer')}                    ║
║                                                           ║
║   Watch substitution happen with ${chalk.redBright.bold('colored')} highlighting!   ║
╚═══════════════════════════════════════════════════════════╝
`));
}

function printExampleMenu() {
  console.log(chalk.yellow('Choose an example or enter your own:\n'));
  console.log(chalk.white('  [0]  Custom input\n'));

  EXAMPLES.forEach((ex, i) => {
    const num = chalk.green(`[${i + 1}]`);
    const name = chalk.bold(ex.name);
    const desc = chalk.gray(ex.description);
    console.log(`  ${num}  ${name}`);
    console.log(`      ${desc}`);
    console.log(`      ${chalk.dim(ex.expr)}\n`);
  });
}

function printHelp() {
  console.log(chalk.cyan('\n=== Help ===\n'));
  console.log('Syntax:');
  console.log('  Variables: x, y, z, foo, etc.');
  console.log('  Lambda:    λx.body  or  \\x.body');
  console.log('  Apply:     (f x) or f x');
  console.log('\nCommands:');
  console.log('  Enter a number to reduce that redex');
  console.log('  exit, q, quit - exit the program');
  console.log('  r, reset      - choose new expression');
  console.log('  h, help       - show this help\n');
}

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = (question) => {
    return new Promise((resolve) => {
      rl.question(question, resolve);
    });
  };

  printBanner();
  printExampleMenu();

  let currentExpr = null;

  while (true) {
    try {
      if (currentExpr === null) {
        const input = await prompt(chalk.green('Select [0-' + EXAMPLES.length + ']: '));
        const trimmed = input.trim();

        if (trimmed === 'q' || trimmed === 'quit' || trimmed === 'exit') {
          console.log('Goodbye!');
          break;
        }
        if (trimmed === 'h' || trimmed === 'help') {
          printHelp();
          continue;
        }
        if (trimmed === '') continue;

        const num = parseInt(trimmed, 10);

        // Check if it's a valid example selection
        if (!isNaN(num) && num >= 0 && num <= EXAMPLES.length) {
          let exprString;

          if (num === 0) {
            // Custom input
            const customInput = await prompt(chalk.green('λ> '));
            if (customInput.trim() === '' || customInput.trim() === 'q' || customInput.trim() === 'quit' || customInput.trim() === 'exit') {
              if (customInput.trim() === 'q' || customInput.trim() === 'quit' || customInput.trim() === 'exit') {
                console.log('Goodbye!');
                break;
              }
              continue;
            }
            exprString = customInput.trim();
          } else {
            // Selected an example
            const example = EXAMPLES[num - 1];
            console.log(chalk.cyan(`\n► ${example.name}: ${example.description}\n`));
            exprString = example.expr;
          }

          try {
            currentExpr = parse(exprString);
            currentExpr = numberRedexes(currentExpr);
            console.log('\n' + render(currentExpr) + '\n');

            const redexCount = getRedexCount(currentExpr);
            if (redexCount === 0) {
              console.log(chalk.yellow('No redexes found - expression is in normal form.\n'));
              currentExpr = null;
              printExampleMenu();
            } else {
              console.log(chalk.gray(`${redexCount} redex(es) available.`));
              console.log(chalk.green(`Reduce: [1-${redexCount}]`) + chalk.gray('  |  reset (r)  |  exit\n'));
            }
          } catch (e) {
            console.log(chalk.red(`Parse error: ${e.message}\n`));
          }
        } else {
          console.log(chalk.red(`Please enter a number between 0 and ${EXAMPLES.length}\n`));
        }
      } else {
        const redexCount = getRedexCount(currentExpr);
        const input = await prompt(chalk.green('> '));
        const trimmed = input.trim();

        if (trimmed === 'q' || trimmed === 'quit' || trimmed === 'exit') {
          console.log('Goodbye!');
          break;
        }
        if (trimmed === 'h' || trimmed === 'help') {
          printHelp();
          continue;
        }
        if (trimmed === 'r' || trimmed === 'reset') {
          currentExpr = null;
          console.log();
          printExampleMenu();
          continue;
        }
        if (trimmed === '') {
          console.log('\n' + render(currentExpr) + '\n');
          continue;
        }

        const num = parseInt(trimmed, 10);
        if (isNaN(num) || num < 1 || num > redexCount) {
          console.log(chalk.red(`Please enter a number between 1 and ${redexCount}\n`));
          continue;
        }

        // Perform reduction
        currentExpr = reduceAt(currentExpr, num);
        console.log('\n' + chalk.yellow(`After reducing redex [${num}]:`) + '\n');

        // Show result with substitution highlighting
        currentExpr = numberRedexes(currentExpr);
        console.log(render(currentExpr) + '\n');

        const newRedexCount = getRedexCount(currentExpr);
        if (newRedexCount === 0) {
          console.log(chalk.yellow('Normal form reached!\n'));
          currentExpr = null;
        } else {
          console.log(chalk.gray(`${newRedexCount} redex(es) available.`));
          console.log(chalk.green(`Reduce: [1-${newRedexCount}]`) + chalk.gray('  |  reset (r)  |  exit\n'));
          // Clear substitution marks for next iteration
          currentExpr = clearSubstitutionMarks(currentExpr);
          currentExpr = numberRedexes(currentExpr);
        }
      }
    } catch (e) {
      if (e.code === 'ERR_USE_AFTER_CLOSE') break;
      console.log(chalk.red(`Error: ${e.message}\n`));
    }
  }

  rl.close();
}

main();

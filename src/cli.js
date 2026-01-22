#!/usr/bin/env node
// ============================================================================
// Lambda Calculus CLI - Terminal Visualizer with Colored Output
// ============================================================================

import chalk from 'chalk';
import * as readline from 'readline';
import {
  parse,
  numberRedexes,
  clearSubstitutionMarks,
  reduceAt,
  getRedexCount,
  EXAMPLES
} from './kernel.js';

// ============================================================================
// Rainbow Colors for Terminal
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

// Filter to only colors where red < green AND red < blue
const RAINBOW_COLORS = RAINBOW_COLORS_WITH_RGB
  .filter(c => c.r < c.g && c.r < c.b)
  .map(c => c.fn);

// Use dark red background for substituted elements
const SUBSTITUTION_STYLE = chalk.bgRgb(100, 0, 0);

function getColorForDepth(depth) {
  return RAINBOW_COLORS[depth % RAINBOW_COLORS.length];
}

// ============================================================================
// Colored Renderer
// ============================================================================

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

export function render(expr, depth = 0, showIds = true) {
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

// ============================================================================
// Interactive REPL
// ============================================================================

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
              console.log(chalk.yellow('No redexes found - expression is in normal form.'));
              console.log(chalk.gray('Press any key to exit...'));

              // Wait for any keypress then exit
              process.stdin.setRawMode(true);
              process.stdin.resume();
              await new Promise((resolve) => {
                process.stdin.once('data', resolve);
              });
              console.log('Goodbye!');
              rl.close();
              process.exit(0);
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
          console.log(chalk.yellow('Normal form reached!'));
          console.log(chalk.gray('Press any key to exit...'));

          // Wait for any keypress then exit
          process.stdin.setRawMode(true);
          process.stdin.resume();
          await new Promise((resolve) => {
            process.stdin.once('data', resolve);
          });
          console.log('Goodbye!');
          rl.close();
          process.exit(0);
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

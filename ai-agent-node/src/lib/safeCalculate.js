// A small recursive-descent parser for arithmetic expressions.
// Deliberately does not use eval() or new Function() — the agent passes in
// strings it generated itself based on model output, and that's exactly the
// kind of input you don't want anywhere near a code execution sink.

const TOKEN_RE = /\s*([0-9]*\.?[0-9]+|\+|-|\*|\/|\^|\(|\))\s*/g;

function tokenize(expression) {
  const tokens = [];
  let lastIndex = 0;
  let match;

  TOKEN_RE.lastIndex = 0;
  while ((match = TOKEN_RE.exec(expression)) !== null) {
    if (match.index !== lastIndex) {
      throw new Error(`Unexpected character at position ${lastIndex}`);
    }
    tokens.push(match[1]);
    lastIndex = TOKEN_RE.lastIndex;
  }

  if (lastIndex !== expression.length) {
    throw new Error(`Unexpected character at position ${lastIndex}`);
  }

  return tokens;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek() {
    return this.tokens[this.pos];
  }

  next() {
    return this.tokens[this.pos++];
  }

  parseExpression() {
    let value = this.parseTerm();
    while (this.peek() === "+" || this.peek() === "-") {
      const op = this.next();
      const rhs = this.parseTerm();
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  }

  parseTerm() {
    let value = this.parseFactor();
    while (this.peek() === "*" || this.peek() === "/") {
      const op = this.next();
      const rhs = this.parseFactor();
      if (op === "/") {
        if (rhs === 0) throw new Error("Division by zero");
        value = value / rhs;
      } else {
        value = value * rhs;
      }
    }
    return value;
  }

  parseFactor() {
    let value = this.parsePower();
    return value;
  }

  parsePower() {
    const base = this.parseUnary();
    if (this.peek() === "^") {
      this.next();
      const exponent = this.parsePower(); // right-associative
      return Math.pow(base, exponent);
    }
    return base;
  }

  parseUnary() {
    if (this.peek() === "-") {
      this.next();
      return -this.parseUnary();
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const token = this.next();
    if (token === undefined) {
      throw new Error("Unexpected end of expression");
    }
    if (token === "(") {
      const value = this.parseExpression();
      if (this.next() !== ")") throw new Error("Missing closing parenthesis");
      return value;
    }
    const num = Number(token);
    if (Number.isNaN(num)) throw new Error(`Unexpected token: ${token}`);
    return num;
  }
}

export function safeCalculate(expression) {
  if (typeof expression !== "string" || expression.trim() === "") {
    throw new Error("Expression must be a non-empty string");
  }
  if (expression.length > 200) {
    throw new Error("Expression is too long");
  }

  const tokens = tokenize(expression);
  const parser = new Parser(tokens);
  const result = parser.parseExpression();

  if (parser.pos !== tokens.length) {
    throw new Error(`Unexpected token: ${parser.peek()}`);
  }
  if (!Number.isFinite(result)) {
    throw new Error("Result is not a finite number");
  }
  return result;
}

/** Guard the classic parser's unbounded comment/string scans before calling it. */
export function prepareYarnClassicInput(input: string): string {
  let offset = 0;
  while (offset < input.length) {
    const first = input[offset]!;
    if (first === "#") {
      const newline = input.indexOf("\n", offset);
      offset = newline < 0 ? input.length : newline + 1;
    } else if (first === '"') {
      const start = offset++;
      while (offset < input.length) {
        if (input[offset] === '"' && !(input[offset - 1] === "\\" && input[offset - 2] !== "\\")) break;
        offset++;
      }
      if (offset === input.length) throw new SyntaxError("Unterminated Yarn classic quoted token.");
      // Match the dependency's quote boundaries and reject invalid JSON tokens.
      JSON.parse(input.slice(start, ++offset));
    } else if (/^[0-9]$/u.test(first)) {
      while (offset < input.length && /^[0-9]$/u.test(input[offset]!)) offset++;
    } else if (input.startsWith("true", offset)) {
      offset += 4;
    } else if (input.startsWith("false", offset)) {
      offset += 5;
    } else if (/^[a-zA-Z/-]$/u.test(first)) {
      while (offset < input.length && ![":", " ", "\n", "\r", ","].includes(input[offset]!)) offset++;
    } else if ([" ", "\n", "\r", ":", ","].includes(first)) {
      offset++;
    } else {
      throw new SyntaxError("Invalid Yarn classic token.");
    }
  }
  // The dependency's comment loop requires a newline even at end of file.
  return input.endsWith("\n") ? input : input + "\n";
}

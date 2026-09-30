import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PARSER_FUZZ_SEEDS = [0x0badcafe, 0x13579bdf, 0x2468ace0] as const;
const MAX_TEXT_LENGTH = 8192;
const TOKENS = ["\0", "\ud800", "\r\n", "../", "\"", "'", "{", "}", "[", "]", "<", ">", "&", "*", "#", "=", ":", "λ한글", "\\", " "];
const VALID_TEXT_SEEDS = [
  '{"name":"fuzz","lockfileVersion":3,"packages":{"":{"dependencies":{"example":"1.0.0"}},"node_modules/example":{"version":"1.0.0"}}}',
  '{"bomFormat":"CycloneDX","specVersion":"1.5","version":1,"components":[{"type":"library","name":"example","version":"1.0.0","purl":"pkg:npm/example@1.0.0"}]}',
  'lockfileVersion: 9\nimporters:\n  .:\n    dependencies:\n      example:\n        specifier: 1.0.0\n        version: 1.0.0\npackages:\n  example@1.0.0: {}\n',
  'version = 1\n[[package]]\nname = "example"\nversion = "1.0.0"\n',
  '<project><modelVersion>4.0.0</modelVersion><groupId>org.example</groupId><artifactId>fuzz</artifactId><version>1.0.0</version></project>',
  'module example.test/fuzz\ngo 1.24\nrequire example.test/dependency v1.0.0\n',
  'example==1.0.0\n'
];

export function seededParserInputs(seed: number, count = 32): string[] {
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  const inputs: string[] = [];
  for (let index = 0; index < count; index++) {
    let text = VALID_TEXT_SEEDS[random() % VALID_TEXT_SEEDS.length]!;
    const mutations = 1 + random() % 8;
    for (let mutation = 0; mutation < mutations; mutation++) {
      const position = random() % (text.length + 1);
      const token = TOKENS[random() % TOKENS.length]!;
      switch (random() % 5) {
        case 0: text = text.slice(0, position) + token + text.slice(position); break;
        case 1: text = text.slice(0, position) + text.slice(position + 1 + random() % 8); break;
        case 2: text = text.slice(0, position); break;
        case 3: text = token.repeat(1 + random() % 16) + text; break;
        default: text += "\n" + text.slice(0, position); break;
      }
      text = text.slice(0, MAX_TEXT_LENGTH);
    }
    inputs.push(text);
  }
  return inputs;
}

/** Preserve only synthetic fuzz inputs; never copy project files or environment data. */
export function preserveParserFailure(input: {
  kind: string; seed: number; index: number; text?: string; bytesBase64?: string;
}, cause: unknown): never {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..", ".tmp/parser-fuzz-repro");
  mkdirSync(root, { recursive: true });
  const name = `${input.kind}-${input.seed.toString(16)}-${input.index}.json`;
  writeFileSync(path.join(root, name), JSON.stringify({ ...input,
    failure: cause instanceof Error ? cause.message : String(cause) }, null, 2) + "\n");
  throw new Error(`Parser fuzz failure retained in .tmp/parser-fuzz-repro/${name}: ${String(cause)}`, { cause });
}

/** A synchronous parser timeout can bypass catch; retain its last input first. */
export function recordParserProbe(input: {
  kind: string; seed: number; index?: number; text?: string; status: "running" | "passed";
}): void {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..", ".tmp/parser-fuzz-repro");
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, `probe-${input.kind}-${input.seed.toString(16)}.json`), JSON.stringify(input) + "\n");
}

import { createProcessCommandSignal } from "../src/cli/cancellation";
import type { CliIO } from "../src/cli/main";

async function importCliMain(): Promise<typeof import("../src/cli/main").main> {
  const originalArgv = process.argv.slice();
  process.argv[1] = "__ohrisk_standalone_bootstrap__";

  try {
    return (await import("../src/cli/main")).main;
  } finally {
    process.argv.splice(0, process.argv.length, ...originalArgv);
  }
}

const main = await importCliMain();
const processSignal = createProcessCommandSignal();
const io: CliIO = {
  cwd: process.cwd(),
  stdout: (text) => process.stdout.write(`${text}\n`),
  stderr: (text) => process.stderr.write(`${text}\n`),
  stderrStream: process.stderr,
  env: process.env,
  signal: processSignal.signal
};

try {
  process.exitCode = await main(process.argv.slice(2), io);
} finally {
  processSignal.dispose();
}

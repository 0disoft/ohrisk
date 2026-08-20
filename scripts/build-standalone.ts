import {
  buildStandaloneRelease,
  parseStandaloneBuildArgs
} from "./standalone";

async function run(): Promise<void> {
  try {
    const options = parseStandaloneBuildArgs(
      process.argv.slice(2),
      process.cwd()
    );
    const result = await buildStandaloneRelease(options);
    const smokeCount = result.assets.filter((asset) => asset.smoked).length;

    console.log(
      `Built ${result.assets.length} standalone executable(s) in ${result.outdir}.`
    );
    console.log(`Wrote checksums to ${result.checksumPath}.`);
    console.log(`Native smoke checks passed for ${smokeCount} executable(s).`);
  } catch (cause) {
    console.error(
      cause instanceof Error ? cause.stack ?? cause.message : String(cause)
    );
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await run();
}

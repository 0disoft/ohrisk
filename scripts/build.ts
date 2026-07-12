import { copyFileSync, mkdirSync, rmSync } from "node:fs";

import {
  assertBuiltCliVersion,
  assertVersionContract,
  buildCliBundle
} from "./bundle";

const packageVersion = assertVersionContract();

rmSync("dist", { force: true, recursive: true });
rmSync("action-dist", { force: true, recursive: true });

const packageBundle = await buildCliBundle("dist");
mkdirSync("action-dist", { recursive: true });
copyFileSync(packageBundle, "action-dist/cli.js");

assertBuiltCliVersion(packageBundle, packageVersion);
assertBuiltCliVersion("action-dist/cli.js", packageVersion);

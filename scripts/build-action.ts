import { rmSync } from "node:fs";

import {
  assertBuiltCliVersion,
  assertVersionContract,
  buildCliBundle
} from "./bundle";

const packageVersion = assertVersionContract();
rmSync("action-dist", { force: true, recursive: true });
const bundlePath = await buildCliBundle("action-dist");
assertBuiltCliVersion(bundlePath, packageVersion);

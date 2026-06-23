import { existsSync } from "node:fs";
import path from "node:path";

export function mavenRepositoryRoots(projectRoot: string, extraRoots: string[] = []): string[] {
  const roots = [
    ...extraRoots,
    path.join(projectRoot, ".m2", "repository")
  ];

  const home = process.env.USERPROFILE ?? process.env.HOME;
  if (home) {
    roots.push(path.join(home, ".m2", "repository"));
  }

  return [...new Set(roots.map((root) => path.resolve(root)))];
}

export function findMavenPomInRepository(input: {
  repositoryRoots: string[];
  groupId: string;
  artifactId: string;
  version: string;
}): string | undefined {
  const relativePomPath = path.join(
    ...input.groupId.split("."),
    input.artifactId,
    input.version,
    `${input.artifactId}-${input.version}.pom`
  );

  for (const repositoryRoot of input.repositoryRoots) {
    const candidate = path.join(repositoryRoot, relativePomPath);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

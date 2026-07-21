import {
  collectEcosystemEvidence,
  type EcosystemEvidenceInput
} from "../evidence/ecosystem-collectors";
import type { LicenseEvidence } from "../evidence/types";
import {
  missingExternalMavenPoms,
  type MavenExternalPomDocument,
  type MissingExternalMavenPom
} from "../graph/java-maven-pom";
import { mergeDependencyGraphs, type SourcedDependencyGraph } from "../graph/merge";
import { parseProjectLockfile } from "../graph/project-lockfile";
import type { DependencyGraph, PackageEcosystem } from "../graph/types";
import {
  projectRootForLockfile,
  projectLockfiles,
  type ProjectInput,
  type ProjectLockfile,
  type SupportedLockfileKind
} from "../project/discover";
import { createError, type OhriskError } from "../shared/errors";
import { err, isErr, ok, type Result } from "../shared/result";

export type EcosystemAdapter = {
  id: string;
  lockfileKinds: readonly SupportedLockfileKind[];
  packageEcosystems: readonly PackageEcosystem[];
  discover: (project: ProjectInput) => ProjectLockfile[];
  parse: (
    project: ProjectInput,
    context?: EcosystemParseContext
  ) => Result<DependencyGraph, OhriskError>;
  collectEvidence: (
    input: EcosystemEvidenceInput
  ) => Result<LicenseEvidence, OhriskError> | undefined;
};

export type EcosystemParseContext = {
  scanRootDir: string;
  mavenExternalPoms?: ReadonlyMap<string, MavenExternalPomDocument>;
};

export type RemoteMavenPomFetcher = (
  requests: MissingExternalMavenPom[]
) => Promise<Result<Array<MissingExternalMavenPom & MavenExternalPomDocument>, OhriskError>>;

const MAX_REMOTE_MAVEN_MODEL_POMS = 32;

const DEFAULT_ADAPTERS: readonly EcosystemAdapter[] = [
  adapter("javascript", ["bun", "package-lock", "npm-shrinkwrap", "pnpm-lock", "deno-lock", "yarn-lock", "package-json"], ["npm"]),
  adapter("rust", ["cargo-lock"], ["cargo"]),
  adapter("go", ["go-work", "go-mod"], ["go"]),
  adapter("python", ["pipfile-lock", "pdm-lock", "poetry-lock", "pyproject-toml", "requirements-txt", "uv-lock", "pylock"], ["pypi"]),
  adapter("jvm", ["gradle-lock", "gradle-version-catalog", "maven-pom"], ["maven"]),
  adapter("bazel", ["bazel-module"], ["bazel"]),
  adapter("dotnet", ["nuget-lock", "nuget-assets", "dotnet-project", "nuget-packages-config"], ["nuget"]),
  adapter("cpp", ["conan-lock", "vcpkg-json"], ["conan", "vcpkg"]),
  adapter("conda", ["conda-environment", "conda-lock"], ["conda", "pypi"]),
  adapter("terraform", ["terraform-lock"], ["terraform"]),
  adapter("helm", ["helm-chart-lock", "helm-chart-yaml"], ["helm"]),
  adapter("nix", ["nix-flake-lock"], ["nix"]),
  adapter("unity", ["unity-packages-lock"], ["unity"]),
  adapter("r", ["renv-lock"], ["cran"]),
  adapter("julia", ["julia-manifest"], ["julia"]),
  adapter("haskell", ["stack-lock"], ["hackage"]),
  adapter("perl", ["cpanfile-snapshot"], ["cpan"]),
  adapter("lua", ["luarocks-lock"], ["luarocks"]),
  adapter("dart", ["pubspec-lock"], ["pub"]),
  adapter("swift", ["swift-package-resolved"], ["swift"]),
  adapter("carthage", ["cartfile-resolved"], ["carthage"]),
  adapter("cocoapods", ["podfile-lock"], ["cocoapods"]),
  adapter("elixir", ["mix-lock", "rebar-lock"], ["hex"]),
  adapter("ruby", ["gemfile-lock"], ["gem"]),
  adapter("php", ["composer-lock"], ["composer"]),
  adapter("sbom", ["cyclonedx-json", "cyclonedx-xml", "spdx-json", "spdx-rdf", "spdx-tag-value"], [])
];

const adaptersByLockfileKind = new Map<SupportedLockfileKind, EcosystemAdapter>();
for (const defaultAdapter of DEFAULT_ADAPTERS) {
  registerEcosystemAdapter(defaultAdapter, { replace: true });
}

export type RegisterEcosystemAdapterOptions = {
  replace?: boolean;
};

export function registerEcosystemAdapter(
  adapterToRegister: EcosystemAdapter,
  options: RegisterEcosystemAdapterOptions = {}
): () => void {
  if (!adapterToRegister.id.trim()) {
    throw new Error("Ecosystem adapter id must not be empty.");
  }
  if (adapterToRegister.lockfileKinds.length === 0) {
    throw new Error("Ecosystem adapter must register at least one lockfile kind.");
  }
  if (new Set(adapterToRegister.lockfileKinds).size !== adapterToRegister.lockfileKinds.length) {
    throw new Error("Ecosystem adapter lockfile kinds must be unique.");
  }

  const previous = new Map<SupportedLockfileKind, EcosystemAdapter | undefined>();
  for (const kind of adapterToRegister.lockfileKinds) {
    const existing = adaptersByLockfileKind.get(kind);
    if (existing && existing !== adapterToRegister && !options.replace) {
      throw new Error(
        `Lockfile kind ${kind} is already registered by ecosystem adapter ${existing.id}.`
      );
    }
    previous.set(kind, existing);
  }

  for (const kind of adapterToRegister.lockfileKinds) {
    adaptersByLockfileKind.set(kind, adapterToRegister);
  }

  return () => {
    for (const [kind, priorAdapter] of previous) {
      if (adaptersByLockfileKind.get(kind) !== adapterToRegister) {
        continue;
      }
      if (priorAdapter) {
        adaptersByLockfileKind.set(kind, priorAdapter);
      } else {
        adaptersByLockfileKind.delete(kind);
      }
    }
  };
}

export function ecosystemAdapterForLockfile(
  kind: SupportedLockfileKind
): EcosystemAdapter | undefined {
  return adaptersByLockfileKind.get(kind);
}

export function registeredEcosystemAdapters(): EcosystemAdapter[] {
  return [...new Set(adaptersByLockfileKind.values())];
}

export function discoverProjectLockfiles(project: ProjectInput): ProjectLockfile[] {
  const selected = projectLockfiles(project);
  const discovered = new Map<string, ProjectLockfile>();

  for (const ecosystemAdapter of registeredEcosystemAdapters()) {
    for (const lockfile of ecosystemAdapter.discover(project)) {
      if (!ecosystemAdapter.lockfileKinds.includes(lockfile.kind)) {
        throw new Error(
          `Ecosystem adapter ${ecosystemAdapter.id} discovered undeclared lockfile kind ${lockfile.kind}.`
        );
      }
      if (ecosystemAdapterForLockfile(lockfile.kind) !== ecosystemAdapter) {
        continue;
      }
      discovered.set(`${lockfile.kind}:${lockfile.path}`, lockfile);
    }
  }

  const ordered: ProjectLockfile[] = [];
  for (const lockfile of selected) {
    const key = `${lockfile.kind}:${lockfile.path}`;
    const accepted = discovered.get(key);
    if (accepted) {
      ordered.push(accepted);
      discovered.delete(key);
    }
  }

  return [...ordered, ...discovered.values()];
}

export function collectRegisteredEcosystemEvidence(
  input: EcosystemEvidenceInput
): Result<LicenseEvidence, OhriskError> | undefined {
  for (const ecosystemAdapter of registeredEcosystemAdapters()) {
    if (!ecosystemAdapter.packageEcosystems.includes(input.node.ecosystem)) {
      continue;
    }

    const evidence = ecosystemAdapter.collectEvidence(input);
    if (evidence !== undefined) {
      return evidence;
    }
  }

  return undefined;
}

export function parseProjectDependencyGraph(
  project: ProjectInput,
  context: { mavenExternalPoms?: ReadonlyMap<string, MavenExternalPomDocument> } = {}
): Result<DependencyGraph, OhriskError> {
  const parsedGraphs: SourcedDependencyGraph[] = [];

  for (const lockfile of discoverProjectLockfiles(project)) {
    const parsed = parseSingleLockfile(lockfile, project.rootDir, context);
    if (isErr(parsed)) {
      return parsed;
    }

    parsedGraphs.push({
      graph: parsed.value,
      source: {
        lockfileKind: lockfile.kind,
        lockfilePath: lockfile.path
      }
    });
  }

  if (parsedGraphs.length === 1) {
    return ok(parsedGraphs[0]!.graph);
  }

  return ok(mergeDependencyGraphs(parsedGraphs));
}

export async function parseProjectDependencyGraphWithRemoteMavenPoms(input: {
  project: ProjectInput;
  fetchRemotePoms: RemoteMavenPomFetcher;
  onFetch?: (requests: MissingExternalMavenPom[]) => void;
  maxRemotePoms?: number;
}): Promise<Result<DependencyGraph, OhriskError>> {
  const externalPoms = new Map<string, MavenExternalPomDocument>();
  const maxRemotePoms = input.maxRemotePoms ?? MAX_REMOTE_MAVEN_MODEL_POMS;

  while (true) {
    const parsed = parseProjectDependencyGraph(input.project, {
      ...(externalPoms.size > 0 ? { mavenExternalPoms: externalPoms } : {})
    });
    if (parsed.ok) {
      return parsed;
    }

    const missing = missingExternalMavenPoms(parsed.error)
      .filter((request) => !externalPoms.has(request.dependency));
    if (missing.length === 0) {
      return parsed;
    }
    if (externalPoms.size + missing.length > maxRemotePoms) {
      return err(createError({
        code: "MAVEN_POM_PARSE_FAILED",
        category: "unsupported_input",
        message: "Remote Maven parent and BOM resolution exceeded the supported document limit.",
        details: {
          reason: "remote_maven_model_count",
          actual: externalPoms.size + missing.length,
          limit: maxRemotePoms
        }
      }));
    }

    input.onFetch?.(missing);
    const fetched = await input.fetchRemotePoms(missing);
    if (!fetched.ok) {
      return fetched;
    }

    const requested = new Set(missing.map((request) => request.dependency));
    let added = 0;
    for (const document of fetched.value) {
      if (!requested.has(document.dependency) || externalPoms.has(document.dependency)) {
        continue;
      }
      externalPoms.set(document.dependency, {
        source: document.source,
        text: document.text
      });
      added += 1;
    }
    if (added !== missing.length) {
      return err(createError({
        code: "MAVEN_POM_PARSE_FAILED",
        category: "internal",
        message: "Remote Maven model resolution returned an incomplete document set.",
        details: {
          reason: "remote_maven_model_incomplete",
          requested: missing.length,
          received: added
        }
      }));
    }
  }
}

function parseSingleLockfile(
  lockfile: ProjectLockfile,
  scanRootDir: string,
  context: { mavenExternalPoms?: ReadonlyMap<string, MavenExternalPomDocument> } = {}
): Result<DependencyGraph, OhriskError> {
  const ecosystemAdapter = ecosystemAdapterForLockfile(lockfile.kind);
  if (!ecosystemAdapter) {
    return err(
      createError({
        code: "UNSUPPORTED_LOCKFILE",
        category: "unsupported_input",
        message: `No ecosystem adapter is registered for ${lockfile.kind}.`,
        details: {
          lockfileKind: lockfile.kind,
          lockfilePath: lockfile.path
        }
      })
    );
  }

  return ecosystemAdapter.parse(
    {
      rootDir: projectRootForLockfile(lockfile),
      lockfile
    },
    {
      scanRootDir,
      ...(context.mavenExternalPoms ? { mavenExternalPoms: context.mavenExternalPoms } : {})
    }
  );
}

function adapter(
  id: string,
  lockfileKinds: readonly SupportedLockfileKind[],
  packageEcosystems: readonly PackageEcosystem[]
): EcosystemAdapter {
  const lockfileKindSet = new Set(lockfileKinds);
  const packageEcosystemSet = new Set(packageEcosystems);

  return {
    id,
    lockfileKinds,
    packageEcosystems,
    discover: (project) => projectLockfiles(project)
      .filter((lockfile) => lockfileKindSet.has(lockfile.kind)),
    parse: (project, context) => parseProjectLockfile(project, {
      pythonLocalSourceRootDir: context?.scanRootDir,
      ...(context?.mavenExternalPoms ? { mavenExternalPoms: context.mavenExternalPoms } : {})
    }),
    collectEvidence: (input) => packageEcosystemSet.has(input.node.ecosystem)
      ? collectEcosystemEvidence(input)
      : undefined
  };
}

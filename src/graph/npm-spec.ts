export type NpmDependencyReference = {
  requestedName: string;
  lookupName: string;
  lookupRange: string;
  aliased: boolean;
};

export function resolveNpmDependencyReference(
  requestedName: string,
  range: string
): NpmDependencyReference {
  const alias = parseNpmAliasReference(range);

  if (alias) {
    return {
      requestedName,
      lookupName: alias.name,
      lookupRange: alias.reference,
      aliased: alias.name !== requestedName
    };
  }

  if (range.startsWith("npm:")) {
    const bareRange = range.slice("npm:".length);
    if (bareRange !== "") {
      return {
        requestedName,
        lookupName: requestedName,
        lookupRange: bareRange,
        aliased: false
      };
    }
  }

  return {
    requestedName,
    lookupName: requestedName,
    lookupRange: range,
    aliased: false
  };
}

export function parseNpmAliasReference(
  value: string
): { name: string; reference: string } | undefined {
  if (value.startsWith("npm:")) {
    return parseNpmPackageReference(value);
  }

  const aliasMarker = "@npm:";
  const aliasIndex = value.indexOf(aliasMarker);
  if (aliasIndex <= 0) {
    return undefined;
  }

  return parseNpmPackageReference(value.slice(aliasIndex + 1));
}

export function parseNpmPackageReference(
  value: string
): { name: string; reference: string } | undefined {
  const withoutProtocol = value.startsWith("npm:") ? value.slice("npm:".length) : value;
  const atIndex = withoutProtocol.lastIndexOf("@");

  if (atIndex <= 0) {
    return undefined;
  }

  const name = withoutProtocol.slice(0, atIndex);
  const reference = withoutProtocol.slice(atIndex + 1);

  if (!name || !reference) {
    return undefined;
  }

  return { name, reference };
}

export function formatDependencyPathSegment(input: {
  requestedName: string;
  actualName: string;
  packageId: string;
}): string {
  return input.requestedName === input.actualName
    ? input.packageId
    : `${input.requestedName} -> ${input.packageId}`;
}

export function dependencyInstallName(input: {
  requestedName: string;
  actualName: string;
}): string | undefined {
  return input.requestedName === input.actualName ? undefined : input.requestedName;
}

export function addUniqueInstallName(input: {
  current: string[] | undefined;
  installName: string | undefined;
}): string[] | undefined {
  if (!input.installName) {
    return input.current;
  }

  const current = input.current ?? [];
  return current.includes(input.installName) ? current : [...current, input.installName];
}

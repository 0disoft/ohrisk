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
  const alias = parseNpmPackageReference(range);

  if (range.startsWith("npm:") && alias) {
    return {
      requestedName,
      lookupName: alias.name,
      lookupRange: alias.reference,
      aliased: alias.name !== requestedName
    };
  }

  return {
    requestedName,
    lookupName: requestedName,
    lookupRange: range,
    aliased: false
  };
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

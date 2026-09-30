import { packageUrl } from "./package-url";
import type { DependencyNode } from "./types";

type PackageRecord = Pick<DependencyNode, "id" | "name" | "version" | "ecosystem">;

export function disambiguatePackageRecordIds<T extends PackageRecord>(records: readonly T[]): T[] {
  const owners = new Map<string, Set<string>>();
  const coordinates = records.map((record) => packageUrl({
    ...record, dependencyType: "unknown", direct: false, paths: []
  }));
  for (const [index, record] of records.entries()) {
    const identities = owners.get(record.id) ?? new Set<string>();
    identities.add(coordinates[index]!);
    owners.set(record.id, identities);
  }
  return records.map((record, index) => (owners.get(record.id)?.size ?? 0) > 1
    ? { ...record, id: coordinates[index]! }
    : record);
}

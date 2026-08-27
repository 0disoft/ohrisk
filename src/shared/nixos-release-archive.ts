const NIXOS_RELEASE_ARCHIVE_HOST = "releases.nixos.org";

const RELEASE_ARCHIVE_PATHS = [
  /^\/nixpkgs\/nixpkgs-[A-Za-z0-9._+-]+\.([0-9a-f]{12})\/nixexprs\.tar\.xz$/u,
  /^\/nixos\/[A-Za-z0-9._+-]+\/nixos-[A-Za-z0-9._+-]+\.([0-9a-f]{12})\/nixexprs\.tar\.xz$/u
] as const;

export function isLockedNixosReleaseArchive(url: string, rev: string): boolean {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:"
      || parsed.hostname !== NIXOS_RELEASE_ARCHIVE_HOST
      || parsed.port !== ""
      || parsed.username !== ""
      || parsed.password !== ""
      || parsed.search !== ""
      || parsed.hash !== ""
    ) {
      return false;
    }

    return RELEASE_ARCHIVE_PATHS.some((pattern) => (
      pattern.exec(parsed.pathname)?.[1] === rev.slice(0, 12)
    ));
  } catch {
    return false;
  }
}

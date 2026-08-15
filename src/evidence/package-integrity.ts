import { createHash, timingSafeEqual } from "node:crypto";

import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";

const SUPPORTED_INTEGRITY_DIGEST_BYTES = {
  sha1: 20,
  sha256: 32,
  sha384: 48,
  sha512: 64
} as const;

type SupportedIntegrityAlgorithm = keyof typeof SUPPORTED_INTEGRITY_DIGEST_BYTES;

export function verifyPackageIntegrity(input: {
  packageId: string;
  resolvedDetail: string | undefined;
  integrity: string | undefined;
  artifact: Buffer;
}): Result<void, OhriskError> {
  if (!input.integrity) {
    return ok(undefined);
  }

  const supported = parseSupportedIntegrityEntries(input.integrity);
  if (supported.length === 0) {
    return err(
      createError({
        code: "PACKAGE_INTEGRITY_CHECK_FAILED",
        category: "unsupported_input",
        message: "Package artifact integrity could not be verified because no supported digest was found.",
        details: {
          packageId: input.packageId,
          resolved: input.resolvedDetail,
          integrity: input.integrity,
          supportedAlgorithms: ["sha512", "sha384", "sha256", "sha1"]
        }
      })
    );
  }

  const computed: string[] = [];
  for (const entry of supported) {
    const actualDigest = createHash(entry.algorithm).update(input.artifact).digest();
    const actual = `${entry.algorithm}-${actualDigest.toString("base64")}`;
    computed.push(actual);

    if (
      actualDigest.byteLength === entry.digest.byteLength
      && timingSafeEqual(actualDigest, entry.digest)
    ) {
      return ok(undefined);
    }
  }

  return err(
    createError({
      code: "PACKAGE_INTEGRITY_CHECK_FAILED",
      category: "unsupported_input",
      message: "Package artifact integrity did not match the lockfile digest.",
      details: {
        packageId: input.packageId,
        resolved: input.resolvedDetail,
        integrity: input.integrity,
        computed
      }
    })
  );
}

export function sha256HexIntegrity(sha256: string): string {
  return `sha256-${Buffer.from(sha256, "hex").toString("base64")}`;
}

export function parseSupportedIntegrityEntries(
  integrity: string
): Array<{ algorithm: SupportedIntegrityAlgorithm; digest: Buffer }> {
  return integrity
    .split(/\s+/)
    .map((entry) => {
      const separatorIndex = entry.indexOf("-");
      if (separatorIndex <= 0) {
        return undefined;
      }

      const algorithm = entry.slice(0, separatorIndex);
      const digest = entry.slice(separatorIndex + 1);
      if (!isSupportedIntegrityAlgorithm(algorithm) || digest === "") {
        return undefined;
      }

      const decoded = decodeIntegrityDigest({ algorithm, digest });
      if (!decoded) {
        return undefined;
      }

      return {
        algorithm,
        digest: decoded
      };
    })
    .filter((entry): entry is {
      algorithm: SupportedIntegrityAlgorithm;
      digest: Buffer;
    } => entry !== undefined);
}

function isSupportedIntegrityAlgorithm(value: string): value is SupportedIntegrityAlgorithm {
  return Object.prototype.hasOwnProperty.call(SUPPORTED_INTEGRITY_DIGEST_BYTES, value);
}

function decodeIntegrityDigest(input: {
  algorithm: SupportedIntegrityAlgorithm;
  digest: string;
}): Buffer | undefined {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.digest)) {
    return undefined;
  }

  const paddingStart = input.digest.indexOf("=");
  if (paddingStart !== -1 && !/^=+$/.test(input.digest.slice(paddingStart))) {
    return undefined;
  }

  if (input.digest.length % 4 === 1) {
    return undefined;
  }

  const decoded = Buffer.from(input.digest, "base64");
  if (decoded.byteLength !== SUPPORTED_INTEGRITY_DIGEST_BYTES[input.algorithm]) {
    return undefined;
  }

  const normalizedInput = input.digest.replace(/=+$/, "");
  const normalizedDecoded = decoded.toString("base64").replace(/=+$/, "");
  return normalizedDecoded === normalizedInput ? decoded : undefined;
}

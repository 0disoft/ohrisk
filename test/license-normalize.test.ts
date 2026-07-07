import { describe, expect, test } from "bun:test";

import { normalizeLicenseEvidence } from "../src/license/normalize";
import { parseSpdxExpression } from "../src/license/spdx";

describe("parseSpdxExpression", () => {
  test("parses simple OR expressions", () => {
    expect(parseSpdxExpression("MIT OR Apache-2.0")).toEqual({
      original: "MIT OR Apache-2.0",
      expression: "MIT OR Apache-2.0",
      choices: ["MIT", "Apache-2.0"],
      joiner: "or",
      malformed: false,
      usedAlias: false
    });
  });

  test("normalizes common shorthand OR separators", () => {
    expect(parseSpdxExpression("MIT/Apache-2.0")).toEqual({
      original: "MIT/Apache-2.0",
      expression: "MIT OR Apache-2.0",
      choices: ["MIT", "Apache-2.0"],
      joiner: "or",
      malformed: false,
      usedAlias: true
    });

    expect(parseSpdxExpression("MIT, Apache-2.0")).toEqual({
      original: "MIT, Apache-2.0",
      expression: "MIT OR Apache-2.0",
      choices: ["MIT", "Apache-2.0"],
      joiner: "or",
      malformed: false,
      usedAlias: true
    });
  });

  test("parses simple AND expressions", () => {
    expect(parseSpdxExpression("MIT AND Apache-2.0")).toEqual({
      original: "MIT AND Apache-2.0",
      expression: "MIT AND Apache-2.0",
      choices: ["MIT", "Apache-2.0"],
      joiner: "and",
      malformed: false,
      usedAlias: false
    });
  });

  test("marks mixed AND and OR expressions without pretending to resolve precedence", () => {
    expect(parseSpdxExpression("MIT OR GPL-3.0-only AND Apache-2.0")).toMatchObject({
      original: "MIT OR GPL-3.0-only AND Apache-2.0",
      choices: ["MIT", "GPL-3.0-only", "Apache-2.0"],
      joiner: "mixed",
      malformed: false
    });
  });

  test("normalizes common aliases", () => {
    expect(parseSpdxExpression("MIT License")).toEqual({
      original: "MIT License",
      expression: "MIT",
      choices: ["MIT"],
      joiner: "single",
      malformed: false,
      usedAlias: true
    });

    expect(parseSpdxExpression("Apache License, Version 2.0")).toMatchObject({
      original: "Apache License, Version 2.0",
      expression: "Apache-2.0",
      choices: ["Apache-2.0"],
      malformed: false,
      usedAlias: true
    });

    expect(parseSpdxExpression("BSD 2-Clause")).toMatchObject({
      original: "BSD 2-Clause",
      expression: "BSD-2-Clause",
      choices: ["BSD-2-Clause"],
      malformed: false,
      usedAlias: true
    });

    expect(parseSpdxExpression("ISC License")).toMatchObject({
      original: "ISC License",
      expression: "ISC",
      choices: ["ISC"],
      malformed: false,
      usedAlias: true
    });
  });

  test("normalizes common source-available restriction aliases", () => {
    expect(parseSpdxExpression("Commons Clause")).toMatchObject({
      original: "Commons Clause",
      expression: "Commons-Clause",
      choices: ["Commons-Clause"],
      malformed: false,
      usedAlias: true
    });

    expect(parseSpdxExpression("Business Source License 1.1")).toMatchObject({
      original: "Business Source License 1.1",
      expression: "BUSL-1.1",
      choices: ["BUSL-1.1"],
      malformed: false,
      usedAlias: true
    });

    expect(parseSpdxExpression("BUSL")).toMatchObject({
      original: "BUSL",
      expression: "BUSL-1.1",
      choices: ["BUSL-1.1"],
      malformed: false,
      usedAlias: true
    });

    expect(parseSpdxExpression("Server Side Public License")).toMatchObject({
      original: "Server Side Public License",
      expression: "SSPL-1.0",
      choices: ["SSPL-1.0"],
      malformed: false,
      usedAlias: true
    });

    expect(parseSpdxExpression("SSPL")).toMatchObject({
      original: "SSPL",
      expression: "SSPL-1.0",
      choices: ["SSPL-1.0"],
      malformed: false,
      usedAlias: true
    });

    expect(parseSpdxExpression("Elastic License")).toMatchObject({
      original: "Elastic License",
      expression: "Elastic-2.0",
      choices: ["Elastic-2.0"],
      malformed: false,
      usedAlias: true
    });
  });

  test("normalizes SPDX exception expressions to their base license", () => {
    expect(parseSpdxExpression("GPL-2.0-only WITH Classpath-exception-2.0")).toEqual({
      original: "GPL-2.0-only WITH Classpath-exception-2.0",
      expression: "GPL-2.0-only",
      choices: ["GPL-2.0-only"],
      joiner: "single",
      malformed: false,
      usedAlias: true
    });
  });

  test("recognizes UNLICENSED as a license decision instead of malformed text", () => {
    expect(parseSpdxExpression("UNLICENSED")).toEqual({
      original: "UNLICENSED",
      expression: "UNLICENSED",
      choices: ["UNLICENSED"],
      joiner: "single",
      malformed: false,
      usedAlias: false
    });
  });

  test("marks malformed expressions", () => {
    const parsed = parseSpdxExpression("not a license ???");

    expect(parsed.malformed).toBe(true);
    expect(parsed.original).toBe("not a license ???");
  });
});

describe("normalizeLicenseEvidence", () => {
  test("uses package.json license as high-confidence expression", () => {
    expect(
      normalizeLicenseEvidence({
        packageId: "dual-license@2.0.0",
        packageJsonLicense: "MIT OR Apache-2.0",
        files: [],
        source: "local",
        warnings: []
      })
    ).toEqual({
      packageId: "dual-license@2.0.0",
      original: "MIT OR Apache-2.0",
      expression: "MIT OR Apache-2.0",
      choices: ["MIT", "Apache-2.0"],
      joiner: "or",
      signals: [],
      evidenceSources: ["source: local", "package.json license: MIT OR Apache-2.0"],
      confidence: "high"
    });
  });

  test("uses slash-separated package.json licenses as medium-confidence expression aliases", () => {
    expect(
      normalizeLicenseEvidence({
        packageId: "slash-dual-license@1.0.0",
        packageJsonLicense: "MIT/Apache-2.0",
        files: [],
        source: "local",
        warnings: []
      })
    ).toEqual({
      packageId: "slash-dual-license@1.0.0",
      original: "MIT/Apache-2.0",
      expression: "MIT OR Apache-2.0",
      choices: ["MIT", "Apache-2.0"],
      joiner: "or",
      signals: [],
      evidenceSources: ["source: local", "package.json license: MIT/Apache-2.0"],
      confidence: "medium"
    });
  });

  test("marks notice files as notice-required", () => {
    const normalized = normalizeLicenseEvidence({
      packageId: "notice-package@1.0.0",
      packageJsonLicense: "Apache-2.0",
      files: [
        {
          path: "NOTICE",
          kind: "notice",
          text: "Notice text"
        }
      ],
      source: "local",
      warnings: []
    });

    expect(normalized.signals).toContain("notice-required");
  });

  test("marks missing license fields as low-confidence evidence", () => {
    expect(
      normalizeLicenseEvidence({
        packageId: "missing-license@1.0.0",
        files: [
          {
            path: "LICENSE",
            kind: "license",
            text: "Custom terms"
          }
        ],
        source: "local",
        warnings: []
      })
    ).toEqual({
      packageId: "missing-license@1.0.0",
      choices: [],
      joiner: "single",
      signals: ["missing", "custom-text"],
      evidenceSources: ["source: local", "file: LICENSE (license)"],
      confidence: "low"
    });
  });

  test("treats local private packages without license metadata as internal evidence", () => {
    expect(
      normalizeLicenseEvidence({
        packageId: "private-local-package@1.0.0",
        packageJsonPrivate: true,
        files: [],
        source: "local",
        warnings: [
          "No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found."
        ]
      })
    ).toEqual({
      packageId: "private-local-package@1.0.0",
      choices: [],
      joiner: "single",
      signals: ["internal-private"],
      evidenceSources: [
        "source: local",
        "package.json private: true",
        "warning: No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found."
      ],
      confidence: "high"
    });
  });

  test("treats SPDX absent-license markers as missing metadata", () => {
    expect(
      normalizeLicenseEvidence({
        packageId: "noassertion-license@1.0.0",
        metadataLicense: "NOASSERTION",
        metadataSource: "SPDX",
        files: [],
        source: "sbom",
        warnings: []
      })
    ).toEqual({
      packageId: "noassertion-license@1.0.0",
      choices: [],
      joiner: "single",
      signals: ["missing"],
      evidenceSources: ["source: sbom", "SPDX license: NOASSERTION"],
      confidence: "low"
    });

    expect(
      normalizeLicenseEvidence({
        packageId: "none-license-file-fallback@1.0.0",
        packageJsonLicense: "NONE",
        files: [
          {
            path: "LICENSE",
            kind: "license",
            text: "SPDX-License-Identifier: MIT\n"
          }
        ],
        source: "local",
        warnings: []
      })
    ).toMatchObject({
      packageId: "none-license-file-fallback@1.0.0",
      original: "MIT",
      expression: "MIT",
      choices: ["MIT"],
      signals: [],
      confidence: "medium"
    });
  });

  test("uses recognizable license file text when package license metadata is absent", () => {
    expect(
      normalizeLicenseEvidence({
        packageId: "license-file-only@1.0.0",
        files: [
          {
            path: "LICENSE",
            kind: "license",
            text: [
              "MIT License",
              "",
              "Copyright fixture.",
              "",
              "Permission is hereby granted, free of charge, to any person obtaining a copy",
              "of this software and associated documentation files (the \"Software\"), to deal",
              "in the Software without restriction.",
              "",
              "THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND."
            ].join("\n")
          }
        ],
        source: "local",
        warnings: []
      })
    ).toEqual({
      packageId: "license-file-only@1.0.0",
      original: "MIT",
      expression: "MIT",
      choices: ["MIT"],
      joiner: "single",
      signals: [],
      evidenceSources: [
        "source: local",
        "file: LICENSE (license)",
        "file license match: MIT from LICENSE"
      ],
      confidence: "medium"
    });
  });

  test("uses SPDX license identifiers from license files", () => {
    expect(
      normalizeLicenseEvidence({
        packageId: "spdx-identifier-file-only@1.0.0",
        files: [
          {
            path: "LICENSE",
            kind: "license",
            text: "SPDX-License-Identifier: MIT OR Apache-2.0\n"
          }
        ],
        source: "tarball",
        warnings: []
      })
    ).toEqual({
      packageId: "spdx-identifier-file-only@1.0.0",
      original: "MIT OR Apache-2.0",
      expression: "MIT OR Apache-2.0",
      choices: ["MIT", "Apache-2.0"],
      joiner: "or",
      signals: [],
      evidenceSources: [
        "source: tarball",
        "file: LICENSE (license)",
        "file license match: MIT OR Apache-2.0 from LICENSE"
      ],
      confidence: "medium"
    });
  });

  test("reads deprecated package.json license objects", () => {
    const normalized = normalizeLicenseEvidence({
      packageId: "legacy-license-object@1.0.0",
      packageJsonLicenses: { type: "BSD" },
      files: [],
      source: "local",
      warnings: []
    });

    expect(normalized).toMatchObject({
      original: "BSD",
      expression: "BSD-3-Clause",
      choices: ["BSD-3-Clause"],
      confidence: "medium"
    });
  });

  test("keeps custom license-file evidence when package license text is malformed", () => {
    const normalized = normalizeLicenseEvidence({
      packageId: "see-license-package@1.0.0",
      packageJsonLicense: "SEE LICENSE IN LICENSE",
      files: [
        {
          path: "LICENSE",
          kind: "license",
          text: "Custom license terms."
        }
      ],
      source: "local",
      warnings: []
    });

    expect(normalized).toMatchObject({
      original: "SEE LICENSE IN LICENSE",
      choices: ["SEE LICENSE IN LICENSE"],
      signals: ["malformed", "custom-text"],
      confidence: "low"
    });
  });

  test("uses recognizable license file text when package license metadata points to a file", () => {
    const normalized = normalizeLicenseEvidence({
      packageId: "see-standard-license-package@1.0.0",
      packageJsonLicense: "SEE LICENSE IN LICENSE",
      files: [
        {
          path: "LICENSE",
          kind: "license",
          text: [
            "Apache License",
            "Version 2.0, January 2004",
            "",
            "TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION"
          ].join("\n")
        }
      ],
      source: "local",
      warnings: []
    });

    expect(normalized).toEqual({
      packageId: "see-standard-license-package@1.0.0",
      original: "Apache-2.0",
      expression: "Apache-2.0",
      choices: ["Apache-2.0"],
      joiner: "single",
      signals: [],
      evidenceSources: [
        "source: local",
        "package.json license: SEE LICENSE IN LICENSE",
        "file: LICENSE (license)",
        "file license match: Apache-2.0 from LICENSE"
      ],
      confidence: "medium"
    });
  });

  test("recognizes common GPL v2 family license file text", () => {
    expect(
      normalizeLicenseEvidence({
        packageId: "gpl2-file-only@1.0.0",
        files: [
          {
            path: "COPYING",
            kind: "copying",
            text: [
              "GNU GENERAL PUBLIC LICENSE",
              "Version 2, June 1991",
              "",
              "TERMS AND CONDITIONS FOR COPYING, DISTRIBUTION AND MODIFICATION"
            ].join("\n")
          }
        ],
        source: "local",
        warnings: []
      })
    ).toMatchObject({
      packageId: "gpl2-file-only@1.0.0",
      original: "GPL-2.0-only",
      expression: "GPL-2.0-only",
      choices: ["GPL-2.0-only"],
      confidence: "medium"
    });

    expect(
      normalizeLicenseEvidence({
        packageId: "lgpl21-file-only@1.0.0",
        files: [
          {
            path: "COPYING.LESSER",
            kind: "copying",
            text: [
              "GNU LESSER GENERAL PUBLIC LICENSE",
              "Version 2.1, February 1999",
              "",
              "TERMS AND CONDITIONS FOR COPYING, DISTRIBUTION AND MODIFICATION"
            ].join("\n")
          }
        ],
        source: "local",
        warnings: []
      })
    ).toMatchObject({
      packageId: "lgpl21-file-only@1.0.0",
      original: "LGPL-2.1-only",
      expression: "LGPL-2.1-only",
      choices: ["LGPL-2.1-only"],
      confidence: "medium"
    });
  });

  test("recognizes public-domain-style license file text", () => {
    expect(
      normalizeLicenseEvidence({
        packageId: "unlicense-file-only@1.0.0",
        files: [
          {
            path: "UNLICENSE",
            kind: "license",
            text: [
              "This is free and unencumbered software released into the public domain.",
              "",
              "Anyone is free to copy, modify, publish, use, compile, sell, or distribute this software."
            ].join("\n")
          }
        ],
        source: "local",
        warnings: []
      })
    ).toMatchObject({
      packageId: "unlicense-file-only@1.0.0",
      original: "Unlicense",
      expression: "Unlicense",
      choices: ["Unlicense"],
      confidence: "medium"
    });

    expect(
      normalizeLicenseEvidence({
        packageId: "cc0-file-only@1.0.0",
        files: [
          {
            path: "LICENSE",
            kind: "license",
            text: [
              "Creative Commons Legal Code",
              "",
              "CC0 1.0 Universal",
              "",
              "CREATIVE COMMONS CORPORATION IS NOT A LAW FIRM."
            ].join("\n")
          }
        ],
        source: "local",
        warnings: []
      })
    ).toMatchObject({
      packageId: "cc0-file-only@1.0.0",
      original: "CC0-1.0",
      expression: "CC0-1.0",
      choices: ["CC0-1.0"],
      confidence: "medium"
    });
  });

  test("recognizes Zlib license file text", () => {
    expect(
      normalizeLicenseEvidence({
        packageId: "zlib-file-only@1.0.0",
        files: [
          {
            path: "LICENSE",
            kind: "license",
            text: [
              "This software is provided 'as-is', without any express or implied warranty.",
              "In no event will the authors be held liable for any damages arising from the use of this software.",
              "",
              "Permission is granted to anyone to use this software for any purpose,",
              "including commercial applications, and to alter it and redistribute it freely.",
              "",
              "The origin of this software must not be misrepresented; you must not claim that",
              "you wrote the original software."
            ].join("\n")
          }
        ],
        source: "local",
        warnings: []
      })
    ).toMatchObject({
      packageId: "zlib-file-only@1.0.0",
      original: "Zlib",
      expression: "Zlib",
      choices: ["Zlib"],
      confidence: "medium"
    });
  });

  test("does not treat Unlicense commercial and non-commercial permission as a ban", () => {
    const normalized = normalizeLicenseEvidence({
      packageId: "git.sr.ht/~jackmordaunt/go-toast/v2@v2.0.3",
      files: [
        {
          path: "LICENSE",
          kind: "license",
          text: [
            "SPDX-License-Identifier: Unlicense OR MIT",
            "",
            "The UNLICENSE",
            "",
            "This is free and unencumbered software released into the public domain.",
            "",
            "Anyone is free to copy, modify, publish, use, compile, sell, or",
            "distribute this software, either in source code form or as a compiled",
            "binary, for any purpose, commercial or non-commercial, and by any",
            "means."
          ].join("\n")
        }
      ],
      source: "local",
      warnings: []
    });

    expect(normalized).toMatchObject({
      packageId: "git.sr.ht/~jackmordaunt/go-toast/v2@v2.0.3",
      original: "Unlicense OR MIT",
      expression: "Unlicense OR MIT",
      choices: ["Unlicense", "MIT"],
      signals: [],
      confidence: "medium"
    });
    expect(normalized.evidenceSources).toContain("file license match: Unlicense OR MIT from LICENSE");
  });

  test("recognizes MPL text before secondary-license compatibility references", () => {
    const normalized = normalizeLicenseEvidence({
      packageId: "github.com/hashicorp/golang-lru/v2@v2.0.7",
      files: [
        {
          path: "LICENSE",
          kind: "license",
          text: [
            "Copyright (c) 2014 HashiCorp, Inc.",
            "",
            "Mozilla Public License, version 2.0",
            "",
            "1.12. \"Secondary License\"",
            "",
            "means either the GNU General Public License, Version 2.0, the GNU Lesser",
            "General Public License, Version 2.1, the GNU Affero General Public",
            "License, Version 3.0, or any later versions of those licenses.",
            "",
            "Exhibit B - \"Incompatible With Secondary Licenses\" Notice",
            "",
            "This Source Code Form is \"Incompatible With Secondary Licenses\", as defined by",
            "the Mozilla Public License, v. 2.0."
          ].join("\n")
        }
      ],
      source: "local",
      warnings: []
    });

    expect(normalized).toMatchObject({
      packageId: "github.com/hashicorp/golang-lru/v2@v2.0.7",
      original: "MPL-2.0",
      expression: "MPL-2.0",
      choices: ["MPL-2.0"],
      signals: [],
      confidence: "medium"
    });
    expect(normalized.evidenceSources).toContain("file license match: MPL-2.0 from LICENSE");
  });

  test("does not mark MIT-CMU name and advertising restrictions as commercial-use restrictions", () => {
    const normalized = normalizeLicenseEvidence({
      packageId: "pillow@12.2.0",
      metadataLicense: "MIT-CMU",
      metadataSource: "METADATA",
      files: [
        {
          path: "licenses/LICENSE",
          kind: "license",
          text: [
            "Like PIL, Pillow is licensed under the open source MIT-CMU License:",
            "",
            "Permission to use, copy, modify and distribute this software and its",
            "documentation for any purpose and without fee is hereby granted,",
            "provided that the above copyright notice appears in all copies, and that",
            "both that copyright notice and this permission notice appear in supporting",
            "documentation, and that the name of Secret Labs AB or the author not be",
            "used in advertising or publicity pertaining to distribution of the software",
            "without specific, written prior permission."
          ].join("\n")
        }
      ],
      source: "local",
      warnings: []
    });

    expect(normalized).toMatchObject({
      packageId: "pillow@12.2.0",
      original: "MIT-CMU",
      expression: "MIT-CMU",
      choices: ["MIT-CMU"],
      signals: [],
      confidence: "high"
    });
    expect(normalized.evidenceSources).toContain("METADATA license: MIT-CMU");
    expect(normalized.evidenceSources).toContain("file: licenses/LICENSE (license)");
  });

  test("does not treat FreeType commercial-product permission and name-use rules as a ban", () => {
    const normalized = normalizeLicenseEvidence({
      packageId: "freetype-bundled@2.14.3",
      packageJsonLicense: "FTL",
      files: [
        {
          path: "licenses/LICENSE",
          kind: "license",
          text: [
            "We specifically permit and encourage the inclusion of this",
            "software, with or without modifications, in commercial products.",
            "",
            "Neither the FreeType authors and contributors nor you shall use",
            "the name of the other for commercial, advertising, or promotional",
            "purposes without specific prior written permission."
          ].join("\n")
        }
      ],
      source: "local",
      warnings: []
    });

    expect(normalized.signals).not.toContain("commercial-restriction");
  });

  test("marks explicit commercial restriction text in license files", () => {
    const normalized = normalizeLicenseEvidence({
      packageId: "commons-clause-package@1.0.0",
      packageJsonLicense: "SEE LICENSE IN LICENSE",
      files: [
        {
          path: "LICENSE",
          kind: "license",
          text: "The software is provided under the Commons Clause License Condition."
        }
      ],
      source: "local",
      warnings: []
    });

    expect(normalized.signals).toEqual(["commercial-restriction", "malformed", "custom-text"]);
    expect(normalized.confidence).toBe("low");
  });

  test("marks explicit commercial-purpose denial text in license files", () => {
    const normalized = normalizeLicenseEvidence({
      packageId: "commercial-purpose-denial@1.0.0",
      packageJsonLicense: "MIT",
      files: [
        {
          path: "LICENSE",
          kind: "license",
          text: "This package may not be used for commercial purposes without a commercial license."
        }
      ],
      source: "local",
      warnings: []
    });

    expect(normalized.signals).toContain("commercial-restriction");
  });

  test("preserves commercial restriction signals even when package metadata is parseable", () => {
    const normalized = normalizeLicenseEvidence({
      packageId: "metadata-mit-restricted-file@1.0.0",
      packageJsonLicense: "MIT",
      files: [
        {
          path: "LICENSE",
          kind: "license",
          text: "Commercial use is prohibited."
        }
      ],
      source: "local",
      warnings: []
    });

    expect(normalized).toMatchObject({
      packageId: "metadata-mit-restricted-file@1.0.0",
      original: "MIT",
      expression: "MIT",
      choices: ["MIT"],
      joiner: "single",
      signals: ["commercial-restriction"],
      confidence: "high"
    });
    expect(normalized.evidenceSources).toContain("package.json license: MIT");
    expect(normalized.evidenceSources).toContain("file: LICENSE (license)");
  });

  test("marks explicit commercial restriction text in package license metadata", () => {
    const normalized = normalizeLicenseEvidence({
      packageId: "metadata-restricted-package@1.0.0",
      packageJsonLicense: "not for commercial use",
      files: [],
      source: "registry",
      warnings: []
    });

    expect(normalized).toMatchObject({
      packageId: "metadata-restricted-package@1.0.0",
      original: "not for commercial use",
      choices: ["not for commercial use"],
      signals: ["commercial-restriction", "malformed"],
      confidence: "low"
    });
  });
});

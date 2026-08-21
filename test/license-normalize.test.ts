import { describe, expect, test } from "bun:test";

import { normalizeLicenseEvidence } from "../src/license/normalize";
import { parseSpdxExpression } from "../src/license/spdx";

describe("parseSpdxExpression", () => {
  test("parses simple OR expressions", () => {
    expect(parseSpdxExpression("MIT OR Apache-2.0")).toMatchObject({
      original: "MIT OR Apache-2.0",
      expression: "MIT OR Apache-2.0",
      choices: ["MIT", "Apache-2.0"],
      joiner: "or",
      malformed: false,
      usedAlias: false
    });
  });

  test("normalizes common shorthand OR separators", () => {
    expect(parseSpdxExpression("MIT/Apache-2.0")).toMatchObject({
      original: "MIT/Apache-2.0",
      expression: "MIT OR Apache-2.0",
      choices: ["MIT", "Apache-2.0"],
      joiner: "or",
      malformed: false,
      usedAlias: true
    });

    expect(parseSpdxExpression("MIT, Apache-2.0")).toMatchObject({
      original: "MIT, Apache-2.0",
      expression: "MIT OR Apache-2.0",
      choices: ["MIT", "Apache-2.0"],
      joiner: "or",
      malformed: false,
      usedAlias: true
    });
  });

  test("parses simple AND expressions", () => {
    expect(parseSpdxExpression("MIT AND Apache-2.0")).toMatchObject({
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
    expect(parseSpdxExpression("MIT License")).toMatchObject({
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

    expect(parseSpdxExpression("Eclipse Public License - v 2.0")).toMatchObject({
      original: "Eclipse Public License - v 2.0",
      expression: "EPL-2.0",
      choices: ["EPL-2.0"],
      malformed: false,
      usedAlias: true
    });

    expect(parseSpdxExpression("GNU Lesser General Public License v2.1 only")).toMatchObject({
      original: "GNU Lesser General Public License v2.1 only",
      expression: "LGPL-2.1-only",
      choices: ["LGPL-2.1-only"],
      malformed: false,
      usedAlias: true
    });

    for (const [input, expression] of [
      ["The Apache Software License, Version 2.0", "Apache-2.0"],
      ["The MIT License (MIT)", "MIT"],
      ["EPL 2.0", "EPL-2.0"],
      ["GPL2 w/ CPE", "GPL-2.0-with-classpath-exception"],
      ["Eclipse Distribution License - v 1.0", "BSD-3-Clause"],
      ["Modified BSD", "BSD-3-Clause"],
      ["MPL 1.1", "MPL-1.1"]
    ] as const) {
      expect(parseSpdxExpression(input)).toMatchObject({
        expression,
        choices: [expression],
        malformed: false,
        usedAlias: true
      });
    }
  });

  test("normalizes Maven Central license names and full exception expressions", () => {
    for (const [input, expression, choices, exceptions] of [
      [
        "GNU General Public License, Version 3.0",
        "GPL-3.0-only",
        ["GPL-3.0-only"],
        []
      ],
      [
        "Eclipse Public License v2.0",
        "EPL-2.0",
        ["EPL-2.0"],
        []
      ],
      [
        "The GNU General Public License, v2 with Universal FOSS Exception, v1.0",
        "GPL-2.0-only WITH Universal-FOSS-exception-1.0",
        ["GPL-2.0-only"],
        ["Universal-FOSS-exception-1.0"]
      ]
    ] as const) {
      expect(parseSpdxExpression(input)).toMatchObject({
        original: input,
        expression,
        choices,
        exceptions,
        malformed: false,
        usedAlias: true
      });
    }
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

  test("preserves SPDX exceptions on the license term", () => {
    const parsed = parseSpdxExpression("GPL-2.0-only WITH Classpath-exception-2.0");

    expect(parsed).toMatchObject({
      original: "GPL-2.0-only WITH Classpath-exception-2.0",
      expression: "GPL-2.0-only WITH Classpath-exception-2.0",
      choices: ["GPL-2.0-only"],
      joiner: "single",
      malformed: false,
      usedAlias: false,
      exceptions: ["Classpath-exception-2.0"]
    });
    expect(parsed.ast).toEqual({
      type: "license",
      license: "GPL-2.0-only",
      exception: "Classpath-exception-2.0"
    });
  });

  test("parses local and external SPDX LicenseRef expressions", () => {
    expect(parseSpdxExpression("LicenseRef-Proprietary")).toMatchObject({
      expression: "LicenseRef-Proprietary",
      choices: ["LicenseRef-Proprietary"],
      malformed: false
    });
    expect(parseSpdxExpression("DocumentRef-vendor:LicenseRef-Proprietary")).toMatchObject({
      expression: "DocumentRef-vendor:LicenseRef-Proprietary",
      choices: ["DocumentRef-vendor:LicenseRef-Proprietary"],
      malformed: false
    });
  });

  test("preserves operator precedence and parenthesized grouping", () => {
    expect(parseSpdxExpression("MIT OR GPL-3.0-only AND Apache-2.0").ast).toEqual({
      type: "or",
      left: { type: "license", license: "MIT" },
      right: {
        type: "and",
        left: { type: "license", license: "GPL-3.0-only" },
        right: { type: "license", license: "Apache-2.0" }
      }
    });

    expect(parseSpdxExpression("(MIT OR GPL-3.0-only) AND Apache-2.0").ast).toEqual({
      type: "and",
      left: {
        type: "or",
        left: { type: "license", license: "MIT" },
        right: { type: "license", license: "GPL-3.0-only" }
      },
      right: { type: "license", license: "Apache-2.0" }
    });
  });

  test("recognizes UNLICENSED as a license decision instead of malformed text", () => {
    expect(parseSpdxExpression("UNLICENSED")).toMatchObject({
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

  test("rejects shape-valid identifiers missing from the pinned SPDX catalog", () => {
    expect(parseSpdxExpression("Definitely-Not-A-License-1.0")).toMatchObject({
      malformed: true
    });
    expect(parseSpdxExpression("MIT WITH Imaginary-exception")).toMatchObject({
      malformed: true
    });
    expect(parseSpdxExpression("3D-Slicer-1.0")).toMatchObject({
      expression: "3D-Slicer-1.0",
      malformed: false
    });
  });

  test("surfaces deprecated SPDX license and exception identifiers", () => {
    expect(normalizeLicenseEvidence({
      packageId: "legacy-spdx@1.0.0",
      packageJsonLicense: "GPL-2.0 WITH Nokia-Qt-exception-1.1",
      files: [],
      source: "local",
      warnings: []
    })).toMatchObject({
      expression: "GPL-2.0 WITH Nokia-Qt-exception-1.1",
      confidence: "medium",
      evidenceSources: expect.arrayContaining([
        "deprecated SPDX license identifier: GPL-2.0",
        "deprecated SPDX exception identifier: Nokia-Qt-exception-1.1"
      ])
    });
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

  test("keeps SPDX LicenseRef metadata custom and low confidence", () => {
    expect(normalizeLicenseEvidence({
      packageId: "custom-license@1.0.0",
      metadataLicense: "DocumentRef-vendor:LicenseRef-Proprietary",
      metadataSource: "SPDX",
      files: [],
      source: "sbom",
      warnings: [
        "SPDX external license reference DocumentRef-vendor:LicenseRef-Proprietary cannot be resolved from this document."
      ]
    })).toMatchObject({
      expression: "DocumentRef-vendor:LicenseRef-Proprietary",
      choices: ["DocumentRef-vendor:LicenseRef-Proprietary"],
      signals: ["custom-text"],
      confidence: "low"
    });
  });

  test("does not treat package.json private as package ownership evidence", () => {
    expect(
      normalizeLicenseEvidence({
        packageId: "private-local-package@1.0.0",
        packageJsonPrivate: true,
        files: [],
        source: "local",
        warnings: [
          "No supported license, notice, attribution, or legal evidence file found."
        ]
      })
    ).toEqual({
      packageId: "private-local-package@1.0.0",
      choices: [],
      joiner: "single",
      signals: ["missing"],
      evidenceSources: [
        "source: local",
        "package.json private: true",
        "warning: No supported license, notice, attribution, or legal evidence file found."
      ],
      confidence: "low"
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

  test("does not collapse the BSD four-clause advertising obligation into BSD three-clause", () => {
    const normalized = normalizeLicenseEvidence({
      packageId: "bsd-4-clause@1.0.0",
      files: [{
        path: "LICENSE",
        kind: "license",
        text: [
          "Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:",
          "All advertising materials mentioning features or use of this software must display the following acknowledgement:",
          'This product includes software developed by the Example Organization.',
          "Neither the name of the Example Organization nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission."
        ].join("\n")
      }],
      source: "tarball",
      warnings: []
    });

    expect(normalized).toMatchObject({
      original: "BSD-4-Clause",
      expression: "BSD-4-Clause",
      choices: ["BSD-4-Clause"],
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

  test("recognizes a GPL v3 license before its later AGPL compatibility reference", () => {
    const normalized = normalizeLicenseEvidence({
      packageId: "gpl3-with-agpl-reference@1.0.0",
      files: [
        {
          path: "LICENSE",
          kind: "license",
          text: [
            "GNU GENERAL PUBLIC LICENSE",
            "Version 3, 29 June 2007",
            "",
            "TERMS AND CONDITIONS",
            "",
            "13. Use with the GNU Affero General Public License.",
            "Notwithstanding any other provision of this License, you have permission to link or combine",
            "any covered work with a work licensed under version 3 of the GNU Affero General Public License."
          ].join("\n")
        }
      ],
      source: "tarball",
      warnings: []
    });

    expect(normalized).toMatchObject({
      original: "GPL-3.0-only",
      expression: "GPL-3.0-only",
      choices: ["GPL-3.0-only"],
      confidence: "medium"
    });
  });

  test("recognizes the FreeType and GPL dual-license declaration", () => {
    const normalized = normalizeLicenseEvidence({
      packageId: "github.com/golang/freetype@v0.0.0-20170609003504-e2365dfdc4a0",
      files: [
        {
          path: "LICENSE",
          kind: "license",
          text: [
            "Use of the Freetype-Go software is subject to your choice of exactly one of",
            "the following two licenses:",
            "  * The FreeType License, which is similar to the original BSD license with",
            "    an advertising clause, or",
            "  * The GNU General Public License (GPL), version 2 or later.",
            "",
            "The text of these licenses are available in the licenses/ftl.txt and the",
            "licenses/gpl.txt files respectively."
          ].join("\n")
        }
      ],
      source: "tarball",
      warnings: []
    });

    expect(normalized).toMatchObject({
      original: "FTL OR GPL-2.0-or-later",
      expression: "FTL OR GPL-2.0-or-later",
      choices: ["FTL", "GPL-2.0-or-later"],
      joiner: "or",
      confidence: "medium"
    });
  });

  test("fails closed when a classifier conflicts with multiple recognized license files", () => {
    const normalized = normalizeLicenseEvidence({
      packageId: "multi-license@1.0.0",
      metadataLicense: "MIT",
      metadataLicenseKind: "classifier",
      metadataSource: "METADATA",
      files: [
        {
          path: "LICENSE-APACHE",
          kind: "license",
          text: "Apache License\nVersion 2.0, January 2004\nTERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION"
        },
        {
          path: "LICENSE-MIT",
          kind: "license",
          text: [
            "Permission is hereby granted, free of charge, to any person obtaining a copy",
            "THE SOFTWARE IS PROVIDED \"AS IS\""
          ].join("\n")
        }
      ],
      source: "tarball",
      warnings: []
    });

    expect(normalized).toMatchObject({
      original: "MIT",
      expression: "MIT",
      choices: ["MIT"],
      signals: ["conflicting-evidence"],
      confidence: "low"
    });
    expect(normalized.evidenceSources).toContain(
      "conflicting file license matches: Apache-2.0 from LICENSE-APACHE; MIT from LICENSE-MIT"
    );
    expect(normalized.evidenceSources).not.toContain(
      "file license match: Apache-2.0 from LICENSE-APACHE"
    );
  });

  test("fails closed when declared metadata conflicts with a recognized license file", () => {
    const normalized = normalizeLicenseEvidence({
      packageId: "metadata-file-conflict@1.0.0",
      packageJsonLicense: "MIT",
      files: [
        {
          path: "LICENSE",
          kind: "license",
          text: [
            "GNU GENERAL PUBLIC LICENSE",
            "Version 3, 29 June 2007",
            "TERMS AND CONDITIONS"
          ].join("\n")
        }
      ],
      source: "tarball",
      warnings: []
    });

    expect(normalized).toMatchObject({
      original: "MIT",
      expression: "MIT",
      choices: ["MIT"],
      signals: ["conflicting-evidence"],
      confidence: "low"
    });
    expect(normalized.evidenceSources).toContain(
      "conflicting metadata and file license matches: metadata MIT; GPL-3.0-only from LICENSE"
    );
  });

  test("does not conflict deprecated GNU identifiers with their current equivalents", () => {
    const normalized = normalizeLicenseEvidence({
      packageId: "deprecated-equivalent@1.0.0",
      packageJsonLicense: "AGPL-3.0",
      files: [
        {
          path: "LICENSE",
          kind: "license",
          text: "GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007"
        }
      ],
      source: "tarball",
      warnings: []
    });

    expect(normalized.signals).not.toContain("conflicting-evidence");
    expect(normalized.confidence).toBe("medium");
  });

  test("keeps an explicit dual-license declaration with matching separate files", () => {
    const normalized = normalizeLicenseEvidence({
      packageId: "declared-multi-license@1.0.0",
      metadataLicense: "MIT OR Apache-2.0",
      metadataLicenseKind: "declared",
      metadataSource: "METADATA",
      files: [
        {
          path: "LICENSE-APACHE",
          kind: "license",
          text: "Apache License\nVersion 2.0, January 2004\nTERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION"
        },
        {
          path: "LICENSE-MIT",
          kind: "license",
          text: [
            "Permission is hereby granted, free of charge, to any person obtaining a copy",
            "THE SOFTWARE IS PROVIDED \"AS IS\""
          ].join("\n")
        }
      ],
      source: "tarball",
      warnings: []
    });

    expect(normalized).toMatchObject({
      expression: "MIT OR Apache-2.0",
      choices: ["MIT", "Apache-2.0"],
      joiner: "or",
      signals: [],
      confidence: "high"
    });
  });

  test("combines bundled component licenses without treating them as package conflicts", () => {
    const normalized = normalizeLicenseEvidence({
      packageId: "bundled-component@1.0.0",
      metadataLicense: "MIT",
      metadataLicenseKind: "declared",
      metadataSource: "METADATA",
      files: [
        {
          path: "licenses/LICENSE",
          kind: "license",
          text: [
            "Permission is hereby granted, free of charge, to any person obtaining a copy",
            "THE SOFTWARE IS PROVIDED \"AS IS\""
          ].join("\n")
        },
        {
          path: "licenses/vendor/LICENSE",
          kind: "license",
          scope: "component",
          text: "Apache License\nVersion 2.0, January 2004\nTERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION"
        }
      ],
      source: "tarball",
      warnings: []
    });

    expect(normalized).toMatchObject({
      expression: "MIT AND Apache-2.0",
      choices: ["MIT", "Apache-2.0"],
      joiner: "and",
      signals: [],
      confidence: "high"
    });
    expect(normalized.evidenceSources).toContain(
      "bundled component license match: Apache-2.0 from licenses/vendor/LICENSE"
    );
  });

  test("keeps restrictive bundled component licenses in the combined expression", () => {
    const normalized = normalizeLicenseEvidence({
      packageId: "bundled-copyleft@1.0.0",
      metadataLicense: "MIT",
      metadataLicenseKind: "declared",
      metadataSource: "METADATA",
      files: [{
        path: "licenses/vendor/COPYING",
        kind: "copying",
        scope: "component",
        text: "GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007\nTERMS AND CONDITIONS"
      }],
      source: "tarball",
      warnings: []
    });

    expect(normalized).toMatchObject({
      expression: "MIT AND GPL-3.0-only",
      choices: ["MIT", "GPL-3.0-only"],
      joiner: "and",
      signals: []
    });
  });

  test("recognizes zero-clause BSD text without confusing it with ISC", () => {
    const normalized = normalizeLicenseEvidence({
      packageId: "adler2@2.0.1",
      metadataLicense: "0BSD OR MIT OR Apache-2.0",
      metadataLicenseKind: "declared",
      metadataSource: "Cargo.toml",
      files: [
        {
          path: "LICENSE-0BSD",
          kind: "license",
          text: [
            "Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted.",
            "THE SOFTWARE IS PROVIDED \"AS IS\" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE."
          ].join("\n")
        },
        {
          path: "LICENSE-APACHE",
          kind: "license",
          text: "Apache License\nVersion 2.0, January 2004\nTERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION"
        },
        {
          path: "LICENSE-MIT",
          kind: "license",
          text: [
            "Permission is hereby granted, free of charge, to any person obtaining a copy",
            "THE SOFTWARE IS PROVIDED \"AS IS\""
          ].join("\n")
        }
      ],
      source: "tarball",
      warnings: []
    });

    expect(normalized.signals).not.toContain("conflicting-evidence");
    expect(normalized.evidenceSources).toContain("file: LICENSE-0BSD (license)");
  });

  test("recognizes a line-wrapped ISC notice clause", () => {
    const normalized = normalizeLicenseEvidence({
      packageId: "@isaacs/cliui@8.0.2",
      metadataLicense: "ISC",
      metadataLicenseKind: "declared",
      metadataSource: "package.json",
      files: [{
        path: "LICENSE.txt",
        kind: "license",
        text: [
          "Permission to use, copy, modify, and/or distribute this software",
          "for any purpose with or without fee is hereby granted, provided",
          "that the above copyright notice and this permission notice",
          "appear in all copies.",
          "THE SOFTWARE IS PROVIDED \"AS IS\" AND THE AUTHOR DISCLAIMS ALL WARRANTIES"
        ].join("\n")
      }],
      source: "tarball",
      warnings: []
    });

    expect(normalized).toMatchObject({
      expression: "ISC",
      choices: ["ISC"],
      signals: [],
      confidence: "high"
    });
  });

  test("recognizes a line-wrapped MIT grant before later bundled license text", () => {
    const normalized = normalizeLicenseEvidence({
      packageId: "mypy@2.3.0",
      metadataLicense: "MIT",
      metadataLicenseKind: "declared",
      metadataSource: "METADATA",
      files: [{
        path: "mypy-2.3.0.dist-info/licenses/LICENSE",
        kind: "license",
        text: [
          "Mypy is licensed under the terms of the MIT license, reproduced below.",
          "Permission is hereby granted, free of charge, to any person obtaining a",
          "copy of this software and associated documentation files (the \"Software\"),",
          "THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND,",
          "Portions of mypy are licensed under different licenses.",
          "Redistribution and use in source and binary forms, with or without modification, are permitted."
        ].join("\n")
      }],
      source: "tarball",
      warnings: []
    });

    expect(normalized).toMatchObject({
      expression: "MIT",
      choices: ["MIT"],
      signals: [],
      confidence: "high"
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

  test("does not apply NLTK documentation and corpus restrictions to the Apache-licensed package code", () => {
    const normalized = normalizeLicenseEvidence({
      packageId: "nltk@3.9.4",
      metadataLicense: "Apache-2.0",
      metadataSource: "nltk-3.9.4.dist-info/METADATA",
      files: [
        {
          path: "nltk-3.9.4.dist-info/licenses/AUTHORS.md",
          kind: "license",
          text: "NLTK contributors"
        },
        {
          path: "nltk-3.9.4.dist-info/licenses/LICENSE.txt",
          kind: "license",
          text: "Apache License\nVersion 2.0, January 2004"
        },
        {
          path: "nltk-3.9.4.dist-info/licenses/README.md",
          kind: "license",
          text: [
            "### Redistributing",
            "",
            "- NLTK source code is distributed under the Apache 2.0 License.",
            "- NLTK documentation is distributed under the Creative Commons Attribution-Noncommercial-No Derivative Works 3.0 United States license.",
            "- NLTK corpora are provided under the terms given in the README file for each corpus; all are redistributable and available for non-commercial use.",
            "- NLTK may be freely redistributed, subject to the provisions of these licenses."
          ].join("\n")
        }
      ],
      source: "tarball",
      warnings: []
    });

    expect(normalized).toMatchObject({
      packageId: "nltk@3.9.4",
      original: "Apache-2.0",
      expression: "Apache-2.0",
      choices: ["Apache-2.0"],
      signals: [],
      confidence: "high"
    });
    expect(normalized.evidenceSources).toContain(
      "restriction scope: documentation in nltk-3.9.4.dist-info/licenses/README.md"
    );
    expect(normalized.evidenceSources).toContain(
      "restriction scope: data in nltk-3.9.4.dist-info/licenses/README.md"
    );
  });

  test("keeps a package-scoped commercial denial high even when a README also describes data", () => {
    const normalized = normalizeLicenseEvidence({
      packageId: "restricted-toolkit@1.0.0",
      metadataLicense: "MIT",
      metadataSource: "METADATA",
      files: [
        {
          path: "licenses/README.md",
          kind: "license",
          text: [
            "The bundled example dataset is available for non-commercial use.",
            "",
            "This software may not be used for commercial purposes without a commercial license."
          ].join("\n")
        }
      ],
      source: "tarball",
      warnings: []
    });

    expect(normalized.signals).toContain("commercial-restriction");
    expect(normalized.evidenceSources).toContain(
      "restriction scope: data in licenses/README.md"
    );
  });

  test("does not let a non-package scope mention hide a package commercial denial", () => {
    const normalized = normalizeLicenseEvidence({
      packageId: "restricted-project@1.0.0",
      metadataLicense: "MIT",
      metadataSource: "METADATA",
      files: [
        {
          path: "LICENSE",
          kind: "license",
          text: "The project and documentation are not for commercial use."
        }
      ],
      source: "tarball",
      warnings: []
    });

    expect(normalized.signals).toContain("commercial-restriction");
    expect(normalized.evidenceSources).not.toContain(
      "restriction scope: documentation in LICENSE"
    );
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
      source: "tarball",
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

  test("marks preserved conflicting license claims as conflicting evidence", () => {
    const normalized = normalizeLicenseEvidence({
      packageId: "conflicting-claims@1.0.0",
      metadataLicense: "MIT",
      conflictingLicenseClaims: ["AGPL-3.0-only", "MIT"],
      files: [],
      source: "sbom",
      warnings: []
    });

    expect(normalized).toMatchObject({
      packageId: "conflicting-claims@1.0.0",
      original: "MIT",
      choices: ["MIT"],
      signals: ["conflicting-evidence"],
      confidence: "low"
    });
    expect(normalized.evidenceSources).toContain(
      "conflicting license claims: AGPL-3.0-only; MIT"
    );
  });
});

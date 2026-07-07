# Ohrisk 사용 가이드

Ohrisk는 PR이나 배포 전에 오픈소스 라이선스 리스크를 빠르게 확인하는 로컬 CLI다.
법무 검토를 대체하지 않는다. 개발자가 "이 패키지, 출시 전에 한 번 더 보자"라고
결정할 수 있게 증거와 profile-aware 심각도를 준다.

> 이 문서는 영문 README를 번역한 것이 아니라, 한국어 사용자가 바로 읽고 쓰도록
> 쓴 실전 가이드다. 명령어 동작과 출력 형태는 영문 README와 코드가 기준이다.

## 빠른 설치와 실행

Ohrisk는 npm 패키지로 배포되고, 배포된 CLI는 Node.js `>=24.0.0`에서 실행된다.
Bun은 Ohrisk 자체를 개발하고 테스트하고 패키징할 때 쓰는 도구라서, 일반 사용자는
Bun을 설치하지 않아도 된다.

```bash
npm install -g ohrisk
pnpm add -g ohrisk
yarn global add ohrisk
bun add -g ohrisk
```

한 번만 실행할 거면 전역 설치 없이 실행해도 된다.

```bash
npx ohrisk scan
pnpm dlx ohrisk scan
yarn dlx ohrisk scan
bunx ohrisk scan
```

프로젝트 디렉토리에서 스캔:

```bash
ohrisk scan
```

TTY 터미널에서는 스캔 진행 상황을 live progress로 보여준다. CI나 stderr redirect처럼
터미널 제어가 맞지 않는 환경에서는 기존 plain progress line을 남겨서 로그를 읽기
쉽게 유지한다.

lockfile의 local `file:` package dependency가 현재 project repository 밖의 sibling
package를 가리키는 monorepo 구조라면 workspace root를 명시한다:

```bash
ohrisk scan --workspace-root .. --html --output reports/ohrisk-report.html
ohrisk ci --workspace-root C:\path\to\workspace --fail-on high
ohrisk diff main --workspace-root .. --prod
```

`--workspace-root`는 존재하는 디렉터리여야 한다. Local package evidence는
resolved artifact가 project, repository root, 또는 명시한 workspace root 안에 있을 때만
읽는다. 로컬 package의 `package.json`에 `"private": true`가 있고 public license metadata가
없으면 내부 package evidence로 보고, license field가 없다는 이유만으로 `unknown`
외부 OSS finding으로 올리지 않는다.

지원 입력 파일: 의존성 없는 `package.json` manifest, `bun.lock`, `package-lock.json`, `npm-shrinkwrap.json`,
`pnpm-lock.yaml`, `deno.lock`, Rust `Cargo.lock`, Go `go.work`, Go `go.mod`, Python
`pyproject.toml`, Python `pylock.toml`, Python `pylock.<name>.toml`, Python
`uv.lock`, Python Pipenv `Pipfile.lock`, Python PDM `pdm.lock`, Python `poetry.lock`, Python
`requirements.txt`, Java Gradle `gradle.lockfile`, Java Gradle `gradle/dependency-locks` 디렉터리와 `gradle/dependency-locks/*.lockfile`, Java Gradle `gradle/libs.versions.toml`, Java Maven `pom.xml`,
Bazel `MODULE.bazel`,
.NET NuGet `packages.lock.json`, .NET restored `obj/project.assets.json`,
.NET NuGet `packages.config`, .NET `*.csproj`, Conan `conan.lock`,
Conda `environment.yml`/`environment.yaml`/`conda-lock.yml`/`conda-lock.yaml`, vcpkg `vcpkg.json`,
Terraform `.terraform.lock.hcl`, Helm `Chart.lock`, Helm `Chart.yaml`,
Nix `flake.lock`, Unity Package Manager `Packages/packages-lock.json`,
R `renv.lock`, Julia `Manifest.toml`, Haskell Stack `stack.yaml.lock`,
Perl Carton `cpanfile.snapshot`, LuaRocks `luarocks.lock`, Dart/Flutter `pubspec.lock`,
SwiftPM `Package.resolved`, Carthage `Cartfile.resolved`, CocoaPods `Podfile.lock`,
Elixir Mix `mix.lock`, Erlang Rebar3 `rebar.lock`, Ruby Bundler `Gemfile.lock`, PHP Composer
`composer.lock`, CycloneDX JSON/XML, SPDX JSON/RDF, SPDX tag-value `.spdx`, Yarn classic/Berry `yarn.lock`.
둘 이상이 있으면
`--lockfile <path>`로 명시적으로 선택한다.
Bun, npm, pnpm, Yarn classic/Berry 워크스페이스 프로젝트는 각 workspace/importer
package root의 의존성을 스캔 시작점으로 삼는다.
pnpm의 `catalog:`와 `catalog:<name>` 의존성 specifier는
`pnpm-workspace.yaml`의 default/named catalog 정의로 해석한다.
Yarn Berry/PnP 프로젝트는 `node_modules`가 없어도 로컬 `.yarn/cache` zip 패키지
evidence를 registry fallback보다 먼저 사용한다.
Deno는 `deno.lock`에 기록된 `npm:` 패키지 의존성을 스캔한다. root 원격 URL
import와 JSR 패키지는 조용히 건너뛰지 않고 fail-closed로 실패한다.
Rust는 `Cargo.lock`에 기록된 crate를 스캔하고, 옆의 `Cargo.toml`이 있으면
직접/개발 의존성 구분에 사용한다. literal Cargo workspace member manifest와
`crates/*`, `crates/app-*`, `tools/?li`, `crates/*/plugins/*` 같은 segment `*`/`?` Cargo workspace member pattern도
직접/개발 의존성 구분에 사용하고, Cargo workspace `exclude` entry는 제외한다. member manifest의
`crate.workspace = true` dependency key, workspace dependency package alias,
table-form dependency section(`[dependencies.foo]`)도 root dependency로 처리한다.
evidence는 로컬 Cargo registry source나 `vendor/<crate>`에서
읽는다. 아직 crates.io 원격 artifact fetch는 지원하지 않는다.
Go는 `go.work` workspace module, workspace `replace` directive, 각 module의
`go.mod` require, module-level `replace` directive, 옆의 `go.sum` module version을
스캔한다. `go.work`의 `replace`는 module `go.mod`의 `replace`보다 먼저 적용한다.
module-to-module `replace`는 원래 require identity를 유지하되
replacement module/version의 로컬 cache evidence를 읽고, 프로젝트 root 안의 local
path `replace`는 해당 경로의 license evidence를 읽는다. evidence는 로컬 Go module
cache, `vendor/<module>`, 프로젝트 root 안 local replacement path에서 읽는다. 프로젝트
root 밖 `go.work use` path, 프로젝트 root 밖 local `replace` path, 전체 Go module parent graph 복원, Go proxy 원격 artifact
fetch는 아직 지원하지 않는다.
Python은 standalone `pyproject.toml`의 정확한 PEP 621 `name==version` 직접 의존성, PyPA `pylock.toml`/`pylock.<name>.toml`, `uv.lock`, Pipenv `Pipfile.lock`, PDM `pdm.lock`, `poetry.lock`에 기록된 PyPI 패키지를
스캔하고, 로컬 `.venv`/`venv`의 `*.dist-info/METADATA`와 license 파일을
evidence로 읽는다. `uv.lock`은 프로젝트 root 안 `directory`/`editable`
package source record를 지원한다. `Pipfile.lock`은 `default`와 `develop` 섹션의 정확한
`==version` package entry와 프로젝트 root 안의 local `path`/editable source
entry를 지원한다. PDM `pdm.lock`은 프로젝트 root 안의 local `path` 또는 상대
`file:` source record를 지원하고, PDM `pdm.lock`과 `poetry.lock`은 옆의
`pyproject.toml`이 있으면 직접/개발 의존성 구분에 사용한다. `pylock.toml`은
version이 있는 package record와 프로젝트 root 안 source-tree record를 스캔하고,
lockfile 안의 dependency reference로 감사용 경로를 복원한다. local source package는
`pyproject.toml`, `setup.cfg`, `PKG-INFO`의 name/version/license metadata와 root
license 파일을 evidence로 읽는다.
`requirements.txt`는 `name==version`처럼
버전이 고정된 직접 의존성, 프로젝트 root 안의 local source entry, `-e ./local-package`
같은 editable local source entry, `-r base.txt` 같은 include, `-c constraints.txt`의
정확한 constraint pin을 지원한다. 로컬 source package는 `pyproject.toml`,
`setup.cfg`, `PKG-INFO`의 name/version/license metadata와 root license 파일을
evidence로 읽는다. uv/Pipenv/PDM 원격 VCS entry, 프로젝트 root 밖 uv/Pipenv/PDM local
source path, 원격 VCS `requirements.txt` entry, 정확한 constraint pin이 없는 unpinned range, 원격 PyPI artifact fetch는 아직
지원하지 않는다. `pyproject.toml`의 range, direct reference, VCS/path dependency처럼 resolved version을 알 수 없는 entry도 아직 지원하지 않는다.
Java는 Gradle dependency locking의 `gradle.lockfile`, legacy
`gradle/dependency-locks` 디렉터리, 명시 `gradle/dependency-locks/*.lockfile`에 기록된 Maven 좌표와
Gradle version catalog `gradle/libs.versions.toml`의 exact Maven library alias를
스캔하고, 로컬 `.m2/repository`의 POM license metadata를 evidence로 읽는다.
Maven `pom.xml`은 직접 의존성 중 버전이 명시되어 있거나 같은 파일의
`<properties>`, same-file `dependencyManagement`, 또는 로컬 `.m2/repository`에 이미
있는 parent/imported BOM POM의 `dependencyManagement`로 해석되는 경우를 지원한다.
원격 parent/BOM fetching, 로컬 `.m2/repository` 밖의 외부 Maven repository resolution,
Maven 전이 그래프 해석, Gradle 그래프 복원, Gradle version
catalog rich version, bundle alias, plugin alias, usage-site configuration 복원은 아직 지원하지 않는다.
Bazel은 `MODULE.bazel`의 직접 `bazel_dep` 중 literal exact `version`이 있는 entry를
스캔한다. `dev_dependency = True`는 개발 의존성으로 분류한다. file 기반 로컬
Bazel registry의 `local_path` source가 있으면 license evidence를 읽고, 원격 Bazel
registry metadata fetching은 아직 지원하지 않는다.
`include()`로 나뉜 module fragment, override, module extension, `repo_name = None`
nodep entry, `MODULE.bazel.lock` 기반 resolved graph 복원은 아직 지원하지 않는다.
이런 graph 확장 문법이 보이면 부분 스캔으로 넘어가지 않고 실패 처리한다.
.NET은 NuGet `packages.lock.json`과 restore 후 생성되는 `obj/project.assets.json`의
직접/전이 package dependency를 스캔한다. `packages.config`에서는 exact `version`
attribute가 있는 flat package entry를 스캔하고, `.csproj` 파일에서는 literal `Version`을
가진 직접 `PackageReference`를 스캔한다. `.csproj`가 NuGet Central Package Management를
쓰는 경우에는 가장 가까운 `Directory.Packages.props`의 literal `PackageVersion`을
같이 읽는다. 조건부로 버전이 갈리거나 property 치환으로 resolved version을 알 수 없는
경우에는 부분 스캔하지 않고 실패한다. 로컬 NuGet package cache의 `.nuspec`
license metadata와 license 파일을 evidence로 읽는다. 중앙 패키지 관리처럼 `.csproj`만으로
resolved version을 알 수 없는 경우에는 `obj/project.assets.json`을 지정해야 한다.
Conan은 Conan 2 `conan.lock`의 `requires`, `build_requires`, `python_requires`에
기록된 recipe reference를 스캔한다. evidence는 로컬 Conan cache의 `conanfile.py`
license metadata와 license 파일에서 읽는다. Conan 1 graph lock, binary package ID,
settings/options, user/channel, recipe revision의 PURL qualifier, 원격 ConanCenter artifact
fetch는 아직 지원하지 않는다.
Conda는 `environment.yml`과 `environment.yaml`의 exact Conda `name=version` pin,
pip `name==version` pin, 그리고 `conda-lock.yml`/`conda-lock.yaml`에 기록된 resolved
`conda`/`pip` package entry를 스캔한다. `conda-lock` 출력이 environment spec과 같이
있으면 resolved lock 쪽을 우선한다. evidence는 로컬 Conda package cache의
`info/index.json` license metadata와 license 파일에서 읽는다. version이 고정되지 않은
`environment.yml` range, Conda environment 전이 의존성 복원, explicit
`conda-<platform>.lock` export, 원격 Conda channel artifact fetch, Conda build/channel/subdir
PURL qualifier는 아직 지원하지 않는다.
vcpkg는 `vcpkg.json` manifest를 스캔한다. `vcpkg_installed/vcpkg/status`가 있으면
설치된 package/version record를 기준으로 보고, status가 없으면 top-level `overrides`에
정확한 version이 박힌 직접 의존성만 스캔한다. baseline이나 `version>=` constraint는
resolved version이 아니므로 package version인 척하지 않는다. evidence는 로컬
`vcpkg_installed/<triplet>/share/<port>/copyright`에서 읽는다. feature/platform 선택 복원,
baseline만 있는 manifest 해석, 원격 vcpkg registry metadata fetch는 아직 지원하지 않는다.
Terraform은 `.terraform.lock.hcl`에 고정된 provider version을 스캔한다. evidence는
로컬 `.terraform/providers` cache의 license 파일에서 읽는다. provider constraint,
platform hash, Terraform module scanning, 원격 Terraform Registry metadata fetch는 아직
지원하지 않는다.
Helm은 `Chart.lock`과 `Chart.yaml`의 chart dependency entry를 스캔하고, 두 파일이
같이 있으면 `Chart.lock`을 우선한다. evidence는 로컬 `charts/` 아래의 `Chart.yaml`
license metadata와 license 파일에서 읽는다. Helm transitive chart graph 복원과 원격
chart repository fetch는 아직 지원하지 않는다.
Nix는 `flake.lock`의 root input graph에서 reachable flake input을 스캔한다. 로컬 path
input이면 해당 경로의 license 파일을 evidence로 읽는다. Nix derivation package graph
복원, Nixpkgs package license extraction, 원격 input fetch는 아직 지원하지 않는다.
Unity Package Manager는 `Packages/packages-lock.json`에 기록된 non-built-in package
entry를 스캔한다. Unity built-in module은 제외하고, evidence는 로컬 `Packages/` 또는
`Library/PackageCache`의 package source에서 읽는다. `Packages/manifest.json`만 있는
프로젝트, Asset Store `.unitypackage`, Addressables catalog, 원격 UPM registry metadata
fetch는 아직 지원하지 않는다.
R은 `renv.lock`의 package record를 스캔하고, 옆의 root `DESCRIPTION`에 있는
`Depends`, `Imports`, `LinkingTo`, `Suggests`, `Enhances` field를 production/development
root classification에 사용한다. 로컬 `renv/library`의 package source에서 DESCRIPTION
license metadata와 license 파일을 evidence로 읽는다. renv lockfile은 dependency parent
graph를 직접 담지 않으므로 direct/transitive 관계는 복원하지 않는다. Packrat lockfile,
원격 CRAN/GitHub/Bioconductor artifact fetch는 아직 지원하지 않는다.
Julia는 `Manifest.toml`의 versioned `[[deps.Name]]` package record를 스캔한다.
version이 없는 standard library record는 제외하고, `deps = [...]`가 있으면 parent path를
복원한다. 로컬 Julia depot의 package source와 `Project.toml` license metadata를 evidence로
읽는다. 옆의 `Project.toml`에 `[deps]`와 test target `[extras]`가 있으면
root/dev classification에 사용한다. 원격 Julia registry/package server artifact fetch는
아직 지원하지 않는다.
Haskell Stack은 `stack.yaml.lock`의 completed Hackage package pin을 스캔한다.
snapshot package expansion, git/path extra-deps, direct/transitive graph 복원,
Hackage metadata fetch는 아직 지원하지 않는다. 로컬 Stack package database metadata가
있으면 license evidence로 읽고, 없으면 unavailable로 표시한다.
Perl Carton은 `cpanfile.snapshot`의 distribution pin을 스캔하고 `provides`와
`requirements` metadata로 dependency path를 일부 복원한다. 로컬 Carton cache archive의
`META.json` 또는 `META.yml` license metadata가 있으면 evidence로 읽고, MetaCPAN
fetch는 아직 지원하지 않는다.
LuaRocks는 `luarocks.lock`의 literal `dependencies` table package pin을 스캔한다.
프로젝트 루트나 로컬 rocks tree 안의 `.rockspec`이 있으면 literal string 또는
string table license metadata를 evidence로 읽고, dependency graph 복원과 LuaRocks
metadata fetch는 아직 지원하지 않는다.
Dart/Flutter는 `pubspec.lock`에 기록된 concrete Pub package version을 스캔하고,
`.dart_tool/package_config.json` 또는 로컬 Pub cache의 package source에서 license
evidence를 읽는다. pub.dev 원격 artifact fetch는 아직 지원하지 않는다.
SwiftPM은 `Package.resolved`에 기록된 package pin을 스캔하고, 로컬
`.build/checkouts` 또는 Xcode `SourcePackages/checkouts`의 package source에서
license evidence를 읽는다. `Package.resolved`에는 parent dependency graph가 없기
때문에 direct/transitive 관계 복원과 원격 Swift package checkout fetch는 아직
지원하지 않는다.
Carthage는 `Cartfile.resolved`에 기록된 GitHub, git, binary pin을 스캔하고,
로컬 `Carthage/Checkouts`의 package source에서 license evidence를 읽는다.
`Cartfile.resolved`에는 parent dependency graph가 없기 때문에 dependency type은
unknown으로 표시한다. 원격 checkout이나 binary framework license fetch는 아직
지원하지 않는다.
CocoaPods는 `Podfile.lock`에 기록된 resolved pod를 스캔하고, subspec은 root pod
identity로 접는다. dependency type은 `Podfile.lock`만으로 production/development
group을 알 수 없어서 unknown으로 표시한다. evidence는 로컬 `Pods/<pod>` source와
`Pods/Local Podspecs/<pod>.podspec.json`에서 읽는다. 원격 podspec/source fetch는
아직 지원하지 않는다.
Elixir Mix는 `mix.lock`에 기록된 Hex package pin을 스캔하고, root `mix.exs`의
literal `only:` dependency option을 production/development root classification에
사용한다. 로컬 `deps/<package>` source와 `mix.exs`의 license metadata를 evidence로
읽는다. `mix.lock` dependency graph 복원과 원격 Hex.pm artifact fetch는 아직
지원하지 않는다.
Erlang Rebar3는 `rebar.lock`에 기록된 Hex `pkg` pin을 스캔하고, depth 0 Hex pin을
production root dependency로 분류한다. 로컬 `deps/<package>` source와 `rebar.config`
license metadata를 evidence로 읽는다. git/path dependency, plugin lock,
profile-specific test dependency, Rebar dependency tree 복원, 원격 Hex.pm artifact
fetch는 아직 지원하지 않는다.
Ruby는 Bundler `Gemfile.lock`의 gem dependency를 스캔하고, 로컬 Bundler/RubyGems
install path의 gemspec license metadata와 license 파일을 evidence로 읽는다.
옆의 `Gemfile`에 literal `group ... do` block이나 inline `group:` option이 있으면
개발 의존성 구분에 사용한다.
PHP는 Composer `composer.lock`의 production/development package dependency를
스캔하고, 옆의 `composer.json`이 있으면 root dependency 구분에 사용한다.
evidence는 로컬 `vendor/<vendor>/<package>/composer.json`과 license 파일에서
읽는다. Composer plugin/platform repository 해석과 Packagist 원격 artifact fetch는
아직 지원하지 않는다.
CycloneDX JSON/XML, SPDX JSON/RDF, SPDX tag-value SBOM은 Package URL이 있는 package
identity, dependency relationship, SBOM에 들어 있는 license evidence를 스캔한다.
프로젝트 자동 탐색은 지원 이름과 suffix 기준이고, `--lockfile`로 명시한 SBOM은
이름이나 suffix가 없어도 CycloneDX JSON/XML, SPDX JSON/RDF, SPDX tag-value signature를
앞부분에서 판별한다. `.cdx.json`, `.cdx.xml`, `.spdx.json`, `.spdx.rdf`,
`.spdx.rdf.xml`, `.spdx` suffix도 계속 지원한다.

```bash
ohrisk scan --lockfile package-lock.json
ohrisk scan --lockfile npm-shrinkwrap.json
ohrisk scan --lockfile Cargo.lock
ohrisk scan --lockfile go.work
ohrisk scan --lockfile go.mod
ohrisk scan --lockfile pylock.toml
ohrisk scan --lockfile pyproject.toml
ohrisk scan --lockfile uv.lock
ohrisk scan --lockfile Pipfile.lock
ohrisk scan --lockfile pdm.lock
ohrisk scan --lockfile poetry.lock
ohrisk scan --lockfile requirements.txt
ohrisk scan --lockfile gradle.lockfile
ohrisk scan --lockfile gradle/dependency-locks
ohrisk scan --lockfile gradle/dependency-locks/runtimeClasspath.lockfile
ohrisk scan --lockfile gradle/libs.versions.toml
ohrisk scan --lockfile pom.xml
ohrisk scan --lockfile MODULE.bazel
ohrisk scan --lockfile packages.lock.json
ohrisk scan --lockfile obj/project.assets.json
ohrisk scan --lockfile packages.config
ohrisk scan --lockfile MyApp.csproj
ohrisk scan --lockfile conan.lock
ohrisk scan --lockfile environment.yml
ohrisk scan --lockfile conda-lock.yml
ohrisk scan --lockfile vcpkg.json
ohrisk scan --lockfile .terraform.lock.hcl
ohrisk scan --lockfile Chart.lock
ohrisk scan --lockfile Chart.yaml
ohrisk scan --lockfile flake.lock
ohrisk scan --lockfile Packages/packages-lock.json
ohrisk scan --lockfile renv.lock
ohrisk scan --lockfile Manifest.toml
ohrisk scan --lockfile stack.yaml.lock
ohrisk scan --lockfile cpanfile.snapshot
ohrisk scan --lockfile luarocks.lock
ohrisk scan --lockfile pubspec.lock
ohrisk scan --lockfile Package.resolved
ohrisk scan --lockfile Cartfile.resolved
ohrisk scan --lockfile Podfile.lock
ohrisk scan --lockfile mix.lock
ohrisk scan --lockfile rebar.lock
ohrisk scan --lockfile Gemfile.lock
ohrisk scan --lockfile composer.lock
ohrisk scan --lockfile cyclonedx.json
ohrisk scan --lockfile licenses.cdx.json
ohrisk scan --lockfile cyclonedx.xml
ohrisk scan --lockfile sbom.cdx.xml
ohrisk scan --lockfile spdx.json
ohrisk scan --lockfile licenses.spdx.json
ohrisk scan --lockfile spdx.rdf
ohrisk scan --lockfile sbom.spdx.rdf.xml
ohrisk scan --lockfile sbom.spdx
```

## SaaS 기준으로 스캔하기

서비스를 직접 운영하고 패키지 바이너리를 사용자에게 재배포하지 않으면 `saas`
프로필이 기본값이다. SaaS 사용은 재배포 의무를 트리거하지 않으므로,
GPL-2.0/GPL-3.0 같은 일반 GPL은 `review`로 분류된다. AGPL과 source-available
제한 라이선스는 여전히 `high`다.

```bash
ohrisk scan --profile saas --prod
```

`--prod`를 붙이면 개발 전용 의존성을 제외하고 프로덕션 경로만 본다.

출력은 심각도가 높은 순으로 나온다:

```text
Ohrisk scan
Profile: saas
Production only: yes
Risks: 1 high, 1 review, 1 unknown, 2 low

Findings:
- [high] agpl-child@0.1.0
  License expression is high risk for saas.
  recommendation: replace
  action: Replace this package or escalate before shipping.
  dependency: production transitive
  path: fixture-bun-project -> permissive-parent@1.0.0 -> agpl-child@0.1.0
```

기계 판독 출력이 필요하면 `--json`, PR 코멘트용은 `--markdown`, 브라우저에서
보기 좋은 로컬 리포트는 `--html`, 코드 스캐닝 연동은 `--sarif`, SBOM은
`--cyclonedx`를 쓴다. HTML 리포트를 파일로 쓴 뒤 바로 열려면
`--html --output <file> --open`을 쓴다. 이때 브라우저는 임시 `127.0.0.1`
URL로 열리므로 파일 URL 권한이 없어도 된다.
한국어 HTML 리포트가 필요하면 `--html --language ko --output <file>`을 쓴다.
스페인어 리포트는 `--language es`, 프랑스어 리포트는 `--language fr`를 쓰고, 영어는 기본값이며 명시하려면 `--language en`을 사용할 수 있다.

`--output`은 프로젝트 내부 상대 파일 경로만 받는다. 절대 경로, drive-relative
경로, UNC 경로, `.` 또는 `..` 경로 segment는 거부된다.

## 배포형 앱 기준으로 스캔하기

사용자에게 패키지를 직접 배포하면 재배포 의무가 발생한다. `distributed-app`
프로필에서는 GPL이 `high`로 올라가고, 약한 카피레프트(LGPL, MPL, EPL)는
`review`로 잡힌다.

```bash
ohrisk scan --profile distributed-app --prod
```

같은 의존성 트리라도 프로필에 따라 심각도가 달라진다. SaaS에서는 `review`였던
GPL 패키지가 배포형 앱에서는 `high`가 되는 식이다. 그래서 프로필은 "이
의존성이 내 사용자에게 어떻게 도달하는가"에 맞춰 고른다.

## CI에서 막기

`scan`은 리스크를 찾아도 종료 코드 0을 반환한다. 로컬 결정 보조 도구라서
CI를 깨뜨리지 않는다. PR에서 실제로 빌드를 막으려면 `ci` 명령에 `--fail-on`
임계값을 준다.

```bash
ohrisk ci --fail-on high
```

`high` 이상 finding이 있으면 종료 코드 1로 빠진다. 임계값은 `high`, `unknown`,
`review`, `low` 중 선택한다.

waiver 파일에 만료되거나 매칭되지 않는 항목이 있으면 CI를 막으려면
`--strict-waivers`를 추가한다.

```bash
ohrisk ci --strict-waivers
```

waiver 파일을 무시하고 원시 감사를 하려면 `--no-waivers`를 쓴다. `--no-waivers`와
`--strict-waivers`는 같이 쓸 수 없다.

## diff로 PR 변화만 보기

PR에서 새로 들어온 리스크만 보려면 baseline git ref와 비교한다.

```bash
ohrisk diff main --prod
```

diff는 baseline ref에서 락파일을 읽어 현재 결과와 비교한다. finding
fingerprint 기준으로 비교하므로 심각도, 권장사항, 이유(reason), 증거(evidence)가
바뀌면 새로 바뀐 finding으로 잡고, action 안내 문구만 바뀐 경우에는 diff 노이즈를
내지 않는다.

baseline ref는 `main`, `origin/main`, `release/v1.2.3`, commit hash 같은
branch/tag/commit 형태만 받는다. `HEAD@{1}`, `HEAD~1`, `main:path` 같은 git
rev syntax는 거부된다.

CI에서 diff 결과로 빌드를 막으려면:

```bash
ohrisk diff main --prod --fail-on unknown
```

Markdown 리포트로 PR 코멘트에 쓸 수 있다:

```bash
ohrisk diff main --prod --markdown --output reports/ohrisk-pr.md
```

## 라이선스별로 Ohrisk가 어떻게 보는지

Ohrisk는 라이선스 텍스트를 법적으로 해석하지 않는다. 알려진 SPDX 식별자와
패턴을 profile-aware 심각도로 매핑한다.

| 라이선스 계열 | saas | distributed-app | 설명 |
| --- | --- | --- | --- |
| permissive (MIT, ISC, BSD, Apache-2.0, Zlib, CC0, Unlicense) | low | low | 재배포 제약이 없어 프로필과 무관하게 low. |
| AGPL | high | high | 네트워크 카피레프트. SaaS여도 high. |
| GPL | review | high | SaaS는 재배포가 아니라 review, 배포형 앱은 재배포 의무로 high. |
| LGPL, MPL, EPL | review | review | 약한 카피레프트. 출시 전 검토 권장. |
| SSPL, BUSL, Elastic, Commons Clause, PolyForm | high | high | source-available / 상업적 사용 제한. 프로필 무관 high. |
| UNLICENSED | high | high | 패키지 메타데이터가 명시적으로 사용 거부. |
| 누락/잘못됨/인식 불가 | unknown | unknown | 증거가 없거나 형식이 맞지 않음. |

`OR` 결합 표현은 가장 낮은 심각도를, `AND` 결합은 가장 높은 심각도를 취한다.
예를 들어 `MIT OR Apache-2.0`은 `low`다.

라이선스 표현만 따로 확인하려면:

```bash
ohrisk explain AGPL-3.0-only --profile saas
```

## waiver: 언제 쓰고 언제 조심해야 하는가

waiver는 특정 finding을 "이번 출시에서는 받아들이겠다"고 로컬에서 표시하는
기능이다. 프로젝트 루트의 `.ohrisk-waivers.json`에 finding id나 fingerprint로
면제를 등록한다.

```json
{
  "waivers": [
    {
      "id": "agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0",
      "reason": "내부 검토 후 이번 릴리스에서 수용.",
      "expiresOn": "2026-09-30"
    }
  ]
}
```

- 면제된 finding은 `ci --fail-on` 임계값 실패에서 제외된다.
- 하지만 scan, CI, JSON, terminal, Markdown, SARIF 리포트에는 여전히 표시된다.
- 만료된 waiver와 매칭되지 않는 waiver는 별도로 보고되고 적용되지 않는다.
- `ci --strict-waivers`는 만료/미매칭 waiver가 있으면 임계값과 무관하게 종료
  코드 1을 반환한다.
- package name, path, reason, evidence에 `::`, `>`, `|` 같은 finding 구분자가
  들어가면 generated id/fingerprint에서는 percent-escape되어 waiver 매칭이
  모호해지지 않는다.

**남용 주의**: waiver는 리스크를 없애는 것이 아니라 연기하는 것이다. reason
없이 high finding을 반복적으로 면제하면, 결국 누적된 리스크를 놓치게 된다.
waiver는 "이번 출시에서만, 검토 후, 만료일을 정해서" 써야 한다. 영구 면제는
패키지를 아예 교체하거나 라이선스를 명확히 하는 쪽이 낫다.

## 법무 검토 대체재가 아님

Ohrisk는 라이선스 증거를 수집하고 profile-aware 심각도를 매기는 의사결정
보조 도구다. 다음을 하지 않는다:

- "안전함/안전하지 않음" 같은 법적 판정을 내리지 않는다.
- 라이선스 호환성이나 의무 준수 여부를 보증하지 않는다.
- 모든 리스크를 탐지한다고 보장하지 않는다.
- 법무팀의 검토를 대체하지 않는다.

Ohrisk가 `high`나 `unknown`을 보고하면, 그 다음은 사람이 판단한다. Ohrisk는
"이 패키지를 출시 전에 확인해"라고 알려주는 역할이다.

## 더 보기

- [영문 README](../../README.md) — 전체 기능 목록, 출력 형태, 개발 가이드
- [GitHub Actions 가이드](../github-actions.md) — PR 게이트, PR 코멘트, SARIF 업로드 예시
- [CI 사용 가이드](../ci.md) — GitHub Actions PR 게이트 및 아티팩트 예시
- [Waiver 가이드](../waivers.md) — 라이선스 리스크 waiver 안전 사용법
- [Profile 가이드](../profiles.md) — saas와 distributed-app 중 선택 기준
- [Report Formats 가이드](../report-formats.md) — 출력 형식별 포함 내용과 차이
- [CHANGELOG.md](../../CHANGELOG.md) — 버전별 변경 이력

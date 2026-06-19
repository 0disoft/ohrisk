# Ohrisk 사용 가이드

Ohrisk는 PR이나 배포 전에 오픈소스 라이선스 리스크를 빠르게 확인하는 로컬 CLI다.
법무 검토를 대체하지 않는다. 개발자가 "이 패키지, 출시 전에 한 번 더 보자"라고
결정할 수 있게 증거와 profile-aware 심각도를 준다.

> 이 문서는 영문 README를 번역한 것이 아니라, 한국어 사용자가 바로 읽고 쓰도록
> 쓴 실전 가이드다. 명령어 동작과 출력 형태는 영문 README와 코드가 기준이다.

## 빠른 설치와 실행

Ohrisk는 npm 패키지로 배포되지만 실행은 Bun 위에서 한다. 먼저 `bun`이 PATH에
있어야 한다.

```bash
bun add -g ohrisk
```

프로젝트 디렉토리에서 스캔:

```bash
ohrisk scan
```

지원 락파일: `bun.lock`, `package-lock.json`, `pnpm-lock.yaml`, Yarn v1
`yarn.lock`. 둘 이상이 있으면 `--lockfile <path>`로 명시적으로 선택한다.
Bun, npm, pnpm 워크스페이스 락파일은 각 workspace/importer의 의존성을
스캔 시작점으로 삼는다.

```bash
ohrisk scan --lockfile package-lock.json
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

기계 판독 출력이 필요하면 `--json`, PR 코멘트용은 `--markdown`, 코드 스캐닝
연동은 `--sarif`, SBOM은 `--cyclonedx`를 쓴다.

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

diff는 baseline ref에서 락파일을 읽어 현재 결과와 비교한다. 이유(reason)나
증거 문구(evidence prose)가 바뀐 것만으로는 변화로 잡지 않고, 심각도·권장사항·
액션이 실제로 바뀐 finding만 노출한다. 따라서 문구 수정 때문에 노이즈가 생기지
않는다.

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
- [CI 사용 가이드](../ci.md) — GitHub Actions PR 게이트 및 아티팩트 예시
- [Waiver 가이드](../waivers.md) — 라이선스 리스크 waiver 안전 사용법
- [Profile 가이드](../profiles.md) — saas와 distributed-app 중 선택 기준
- [Report Formats 가이드](../report-formats.md) — 출력 형식별 포함 내용과 차이
- [CHANGELOG.md](../../CHANGELOG.md) — 버전별 변경 이력

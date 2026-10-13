# 정책자금 한눈에 보기

소상공인·중소기업 정책자금의 종류, 신청 조건, 필요 서류를 한 화면에서 보고 공고 원문을 내려받는 정적 웹 페이지입니다. 빌드 없이 `index.html`을 브라우저로 열면 동작합니다.

## 데이터

- 원본: `data/policy_funds_2026.csv` (공식 공고 기준: 소진공 제2026-576호, 중진공 제2026-574호, 2026.10.1 통합 변경공고. 15개 열, "최신공고 대비 변경 메모" 포함)
- 생성물: `data/funds.json`(정본), `data/funds.js`(file:// 로 열 때 쓰는 래퍼)
- 갱신: CSV를 교체한 뒤 `node apps/policy-fund/tools/build-data.js`

## 글꼴

글꼴은 항상 Pretendard입니다. `fonts/pretendard-subset.woff2`는 Pretendard Variable 1.3.9(SIL OFL 1.1, `fonts/LICENSE-Pretendard.txt`)에서 굵기 400~700, 기본 라틴, KS X 1001 한글 2,350자와 화면에 쓰이는 글자만 남긴 서브셋입니다. 목록에 없는 글자는 시스템 한글 글꼴로 대체됩니다. 새 글자가 필요하면 npm `pretendard` 패키지의 `PretendardVariable.woff2`를 fontTools(`varLib.instancer`로 굵기 제한, `subset`으로 글자 제한)로 다시 만드세요.

## 한 장짜리 HTML로 게시하기

`node apps/policy-fund/tools/build-artifact.js <출력파일.html>`로 CSS, 글꼴, 데이터, JS를 안에 넣은 단일 HTML을 만듭니다. 이 파일을 Claude Artifact로 같은 URL에 다시 올리면(Artifact 도구에 같은 파일 경로 또는 `url` 지정) 데이터가 갱신될 때마다 같은 주소에서 새 버전을 볼 수 있습니다.

## 알려진 한계

- 소진공 필요 서류의 전체 목록은 공고문에 없어(소진공 신청안내자료 따름) "전체 목록 미확인"으로 표시합니다. 중진공은 융자절차 안내 기준으로 단계별(기업정보입력, 융자신청, 해당 시) 서류를 보여 줍니다.
- 소진공·중진공 모두 신청서를 온라인으로 작성·제출하므로 내려받을 서식 파일 링크는 없습니다. 확인되면 `funds.json`의 `forms`(`label`, `url`)에 채우면 내려받기 버튼이 생깁니다.
- 동반성장 네트워크론/매출채권팩토링은 공고문에 한도·금리·기간이 없어 "공고문 확인 필요"로 표시합니다.
- 금리는 분기별 기준금리에 가산금리를 더하는 구조라 실제 %는 기관 공지를 확인해야 합니다.
- 중진공 자금은 소상공인 제외가 원칙이라 대상이 "중소기업"으로 분류됩니다(공고에 소상공인 포함 가능이라고 명시된 자금만 둘 다).

## 테스트

`node tests/apps/policy-fund.test.js`

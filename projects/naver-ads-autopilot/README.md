# 네이버 쇼핑검색광고 오토파일럿

목표 ROAS 한 개만 정하면 입찰가 조정, 광고 ON/OFF, 일 예산 방어를 자동으로 수행하고, 사람은 일일 요약과 예외 승인만 처리하도록 만든 프로그램입니다.

- 기획안 (Figma): <https://www.figma.com/design/rJprk2JCfI6BcddA7ppCZx>
- 1회 실행 판단 흐름 (FigJam): <https://www.figma.com/board/YONxKmGBWj45t2dq56szXZ>

## 현재 상태 (솔직한 안내)

| 항목 | 상태 |
| --- | --- |
| 판단 엔진 (누수 OFF, 입찰 조정, 예산 방어, 스케줄, 재진입) | 구현, 단위·통합 테스트 71개 통과 |
| 가상 시장 시뮬레이션 | 구현. 로직 검증용이며 실제 성과의 증거가 아님 |
| API 서명 (HMAC-SHA256) | 공식 샘플 알고리즘과 동일함을 테스트로 확인 |
| 광고그룹·키워드 조회, ON/OFF, 입찰가 변경 호출 형식 | 공식 샘플 기준으로 구현. 실계정 호출은 아직 안 함 |
| `/stats` 전환 필드명 (`ccnt`, `convAmt`), 캠페인 일 예산 변경 | 미검증. `probe`로 확인 후 설정 |
| 쇼핑 상품(소재) 단위 입찰, 상품 등록 자동화, 웹 대시보드 | 미구현 (기획안 Phase 2~4) |

실계정에 처음 연결할 때는 반드시 아래 "안전하게 시작하기" 순서를 따르세요.

## 빠른 시작

Python 3.11 이상, 외부 패키지 없음(표준 라이브러리만 사용).

```bash
cd projects/naver-ads-autopilot

# 1) 네트워크 없이 로직 확인: 가상 시장에서 "자동화 없음" vs "오토파일럿" 비교
python3 -m autopilot simulate --days 45 --seed 7

# 2) 테스트
python3 -m unittest discover -s tests -t .
```

## 안전하게 시작하기

1. 설정 파일을 만듭니다. API 키는 파일이 아니라 환경변수로만 넣습니다.

   ```bash
   cp config.example.toml config.toml
   export NAVER_SA_CUSTOMER_A=...   # 고객 ID
   export NAVER_SA_API_KEY_A=...    # 액세스 라이선스
   export NAVER_SA_SECRET_A=...     # 비밀키
   ```

2. Phase 0 - `probe`로 실계정 응답 모양을 확인합니다 (읽기 전용). 출력의 키 값은 비밀이 아니지만, 공유 전에 광고주 정보가 없는지 확인하세요.

   ```bash
   python3 -m autopilot probe --site site_a
   ```

   확인할 것: `campaignTp` 값(예: `SHOPPING`), `/stats` 응답의 전환·전환매출 필드 이름, 광고비(VAT 제외 여부).
   다르면 `config.toml`과 `NaverSearchAdClient(stat_fields=...)`를 맞춥니다.

3. Phase 1 - 섀도 모드. 기본값이 dry-run이라 아무것도 바꾸지 않고 "하려던 일"만 기록합니다. 2주 동안 매시 실행하고, 사람이 하던 조정과 비교하세요.

   ```bash
   python3 -m autopilot run --site site_a          # dry-run
   python3 -m autopilot report --out report.html   # 일일 요약
   ```

4. Phase 2 - 제한 라이브. 사이트 1개, 낮은 `daily_budget_cap`으로 시작합니다.

   ```bash
   python3 -m autopilot run --site site_a --live
   python3 -m autopilot approvals --list           # 승인 대기 확인
   python3 -m autopilot approvals --approve 12     # 승인 (다음 live 실행 때 반영)
   ```

5. 문제가 생기면 즉시 중단합니다.

   ```bash
   python3 -m autopilot kill            # KILL 파일 생성: 이후 모든 run이 쓰기 없이 종료
   python3 -m autopilot kill --resume
   ```

운영 시에는 cron 등으로 매시 `run --live`, 매일 아침 `report`를 실행합니다.

## 어떻게 판단하나

한 번의 실행은 아래 순서로 판단하며, 앞 단계가 뒤 단계를 이깁니다.

| 순서 | 단계 | 동작 |
| --- | --- | --- |
| 0 | 사전 점검 | 킬스위치, 성과 데이터 유무, 전환추적 건전성. 이상이면 성과 기반 조정을 동결하고 알림 |
| 1 | 예산 방어 | 사이트 오늘 광고비가 상한 이상이면 전체 OFF, 다음 날 자동 ON |
| 2 | 스케줄 | `off_hours` 시간대에는 OFF, 끝나면 ON |
| 3 | 누수 판정 | 무전환 소진 또는 ROAS가 목표의 30% 미만이면 OFF |
| 4 | 입찰 조정 | `새 입찰가 = 현재 입찰가 × (추정 ROAS ÷ 목표 ROAS)^0.5`, ±20%/회, 10원 단위 |
| 5 | 재진입 | OFF 후 7일 × 2^(n-1)일 뒤 재시험. 3번 꺼지면 사람 검토 요청 |

설계 포인트:

- **입찰은 마지막 변경 이후 데이터로만 판단**합니다. 입찰을 바꾼 뒤에도 14일 창에 옛 높은 CPC가 남아 계속 깎이는 진동을 막기 위해서이며, 누수(무전환) 판정만 전체 창을 씁니다.
- **소표본 보정**: 클릭이 적은 광고는 사이트 평균 클릭당 매출로 끌어당겨 노이즈에 덜 흔들립니다. 클릭 30 미만은 아예 바꾸지 않습니다.
- **오탐 방지**: 사이트 전체 전환이 0인데 광고비가 크면 전환추적 장애로 보고 모든 성과 기반 조정을 멈춥니다. 데이터 수집이 실패하면 아무것도 바꾸지 않고 중단합니다.
- **대량 OFF는 사람 승인**: 24시간 동안 활성 광고의 25%를 넘는 OFF는 승인 대기로 보류합니다. 거절한 항목은 7일간 다시 올리지 않습니다.
- 사람이 직접 끈 광고, `[MANUAL]`로 시작하는 광고, `protected_ids`는 건드리지 않습니다.

## 구성

```text
autopilot/
  engine.py         판단 엔진 (순수 함수, 외부 호출 없음)
  runner.py         수집 -> 판단 -> 가드 -> 실행 -> 기록 -> 알림
  naver_client.py   네이버 검색광고 API (서명, 속도 제한 백오프, 조회/변경)
  store.py          SQLite: 실행 이력, 감사 로그, 광고별 상태, 알림, 승인
  simulator.py      가상 시장 + 같은 엔진/러너로 돌리는 시뮬레이션
  report.py         일일 요약 (텍스트, HTML)
  notify.py         표준출력 + 로그 파일 + 웹훅 (슬랙/디스코드 호환)
  config.py         TOML 설정 (오타·잘못된 값은 오류)
  cli.py            probe / run / simulate / report / approvals / kill
tests/              엔진, 클라이언트, 러너, 승인 흐름, 시뮬레이터, 설정, 리포트
```

모든 변경은 `actions` 테이블에 이전 값, 새 값, 사유 코드(`LEAK_NO_CONV`, `ROAS_LOW` 등)와 함께 남습니다.

## 알려진 한계

- 전환이 늦게 집계되면 ROAS가 낮게 보입니다. `roas_lag_adjust`로 보정하세요 (최근 지표와 14일 뒤 확정 지표를 비교해 값을 정합니다).
- ROAS를 높이는 가장 쉬운 방법은 입찰을 낮추는 것이고, 이는 매출(볼륨) 감소를 동반합니다. 목표 ROAS는 이익 기준으로 정하고 월 1회 점검하세요.
- 시뮬레이터의 시장 모델(클릭 탄력성, 전환율 분포)은 가정입니다. 파라미터 보정은 Phase 1의 실제 데이터로 하세요.
- 네이버 API 정책은 바뀔 수 있습니다. 오류가 나면 `probe`를 다시 실행해 응답 모양을 확인하세요.

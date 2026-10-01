# 네이버 쇼핑검색광고 오토파일럿

목표 ROAS 한 개만 정하면 입찰가 조정, 광고 ON/OFF, 일 예산 방어를 자동으로 수행하고, 사람은 일일 요약과 예외 승인만 처리하도록 만든 프로그램입니다.

- 기획안 (Figma): <https://www.figma.com/design/rJprk2JCfI6BcddA7ppCZx>
- 1회 실행 판단 흐름 (FigJam): <https://www.figma.com/board/YONxKmGBWj45t2dq56szXZ>

## 현재 상태 (솔직한 안내)

| 항목 | 상태 |
| --- | --- |
| 판단 엔진 (누수 OFF, 입찰 조정, 예산 방어, 스케줄, 재진입) | 구현, 테스트 91개 통과 |
| 가상 시장 시뮬레이션 | 구현. 로직 검증용이며 실제 성과의 증거가 아님 |
| API 서명, 광고그룹·키워드·소재 조회, ON/OFF, 광고그룹 입찰, 캠페인 일 예산 | 공식 샘플과 Swagger 스펙 기준으로 구현. **실계정 호출은 아직 안 함** |
| 쇼핑 상품(소재) 단위 입찰 | 구현. 소재의 입찰 정보(`adAttr`) 구조는 스펙에 자세히 없어 `probe`로 확인 필요 |
| `/stats` 구매 전환 필드 (`purchaseCcnt`, `purchaseConvAmt`) | 공식 스펙에 문서화됨. 다중 ID 요청에서 허용되는지는 `probe`가 확인 |
| Slack / Discord 알림, 일일 요약 전송, 전체 일 예산 상한 | 구현 |
| 상품 등록 자동화, 웹 대시보드 | 미구현 (기획안 Phase 4) |

실계정에 처음 연결할 때는 반드시 아래 "안전하게 시작하기" 순서를 따르세요.

## 빠른 시작

Python 3.11 이상 권장(테스트는 3.11에서만 실행함), 외부 패키지 없음(표준 라이브러리만 사용). 3.11 미만이면 `pip install tomli`가 필요하지만 그 환경은 검증하지 않았습니다.

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
   export SLACK_WEBHOOK_URL=...     # (선택) Slack 알림
   export DISCORD_WEBHOOK_URL=...   # (선택) Discord 알림
   ```

   예제 설정은 스마트스토어 쇼핑검색광고 기준입니다: 소재 단위(`level = "ad"`), 목표 ROAS 2,500%(쇼핑검색 단독), 일 광고비 상한 40만 원(전체 합산).

2. Phase 0 - `probe`로 실계정 응답 모양을 확인합니다 (읽기 전용). 출력의 키 값은 비밀이 아니지만, 공유 전에 광고주 정보가 없는지 확인하세요.

   ```bash
   python3 -m autopilot probe --site site_a
   ```

   확인할 것:

   - `campaignTp` 값(예: `SHOPPING`)과 `ad_types_seen`(예: `SHOPPING_PRODUCT_AD`)
   - `stats_fields.accepted`에 `purchaseCcnt`, `purchaseConvAmt`가 있는지. 없으면 `config.toml`의 `stat_conversions_field`, `stat_revenue_field`를 맞춥니다.
   - `ads_sample`의 `adAttr`에 `bidAmt`가 들어 있는지 (소재 입찰 변경이 이 구조에 의존합니다).
   - 광고비 `salesAmt`는 공식 스펙상 VAT 포함이라 `cost_multiplier = 1.0`이 맞습니다.

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

## VPS에서 운영하기

VPS를 권장합니다. 24시간 켜져 있고 IP가 고정이라, 나중에 커머스 API(고정 IP 필요)를 붙일 때도 그대로 쓸 수 있습니다. Mac mini도 가능하지만 절전, 재부팅, 가정용 회선 끊김을 직접 관리해야 합니다. 검색광고 API 자체의 IP 제한 여부는 공식 자료에서 확인하지 못했으니 `probe`가 성공하는지로 확인하세요.

```bash
git clone <저장소> /opt/ECC && cd /opt/ECC/projects/naver-ads-autopilot
python3 --version                       # 3.11 이상인지 확인
cp config.example.toml config.toml      # 값 수정
cp deploy/autopilot.env.example ~/.config/naver-ads-autopilot.env
chmod 600 ~/.config/naver-ads-autopilot.env   # 키와 웹훅 URL 입력
crontab -e                              # deploy/crontab.example 내용 붙여넣기
```

- `deploy/run.sh`가 저장소 밖의 환경변수 파일을 읽어 실행합니다 (키가 저장소나 크론 줄에 남지 않음).
- 매시 5분에 `run`, 매일 10:00에 `report --send`를 실행합니다. 10:10경 확인하는 기존 루틴 직전에 요약이 도착합니다.
- 처음 2주는 `--live` 없이 돌리세요.

## 목표 ROAS 2,500%에 대한 주의

쇼핑검색은 지출이 커질수록 ROAS가 낮아지는 경향이 있어, 높은 목표는 대개 지출을 크게 줄여야 달성됩니다. 실제 계정의 일별 이력으로 목표가 현실적인지 먼저 확인하세요(수치는 비공개 저장소의 자료라 이 문서에 적지 않습니다).

- 월별 지출 구간별 ROAS: 목표 ROAS를 넘은 달이 어느 지출 수준에서 나왔는지
- 한계 ROAS: 지출을 늘렸을 때 늘어난 매출 ÷ 늘어난 광고비. 마진율의 역수보다 크면 추가 지출도 이익입니다.
- 입찰 조정만으로는 큰 간극을 메우기 어렵고, 효율이 낮은 소재를 끄는 쪽(승인 대상)이 실질적인 수단입니다.

섀도 모드(dry-run) 2주 동안 소재별 효율 분포, 입찰을 낮췄을 때의 매출 감소폭, 승인 대기 건수를 먼저 확인하세요.

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
- **소표본 보정**: 클릭이 적은 소재·키워드는 같은 광고그룹(데이터가 부족하면 사이트) 평균 클릭당 매출로 끌어당겨 노이즈에 덜 흔들립니다. 클릭 30 미만은 아예 바꾸지 않습니다.
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

/**
 * 정책자금 데이터 (2026년 기준)
 *
 * 모든 한도·금리·기간·대상은 아래 공식 문서에서 옮긴 것이다.
 *  - S1 소진공: 중기부 공고 제2025-656호 + 3차 변경 제2026-448호(2026.07.10, 앞선 변경 통합본)
 *  - S2 중진공: 중기부 공고 제2025-649호 + 변경공고 제2026-464호(2026.07.28)
 *  - S3 소상공인정책자금 사이트(ols.semas.or.kr) 이용안내서 v3.9 및 접수현황(2026-10-13 확인)
 * 정책자금 기준금리는 분기마다 바뀌므로 수치를 넣지 않고 "기준금리 ± x%p"로 적는다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PF_DATA = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const AS_OF = '2026-10-13';

  const SOURCES = {
    S1: {
      label: '소진공 2026년 소상공인 정책자금 융자사업 공고 (제2025-656호, 3차 변경 제2026-448호)',
      url: 'https://www.mss.go.kr/site/smba/ex/bbs/View.do?cbIdx=310&bcIdx=1069735',
    },
    S2: {
      label: '중진공 2026년도 중소기업 정책자금 융자계획 공고 (제2025-649호, 변경 제2026-464호)',
      url: 'https://www.bizinfo.go.kr/sii/siia/selectSIIA200Detail.do?pblancId=PBLN_000000000124795',
    },
    S3: {
      label: '소상공인정책자금 사이트 이용안내 · 접수현황',
      url: 'https://ols.semas.or.kr',
    },
  };

  const AGENCIES = {
    semas: {
      name: '소상공인시장진흥공단',
      short: '소진공',
      audience: '소상공인',
      apply: 'ols.semas.or.kr (온라인) 또는 지역센터 방문',
      phone: '1533-0100 (1번 정책자금) · 1357',
    },
    kosmes: {
      name: '중소벤처기업진흥공단',
      short: '중진공',
      audience: '중소기업',
      apply: 'www.kosmes.or.kr (온라인)',
      phone: '1811-3655 · 1357',
    },
  };

  /* ---------- 서류 ---------- */
  // status: official = 공고·이용안내에 명시, typical = 일반적으로 요구되나 자금·창구별로 다름
  const DOCS = {
    'apply-form': {
      name: '온라인 신청서 입력',
      group: 'A',
      status: 'official',
      desc: '대표자 본인인증 후 업체·자금 선택, 약관 동의, 신청서 작성. 개업일자·업종·주요 사업내용·상시근로자 수·최근 3개년 평균 연매출·사업장 주소를 입력합니다. 대표자 본인 신청이 원칙입니다.',
    },
    consent: {
      name: '신용정보 조회 동의 · 자가진단 체크리스트 · 윤리준수 약속',
      group: 'A',
      status: 'official',
      desc: '자가진단 체크리스트는 모두 "아니오"일 때만 신청할 수 있습니다. 신청 전에 융자제한 자가진단표로 먼저 점검하세요.',
      forms: ['form-selfcheck'],
    },
    'biz-plan-semas': {
      name: '사업계획서 (소진공 온라인 입력)',
      group: 'A',
      status: 'official',
      desc: '직접대출 서류제출 화면에서 영업현황·경력·자금집행계획을 입력합니다. 자금집행계획 합계는 신청금액과 같아야 합니다.',
      forms: ['form-bp-smallbiz', 'form-fundplan'],
    },
    'required-upload': {
      name: '화면에 "필수"로 표시되는 서류 업로드',
      group: 'B',
      status: 'official',
      desc: '필수 서류 목록은 자금과 우대사항에 따라 신청 화면에 표시됩니다. 파일 형식은 PDF·JPG·GIF·PNG·HWP, 파일당 20MB, 항목당 10개까지입니다.',
    },
    'biz-reg': {
      name: '사업자등록증 (또는 사업자등록증명)',
      group: 'B',
      status: 'typical',
      desc: '신청서의 업종·개업일 확인용입니다. 발급일 제한이 있을 수 있으니 최근 발급본을 준비하세요.',
      where: { label: '홈택스', url: 'https://www.hometax.go.kr' },
    },
    'tax-cert': {
      name: '국세 · 지방세 납세증명서',
      group: 'B',
      status: 'typical',
      desc: '세금 체납은 융자제한 사유입니다(압류·매각 유예 등 예외 있음). 신청 전 체납 여부를 확인하세요.',
      where: { label: '홈택스(국세) · 위택스(지방세)', url: 'https://www.wetax.go.kr' },
    },
    'sales-proof': {
      name: '매출 증빙 (부가가치세 과세표준증명원 등)',
      group: 'B',
      status: 'typical',
      desc: '최근 3개년 평균 연매출액과 매출 감소율 확인에 쓰입니다.',
      where: { label: '홈택스', url: 'https://www.hometax.go.kr' },
    },
    lease: {
      name: '사업장 임대차계약서 사본',
      group: 'B',
      status: 'typical',
      desc: '임차 사업장인 경우. 자가 사업장이면 등기사항전부증명서.',
    },
    'insurance-roster': {
      name: '4대보험 사업장 가입자 명부',
      group: 'B',
      status: 'typical',
      desc: '상시근로자 수(소상공인 요건) 확인용입니다.',
      where: { label: '4대사회보험 정보연계센터', url: 'https://www.4insure.or.kr' },
    },
    bankbook: {
      name: '대표자(사업자) 명의 통장 사본',
      group: 'B',
      status: 'typical',
      desc: '직접대출 실행 계좌 확인용.',
    },
    'preference-proof': {
      name: '우대금리 증빙 (해당 시)',
      group: 'B',
      status: 'official',
      desc: '우대사항을 선택하면 증빙서류를 추가로 요청받을 수 있습니다. 대상: 컨설팅 이수, 제로페이·온누리상품권 가맹점, 여성기업·장애인기업, 자영업자 고용보험·전통시장 화재공제·풍수해보험·노란우산공제 가입, 직접대출 성실상환, 비수도권 소재.',
    },
    'disaster-cert': {
      name: '재해 중소기업(소상공인) 확인증',
      group: 'B',
      status: 'official',
      desc: '피해 지역 시·군·구청 등 지자체가 발급합니다.',
    },
    'disability-proof': {
      name: '장애인복지카드 · 국가유공자 카드/증서 · 장애인기업확인서 중 1개',
      group: 'B',
      status: 'official',
      desc: '장애인기업지원자금 신청 자격 증빙입니다.',
    },
    'credit-edu': {
      name: '신용관리 교육 이수 (소상공인 지식배움터)',
      group: 'A',
      status: 'official',
      desc: '신용취약소상공인자금은 신청 전에 edu.sbiz.or.kr 신용관리 교육을 이수해야 합니다.',
      where: { label: '소상공인 지식배움터', url: 'http://edu.sbiz.or.kr' },
    },
    'restart-proof': {
      name: '재창업·채무조정 요건 증빙',
      group: 'B',
      status: 'official',
      desc: '희망리턴패키지 재창업교육 수료, 폐업 이력, 채무조정 성실상환 확인 등 유형별 요건을 증빙합니다. 유형별 상세는 공고 확인.',
    },
    'refi-proof': {
      name: '대환 대상 대출 증빙 · 만기연장 애로 확인서',
      group: 'B',
      status: 'official',
      desc: '2025.6.30 이전에 받은 7% 이상 고금리 대출 또는 은행의 만기연장 애로 대출이 대상입니다. 만기연장 애로 확인서는 협조 가능한 취급은행(15곳)이 발급합니다.',
    },
    'youth-proof': {
      name: '청년 요건 증빙 (대표자 연령 또는 청년근로자 고용)',
      group: 'B',
      status: 'typical',
      desc: '만 39세 이하 대표자(업력 3년 미만) 또는 청년근로자 고용·유지 사실을 확인할 서류.',
    },
    'agency-confirm': {
      name: '정책자금(대리대출) 확인서 출력 → 금융기관 제출',
      group: 'C',
      status: 'official',
      desc: '확인서는 발급 승인 후 유효기간 90일 안에 출력합니다. 만료되면 접수기간 안에 다시 신청합니다.',
    },
    guarantee: {
      name: '신용보증서 발급 · 은행 대출 심사',
      group: 'C',
      status: 'official',
      desc: '대리대출은 지역신용보증재단 등에서 신용·사업성 평가 후 보증서를 발급하고, 금융기관이 대출을 심사·실행합니다. 신용·담보부 대출도 있습니다.',
    },
    'kosmes-required': {
      name: '융자 필요서류 (상담 후 별도 안내)',
      group: 'B',
      status: 'official',
      desc: '중진공 공고는 "제출서류는 상담 이후 별도 안내를 통해 제출"로 정하고 있습니다. 정책우선도 평가 통과 후 중진공 누리집에서 온라인으로 제출합니다.',
    },
    'kosmes-apply': {
      name: '온라인 융자 신청 (정보제공 동의 · 기업정보 제출)',
      group: 'A',
      status: 'official',
      desc: '신청기간 안에 신용정보 동의, 사전 기업진단, 기업정보를 제출합니다. 허위 작성 시 1년간 신청이 제한됩니다.',
    },
    'biz-plan-sme': {
      name: '사업계획서',
      group: 'B',
      status: 'typical',
      desc: '기업평가는 기술성·사업성·미래성장성·경영능력·사업계획의 타당성을 종합 평가합니다. 상담 전에 아래 양식으로 정리해 두면 좋습니다.',
      forms: ['form-bp-sme', 'form-fundplan'],
    },
    financials: {
      name: '최근 결산 재무제표',
      group: 'B',
      status: 'typical',
      desc: '업력 3년 미만은 기술사업성 평가 중심이라 요구 범위가 다를 수 있습니다.',
    },
    'corp-docs': {
      name: '법인등기부등본 · 주주명부 (법인)',
      group: 'B',
      status: 'typical',
      desc: '법인사업자인 경우.',
      where: { label: '인터넷등기소', url: 'https://www.iros.go.kr' },
    },
    'facility-docs': {
      name: '시설자금 증빙 (견적서 · 계약서 · 카탈로그 등)',
      group: 'B',
      status: 'typical',
      desc: '설비 구입·사업장 건축·매입 등 시설자금 신청 시.',
    },
    'tech-proof': {
      name: '기술 보유 증빙 (특허·실용신안 등록증, R&D 완료확인서, 기술인증서 등)',
      group: 'B',
      status: 'typical',
      desc: '공고가 정한 대상 기술 유형(R&D 성공, 특허 등록, 정부 인증, 기업부설연구소 등)에 해당함을 보여주는 서류.',
    },
    'export-proof': {
      name: '수출실적 증빙',
      group: 'B',
      status: 'typical',
      desc: '최근 1년(신청 전월 기준) 직·간접 수출실적 합계를 확인할 수 있는 자료.',
    },
    'special-proof': {
      name: '지정·승인·선정 확인서',
      group: 'B',
      status: 'typical',
      desc: '사업전환계획 승인, 통상변화대응지원기업 지정, 협동화실천계획 승인 등 자금별 선행 승인 서류.',
    },
    'damage-proof': {
      name: '피해 증빙 (재해 확인증 · 경영애로 사유 증빙)',
      group: 'B',
      status: 'official',
      desc: '재해는 지자체 발급 재해중소기업 확인증, 일시적 경영애로는 경영애로 사유와 매출·영업이익 10% 이상 감소 확인 자료. 신청기한은 피해 발생(비교 가능 시점) 후 6개월 이내입니다.',
    },
  };

  const SEMAS_DIRECT = ['apply-form', 'consent', 'biz-plan-semas', 'required-upload', 'biz-reg', 'tax-cert', 'sales-proof', 'lease', 'insurance-roster', 'bankbook', 'preference-proof'];
  const SEMAS_PROXY = ['apply-form', 'consent', 'required-upload', 'biz-reg', 'tax-cert', 'sales-proof', 'lease', 'insurance-roster', 'preference-proof', 'agency-confirm', 'guarantee'];
  const KOSMES_BASE = ['kosmes-apply', 'kosmes-required', 'biz-plan-sme', 'biz-reg', 'tax-cert', 'financials', 'corp-docs', 'facility-docs'];

  const mk = (o) => o;

  /* ---------- 자금 ---------- */
  const FUNDS = [
    /* ===== 소진공 ===== */
    mk({
      id: 'semas-general', agency: 'semas', category: '일반경영안정자금', name: '일반경영안정자금',
      summary: '업력 무관 소상공인의 운영자금. 가장 폭넓게 쓰는 기본 자금입니다.',
      methods: ['대리대출'], uses: ['운전'],
      limit: '연간 7천만원', rate: '기준금리 + 0.6%p (변동)', term: '5년 이내 (거치 2년 포함)',
      scale: '12,200억원 내외',
      target: ['「소상공인기본법」상 소상공인 (업력 무관)', '융자제외 업종이 아닐 것'],
      notes: ['부동산업 중 비주거용 건물 임대업(68112)은 "착한 임대인"에 한해 허용'],
      docs: SEMAS_PROXY, src: 'S1',
    }),
    mk({
      id: 'semas-disaster', agency: 'semas', category: '긴급경영안정자금', name: '긴급경영안정자금 · 재해',
      summary: '집중호우·태풍·폭설·화재 등 재해 피해 소상공인의 복구 자금.',
      methods: ['대리대출'], uses: ['운전'],
      limit: '1억원 (재해 유형 대출잔액 합산)', rate: '연 2.0% (고정)', term: '5년 이내 (거치 2년 포함)',
      scale: '긴급경영안정자금 합계 2,700억원 내외',
      target: ['지자체가 발급한 "재해 중소기업(소상공인) 확인증" 보유'],
      notes: ['압류·매각 유예, 징수특례, 체납처분 유예 중이라 금융기관 이용이 어려운 경우에 한해 직접대출 지원'],
      docs: SEMAS_PROXY.concat(['disaster-cert']), src: 'S1',
    }),
    mk({
      id: 'semas-temp', agency: 'semas', category: '긴급경영안정자금', name: '긴급경영안정자금 · 일시적 경영애로',
      summary: '매출이 급격히 줄어든 소상공인의 경영 안정 자금.',
      methods: ['대리대출', '직접대출(예외)'], uses: ['운전'],
      limit: '7천만원 (유형 대출잔액 합산)', rate: '기준금리 (가산 없음, 변동)', term: '5년 이내 (거치 2년 포함)',
      scale: '긴급경영안정자금 합계 2,700억원 내외',
      target: ['직전 매출과 직전전 매출(연도·반기·분기·월)을 비교해 15% 이상 감소', '예외: 고용위기지역·산업위기대응특별지역, 중소기업 특별지원지역, 상권활성화구역·자율상권구역, 산업위기선제대응지역 소재, 12·29여객기참사 피해자 확인서 보유 등'],
      notes: ['연매출 1억 4백만원 미만이면서 업력 7년 미만이라 금융기관 이용이 어려운 경우에 한해 직접대출 지원'],
      docs: SEMAS_PROXY, src: 'S1',
    }),
    mk({
      id: 'semas-homeplus', agency: 'semas', category: '긴급경영안정자금', name: '긴급경영안정자금 · 홈플러스 피해',
      summary: '홈플러스 회생절차 폐지결정에 따른 피해 소상공인 전용 자금(3차 변경에서 신설).',
      methods: ['직접대출'], uses: ['운전'],
      limit: '1억원', rate: '기준금리 − 0.5%p (변동)', term: '5년 이내 (거치 2년 포함)',
      scale: '+500억원 (3차 변경)',
      target: ['홈플러스 피해 소상공인 (세부 요건은 공고·지역센터에서 확인)'],
      notes: ['사이트 접수현황: 2026-07-15 ~ 자금 소진 시까지 (2026-10-13 확인)'],
      docs: SEMAS_DIRECT, src: 'S1',
    }),
    mk({
      id: 'semas-credit', agency: 'semas', category: '특별경영안정자금', name: '신용취약소상공인자금',
      summary: '중·저신용 소상공인 전용 운영자금.',
      methods: ['직접대출'], uses: ['운전'],
      limit: '3천만원 (과거 유사 자금 대출잔액 합산)', rate: '기준금리 + 1.6%p (변동)', term: '5년 이내 (거치 2년 포함)',
      scale: '7,000억원 내외',
      target: ['NCB 839점 이하 중·저신용 소상공인 (대출 신청 시점 NICE평가정보 개인신용점수 적용)', '소상공인 지식배움터 신용관리 교육을 사전 이수'],
      notes: ['대출 1년 후 신용점수가 70점 이상 오르거나 840점 이상으로 회복하면 금리 0.5%p 인하 신청 가능'],
      docs: SEMAS_DIRECT.concat(['credit-edu']), src: 'S1',
    }),
    mk({
      id: 'semas-refinance', agency: 'semas', category: '특별경영안정자금', name: '대환대출',
      summary: '7% 이상 고금리 대출 등을 연 4.5% 고정금리 장기 분할상환으로 바꿔주는 자금.',
      methods: ['대리대출'], uses: ['운전'],
      limit: '5천만원 (기존 대환 실행액 차감)', rate: '연 4.5% (고정)', term: '10년 (비거치 10년 분할 또는 2년 거치 후 8년 분할 중 택1)',
      scale: '3,000억원 내외',
      target: ['NCB 919점 이하 중·저신용 소상공인 (일부 요건 충족 시 신용점수 미적용)', '2025.6.30 이전 대출 중 은행·비은행권 7% 이상 고금리 대출 또는 은행 만기연장 애로 대출 보유'],
      notes: ['사이트 접수현황: 2026-01-05 ~ 자금 소진 시까지 (2026-10-13 확인)'],
      docs: SEMAS_PROXY.concat(['refi-proof']), src: 'S1',
    }),
    mk({
      id: 'semas-restart', agency: 'semas', category: '특별경영안정자금', name: '재도전특별자금',
      summary: '재창업·채무조정 성실상환·재기 사업화 소상공인 지원.',
      methods: ['직접대출'], uses: ['운전'],
      limit: '일반형 7천만원 · 희망형 1억원 · 도약형 2억원', rate: '일반 기준+1.6%p · 희망 기준+0.6%p · 도약 기준+0.4%p (변동)', term: '5년 이내 (거치 2년 포함)',
      scale: '1,000억원 내외',
      target: ['일반형: 재창업 준비·초기 단계, 채무조정 소상공인', '희망형: 희망리턴패키지 재기사업화 완료 또는 2026년 선정·협약', '도약형: 재창업 후 업력 2년 이상이며 성장·성실상환 요건 충족'],
      notes: ['유형별 세부 요건(교육 수료 시간, 상환 회차 등)이 다르므로 공고 확인'],
      docs: SEMAS_DIRECT.concat(['restart-proof']), src: 'S1',
    }),
    mk({
      id: 'semas-disabled', agency: 'semas', category: '특별경영안정자금', name: '장애인기업지원자금',
      summary: '장애인기업 전용 저금리 고정금리 자금.',
      methods: ['대리대출'], uses: ['운전'],
      limit: '1억원', rate: '연 2.0% (고정)', term: '7년 이내 (거치 2년 포함)',
      scale: '500억원 내외',
      target: ['장애인복지카드·국가유공자 카드/증서·장애인기업확인서 중 하나를 가진 장애 소상공인'],
      notes: [],
      docs: SEMAS_PROXY.concat(['disability-proof']), src: 'S1',
    }),
    mk({
      id: 'semas-youth', agency: 'semas', category: '특별경영안정자금', name: '청년고용연계자금',
      summary: '청년 대표 또는 청년을 고용한 소상공인 지원.',
      methods: ['대리대출'], uses: ['운전'],
      limit: '7천만원 (청년고용연계자금 대출잔액 합산)', rate: '기준금리 (가산 없음, 변동)', term: '5년 이내 (거치 2년 포함)',
      scale: '1,500억원 내외',
      target: ['아래 중 1개 이상', '① 업력 3년 미만 청년(만 39세 이하) 소상공인', '② 상시근로자 과반이 청년(만 39세 이하)', '③ 최근 1년 이내 청년근로자 1인 이상 고용·유지'],
      notes: [],
      docs: SEMAS_PROXY.concat(['youth-proof']), src: 'S1',
    }),
    mk({
      id: 'semas-sgongin', agency: 'semas', category: '성장기반자금', name: '소공인특화자금',
      summary: '숙련 기술 기반 제조업 소공인의 운전·시설 자금. 3차 변경본에는 일반형만 있습니다.',
      methods: ['대리대출'], uses: ['운전', '시설'],
      limit: '연간 운전 1억원 · 시설 5억원', rate: '기준금리 + 0.6%p (변동)', term: '운전 5년(거치 2년) · 시설 8년(거치 3년)',
      scale: '2,000억원 내외',
      target: ['업력 무관, 한국표준산업분류 "C"(제조업) 영위 소공인'],
      notes: ['사이트 접수현황: 2026-01-05 ~ 자금 소진 시까지 (2026-10-13 확인)'],
      docs: SEMAS_PROXY.concat(['facility-docs']), src: 'S1',
    }),
    mk({
      id: 'semas-innov', agency: 'semas', category: '성장기반자금', name: '혁신성장촉진자금',
      summary: '수출·매출 신장·스마트기술 도입 등 성장 유망 소상공인의 운전·시설 자금.',
      methods: ['직접대출'], uses: ['운전', '시설'],
      limit: '혁신형 연간 운전 2억원·시설 10억원 / 일반형 연간 운전 1억원·시설 5억원', rate: '기준금리 + 0.4%p (변동)', term: '운전 5년(거치 2년) · 시설 8년(거치 3년)',
      scale: '4,800억원 내외',
      target: ['혁신형: 수출 소상공인, 2년 연속 매출 10% 이상 신장, 스마트공장 도입, 강한소상공인·로컬크리에이터, 소상공인 졸업후보기업, 직접대출 성실상환', '일반형: 스마트기술, 백년소상공인, 사회연대경제 조직, 신사업창업사관학교 수료생'],
      notes: ['소상공인 졸업후보기업은 소기업으로 성장하면 금리 0.4%p 인하', '사이트 접수현황: 4분기 접수 2026-10-12 ~ 10-13 (2026-10-13 확인)'],
      docs: SEMAS_DIRECT.concat(['facility-docs']), src: 'S1',
    }),
    mk({
      id: 'semas-matching', agency: 'semas', category: '성장기반자금', name: '민간투자연계형 매칭융자',
      summary: '민간 투자자가 먼저 투자·펀딩하면 정책자금을 최대 5배까지 매칭합니다.',
      methods: ['직접대출'], uses: ['운전', '시설'],
      limit: '연간 민간투자금의 5배와 5억원 중 낮은 금액', rate: '기준금리 + 0.4%p (변동)', term: '8년 (거치 3년 포함)',
      scale: '360억원 내외',
      target: ['소진공이 지정한 전문 운영기관을 통해 투자금을 받고 "소상공인 선투자 추천서"를 발급받은 소상공인'],
      notes: [],
      docs: SEMAS_DIRECT.concat(['facility-docs']), src: 'S1',
    }),
    mk({
      id: 'semas-sangsaeng', agency: 'semas', category: '성장기반자금', name: '상생성장지원자금',
      summary: '온라인 플랫폼의 선별·육성과 정책자금을 결합한 온라인 진출 소상공인 지원.',
      methods: ['직접대출'], uses: ['운전', '시설'],
      limit: '일반형 운전 7천만원 / 성장형 운전 1억원·시설 5억원 / 도약형 운전 2억원·시설 10억원 (연간)', rate: '기준금리 + 0.4%p (변동)', term: '운전 5년(거치 2년) · 시설 8년(거치 3년)',
      scale: '260억원 내외',
      target: ['일반형: TOPS 프로그램 1단계 선정', '성장형: TOPS 2단계 선정 또는 소진공과 상생협약을 맺은 온라인 플랫폼의 추천', '도약형: 브랜드 소상공인 점프업 사업 선정'],
      notes: [],
      docs: SEMAS_DIRECT.concat(['facility-docs']), src: 'S1',
    }),

    /* ===== 중진공 ===== */
    mk({
      id: 'kosmes-startup', agency: 'kosmes', category: '혁신창업사업화자금', name: '창업기반지원자금 (일반)',
      summary: '업력 7년 미만 창업기업의 시설·운전 자금.',
      methods: ['직접대출', '대리대출', '성장공유형', '투자조건부'], uses: ['시설', '운전'],
      limit: '연간 60억원 (운전자금은 연간 5억원)', rate: '기준금리 − 0.3%p (변동)', term: '시설 10년(거치 담보 4·신용 3년) · 운전 5년(거치 2년)',
      scale: '혁신창업사업화자금 17,558억원',
      target: ['「중소기업창업 지원법」상 창업자 (업력 7년 미만, 예비창업자 포함)', '또는 신산업 창업 분야 업력 10년 이내 중소기업'],
      notes: ['공고 요약표는 시설자금 금리를 "기준금리 −0.6%p"로 적고 상세 항목은 "−0.3%p"로 적어 표기가 다릅니다. 신청 전 상담에서 확인하세요.', '소상공인은 원칙적으로 제외 (제조업·혁신성장 분야 영위 등 예외)'],
      docs: KOSMES_BASE, src: 'S2',
    }),
    mk({
      id: 'kosmes-youth', agency: 'kosmes', category: '혁신창업사업화자금', name: '청년전용창업자금',
      summary: '만 39세 이하 청년 대표의 초기 창업 자금.',
      methods: ['직접대출'], uses: ['시설', '운전'],
      limit: '기업당 최대 1억원 (제조업·중점지원분야는 2억원)', rate: '연 2.5% (고정)', term: '시설 10년(거치 담보 4·신용 3년) · 운전 6년(거치 3년)',
      scale: '혁신창업사업화자금 17,558억원',
      target: ['대표자 만 39세 이하이면서 업력 3년 미만인 중소기업 또는 창업하는 자', '창업성공패키지 참여 기업 등 추천받은 우수기업은 업력 7년 미만까지'],
      notes: ['중점지원분야를 영위하는 소상공인도 신청 가능', '자금 신청·접수 후 사업계획서 등으로 심의위원회 평가를 거칩니다.'],
      docs: KOSMES_BASE.concat(['youth-proof']), src: 'S2',
    }),
    mk({
      id: 'kosmes-tech', agency: 'kosmes', category: '혁신창업사업화자금', name: '개발기술사업화자금',
      summary: '특허·정부 R&D 등으로 확보한 기술의 사업화 자금.',
      methods: ['직접대출', '성장공유형', '투자조건부'], uses: ['시설', '운전'],
      limit: '연간 30억원 (운전 5억원). 혁신성장분야 일부 유형은 연간 60억원 (운전 10억원)', rate: '기준금리 (변동)', term: '시설 10년(거치 담보 4·신용 3년) · 운전 5년(거치 2년)',
      scale: '혁신창업사업화자금 17,558억원',
      target: ['정부·지자체 R&D 성공 기술, 특허·실용신안·저작권 등록 기술, 정부 인증 기술, 기업부설연구소 개발 기술 등을 사업화하려는 중소기업', '제품 양산 후 3년이 지난 기술은 제외 (초격차 분야는 5년)'],
      notes: [],
      docs: KOSMES_BASE.concat(['tech-proof']), src: 'S2',
    }),
    mk({
      id: 'kosmes-export-start', agency: 'kosmes', category: '신시장진출지원자금', name: '내수기업 수출기업화',
      summary: '수출실적 10만불 미만 내수·수출 초보기업의 운전 자금.',
      methods: ['직접대출', '성장공유형(해외법인 설립 예정)'], uses: ['운전'],
      limit: '연간 운전 10억원 (해외법인지원자금 성장공유형 연간 50억원)', rate: '기준금리 또는 고정금리', term: '5년 이내 (거치 2년)',
      scale: '신시장진출지원자금 융자 4,164억원 · 이차보전 1,630억원',
      target: ['최근 1년 수출실적 1불~10만불 미만, 수출지원사업 참여기업, 기술 수출 실적·계약 보유, 해외법인 운영(설립 예정) 중소기업', '「소상공인기본법 시행령」상 소상공인도 포함'],
      notes: [],
      docs: KOSMES_BASE.concat(['export-proof']), src: 'S2',
    }),
    mk({
      id: 'kosmes-export-global', agency: 'kosmes', category: '신시장진출지원자금', name: '수출기업 글로벌화',
      summary: '수출실적 10만불 이상 수출 유망기업 지원.',
      methods: ['직접대출', '성장공유형', '이차보전'], uses: ['시설', '운전'],
      limit: '연간 30억원 (운전 10억원). 수출 고성장기업 연간 60억원', rate: '기준금리 (변동)', term: '시설 10년(거치 담보 4·신용 3년) · 운전 5년(거치 2년)',
      scale: '신시장진출지원자금 융자 4,164억원 · 이차보전 1,630억원',
      target: ['최근 1년 수출실적 10만불 이상, 또는 해외법인 운영(설립 예정) 중소기업', '「소상공인기본법 시행령」상 소상공인도 포함'],
      notes: ['사업장 건축(토지 구입·건축)·사업장 매입 시설자금은 지원 불가'],
      docs: KOSMES_BASE.concat(['export-proof']), src: 'S2',
    }),
    mk({
      id: 'kosmes-innov-growth', agency: 'kosmes', category: '신성장기반자금', name: '혁신성장지원자금 (일반)',
      summary: '업력 7년 이상 중소기업의 시설 투자 중심 성장 자금.',
      methods: ['직접대출', '대리대출', '이차보전'], uses: ['시설', '운전(초기가동비)'],
      limit: '연간 60억원 (운전자금은 연간 5억원)', rate: '기준금리 + 0.5%p (국가핵심기술 보유 기업은 기준금리)', term: '시설 10년(거치 담보 4·신용 3년) · 운전 5년(거치 2년)',
      scale: '신성장기반자금 융자 1조 811억원 · 이차보전 2,040억원',
      target: ['업력 7년 이상 중소기업 (창업자에 해당하지 않는 업력 7년 미만 포함)', '이차보전 대상: 최근 3년 이내 시설을 도입한 업력 7년 이상 기업'],
      notes: ['운전자금은 시설자금을 대출받은 기업의 시설 도입 후 초기가동비(시설자금의 50% 이내)가 원칙'],
      docs: KOSMES_BASE, src: 'S2',
    }),
    mk({
      id: 'kosmes-coop', agency: 'kosmes', category: '신성장기반자금', name: '혁신성장지원자금 (협동화)',
      summary: '공동생산시설·원자재 공동구매를 추진하는 협동화 사업 자금.',
      methods: ['직접대출', '대리대출'], uses: ['시설', '운전'],
      limit: '연간 100억원 (운전 15억원)', rate: '기준금리 (변동)', term: '시설 10년(거치 5년) · 운전 5년(거치 2년)',
      scale: '신성장기반자금 융자 1조 811억원',
      target: ['3개 이상 중소기업이 규합해 협동화실천계획 승인을 받은 자', '2개 이상 중소기업이 규합해 협업사업계획 승인을 받은 자'],
      notes: ['업력 제한 없음'],
      docs: KOSMES_BASE.concat(['special-proof']), src: 'S2',
    }),
    mk({
      id: 'kosmes-netzero', agency: 'kosmes', category: '신성장기반자금', name: 'Net-Zero 유망기업 지원',
      summary: '그린기술 사업화와 저탄소·친환경 제조 전환 기업 지원.',
      methods: ['직접대출', '대리대출', '이차보전'], uses: ['시설', '운전(초기가동비)'],
      limit: '연간 60억원 (운전 5억원)', rate: '기준금리 + 0.5%p (변동)', term: '시설 10년(거치 담보 4·신용 3년) · 운전 5년(거치 2년)',
      scale: '신성장기반자금 융자 1조 811억원 · 이차보전 2,040억원',
      target: ['신재생에너지·탄소저감 등 그린분야 영위·기술 사업화 기업', '친환경 소재 전환, 오염물질 저감·에너지 효율화 설비 도입 기업 등'],
      notes: [],
      docs: KOSMES_BASE, src: 'S2',
    }),
    mk({
      id: 'kosmes-smart', agency: 'kosmes', category: '신성장기반자금', name: '제조현장 스마트화',
      summary: '스마트공장 등 자동화·ICT 기반 생산 효율화 설비 도입 자금.',
      methods: ['직접대출', '대리대출', '이차보전'], uses: ['시설', '운전(초기가동비)'],
      limit: '연간 100억원 (운전 10억원)', rate: '기준금리 (변동)', term: '시설 10년(거치 담보 4·신용 3년) · 운전 5년(거치 2년)',
      scale: '신성장기반자금 융자 1조 811억원 · 이차보전 2,040억원',
      target: ['정부 등의 스마트공장 지원사업 참여기업', '스마트공장 등 ICT 기반 생산 효율화 자동화 시설 도입 기업'],
      notes: [],
      docs: KOSMES_BASE, src: 'S2',
    }),
    mk({
      id: 'kosmes-conversion', agency: 'kosmes', category: '재도약지원자금', name: '사업전환자금',
      summary: '업종 전환·추가·신사업 진출 계획을 승인받은 기업 지원.',
      methods: ['직접대출', '대리대출'], uses: ['시설', '운전'],
      limit: '연간 100억원 (운전 5억원)', rate: '기준금리 (변동)', term: '시설 10년(거치 담보 5·신용 4년) · 운전 6년(거치 3년)',
      scale: '재도약지원자금 6,625억원',
      target: ['「중소기업 사업전환 촉진에 관한 특별법」상 사업전환계획 또는 공동사업전환계획 승인 후 5년 미만', '상시근로자 5인 이상이며 타당성 평가를 통과한 기업'],
      notes: ['「기업활력법」상 사업재편계획 승인 후 5년 미만 기업도 같은 한도로 지원'],
      docs: KOSMES_BASE.concat(['special-proof']), src: 'S2',
    }),
    mk({
      id: 'kosmes-trade', agency: 'kosmes', category: '재도약지원자금', name: '통상변화대응 (기존 무역조정)',
      summary: '통상환경 변화로 피해를 입어 지원기업으로 지정된 중소기업.',
      methods: ['직접대출', '대리대출'], uses: ['시설', '운전'],
      limit: '연간 60억원 (운전 5억원)', rate: '연 2.0% (고정)', term: '시설 10년(거치 담보 5·신용 4년) · 운전 6년(거치 3년)',
      scale: '재도약지원자금 6,625억원',
      target: ['통상변화대응지원기업으로 지정되고 지정일로부터 3년 미만인 중소기업'],
      notes: [],
      docs: KOSMES_BASE.concat(['special-proof']), src: 'S2',
    }),
    mk({
      id: 'kosmes-restructure', agency: 'kosmes', category: '재도약지원자금', name: '구조개선전용자금',
      summary: '부실징후 기업의 선제적 자율구조개선 등 경영 정상화 자금.',
      methods: ['직접대출'], uses: ['시설', '운전'],
      limit: '일반: 운전 3년간 10억원 / 선제적 자율구조개선: 시설 연 60억원, 운전 3년간 15억원(연 10억원)', rate: '일반 기준금리(변동) · 선제적 자율구조개선 연 2.5% (고정)', term: '시설 10년 · 운전 5년(거치 2년)',
      scale: '재도약지원자금 6,625억원',
      target: ['진로제시컨설팅에서 구조개선 대상으로 판정된 기업(정책금융기관 지정 부실징후기업, 워크아웃·회생계획 이행 기업 등)', '캠코 협업 금융지원 대상 기업', '선제적 자율구조개선 프로그램 지원 결정 기업'],
      notes: ['진로제시컨설팅 시 컨설팅 비용의 10%와 부가세를 기업이 부담'],
      docs: KOSMES_BASE.concat(['special-proof']), src: 'S2',
    }),
    mk({
      id: 'kosmes-restart', agency: 'kosmes', category: '재도약지원자금', name: '재창업자금',
      summary: '폐업 후 재창업한 기업인의 재기 지원.',
      methods: ['직접대출', '대리대출'], uses: ['시설', '운전'],
      limit: '연간 60억원 (운전 5억원, 성실경영 심층평가 통과 시 운전 10억원)', rate: '기준금리 (성실경영 심층평가 통과 시 −0.3%p)', term: '시설 10년(거치 4년) · 운전 6년(거치 3년)',
      scale: '재도약지원자금 6,625억원',
      target: ['중소기업을 폐업하고 새로 설립한 업력 7년 미만(신산업 분야 10년 이내) 재창업기업 또는 예비재창업자', '자금조달 애로 또는 신용회복 공공정보 등록, 폐업 이력, 성실경영평가 통과를 모두 충족'],
      notes: ['업력 1년 미만은 역량평가와 초기재창업심의위원회 평가를 합산해 결정'],
      docs: KOSMES_BASE.concat(['restart-proof']), src: 'S2',
    }),
    mk({
      id: 'kosmes-disaster', agency: 'kosmes', category: '긴급경영안정자금', name: '긴급경영안정자금 · 재해중소기업',
      summary: '자연재난·사회재난 피해 중소기업의 복구 운전 자금.',
      methods: ['직접대출'], uses: ['운전'],
      limit: '피해금액 이내 최대 10억원 (3년간 15억원)', rate: '연 1.9% (고정)', term: '5년 이내 (거치 2년)',
      scale: '긴급경영안정 5,000억원',
      target: ['「재해 중소기업 지원지침」상 자연재난·사회재난 피해 기업 (시장·군수·구청장이 발급한 재해중소기업 확인증 제출)'],
      notes: ['수시 접수 가능'],
      docs: KOSMES_BASE.concat(['damage-proof']), src: 'S2',
    }),
    mk({
      id: 'kosmes-temp', agency: 'kosmes', category: '긴급경영안정자금', name: '긴급경영안정자금 · 일시적 경영애로',
      summary: '보호무역·환율·대기업 구조조정·주요 거래처 도산 등으로 피해를 입은 기업.',
      methods: ['직접대출'], uses: ['운전'],
      limit: '10억원 (3년간 15억원)', rate: '기준금리 + 0.5%p (변동)', term: '5년 이내 (거치 2년)',
      scale: '긴급경영안정 5,000억원',
      target: ['공고가 정한 경영애로 사유가 있고 매출액 또는 영업이익이 10% 이상 감소(대형사고는 피해 1억원 이상)한 기업 중 경영정상화 가능성이 큰 기업', '신청기한: 피해 발생(비교 가능 시점) 후 6개월 이내'],
      notes: ['제품·서비스의 시장성 부족 등에 따른 영업부진은 제외'],
      docs: KOSMES_BASE.concat(['damage-proof']), src: 'S2',
    }),
  ];

  const FORMS = [
    {
      id: 'form-bp-smallbiz', title: '사업계획서 (소상공인용)',
      desc: '소진공 직접대출 서류제출 화면의 영업현황·경력·자금집행계획 항목 순서로 구성했습니다. 웹폼에 옮겨 입력하기 전 초안으로 쓰세요.',
      blank: { file: 'forms/01-business-plan-smallbiz-blank.docx', name: '사업계획서_소상공인용_양식.docx' },
      sample: { file: 'forms/01-business-plan-smallbiz-sample.docx', name: '사업계획서_소상공인용_작성예시.docx' },
    },
    {
      id: 'form-fundplan', title: '자금집행계획표 · 상환 시뮬레이터',
      desc: '용도별 집행계획을 적으면 합계가 신청금액과 맞는지 바로 확인합니다. 두 번째 시트에서 원금균등 상환 일정을 계산합니다.',
      blank: { file: 'forms/02-fund-plan-blank.xlsx', name: '자금집행계획표_양식.xlsx' },
      sample: { file: 'forms/02-fund-plan-sample.xlsx', name: '자금집행계획표_작성예시.xlsx' },
    },
    {
      id: 'form-bp-sme', title: '사업계획서 (중소기업용)',
      desc: '중진공 기업평가 항목(기술성·사업성·미래성장성·경영능력·계획의 타당성)을 기준으로 상담 전에 정리해 두는 양식입니다.',
      blank: { file: 'forms/03-business-plan-sme-blank.docx', name: '사업계획서_중소기업용_양식.docx' },
      sample: { file: 'forms/03-business-plan-sme-sample.docx', name: '사업계획서_중소기업용_작성예시.docx' },
    },
    {
      id: 'form-proxy', title: '위임장',
      desc: '대표자 본인이 아닌 사람이 증명서 발급 등을 대신 할 때 쓰는 위임장입니다. 센터별 요구 서류는 관할 센터에 확인하세요.',
      blank: { file: 'forms/04-proxy-blank.docx', name: '위임장_양식.docx' },
      sample: { file: 'forms/04-proxy-sample.docx', name: '위임장_작성예시.docx' },
    },
    {
      id: 'form-selfcheck', title: '융자제한 자가진단표',
      desc: '소진공 융자제한 8개 항목과 중진공 융자제한 항목을 한 장으로 점검합니다. 신청 화면의 자가진단 체크리스트에 앞서 미리 확인하세요.',
      blank: { file: 'forms/05-self-check.docx', name: '융자제한_자가진단표.docx' },
      sample: null,
    },
  ];

  const SCHEDULE = {
    asOf: AS_OF,
    source: 'S3',
    items: [
      { type: '대리대출', name: '4분기 정책자금 접수', period: '2026-10-06 ~ 2026-12-23' },
      { type: '직접대출', name: '10월 신용취약소상공인자금', period: '2026-10-12 ~ 2026-10-13' },
      { type: '직접대출', name: '4분기 혁신성장촉진자금', period: '2026-10-12 ~ 2026-10-13' },
      { type: '직접대출', name: '일시적경영애로자금 (홈플러스 피해 소상공인)', period: '2026-07-15 ~ 자금 소진 시까지' },
      { type: '대리대출', name: '소상공인 대환대출', period: '2026-01-05 ~ 자금 소진 시까지' },
      { type: '대리대출', name: '소공인특화자금', period: '2026-01-05 ~ 자금 소진 시까지' },
      { type: '직접대출', name: '상생성장지원자금', period: '2026-01-12 ~ 자금 소진 시까지' },
      { type: '직접대출', name: '민간투자연계형 매칭융자', period: '2026-01-12 ~ 자금 소진 시까지' },
      { type: '직접대출', name: '혁신성장촉진자금 (소상공인 졸업후보기업)', period: '2026-01-12 ~ 자금 소진 시까지' },
      { type: '직접대출', name: '혁신성장촉진자금 (사회연대경제조직)', period: '2026-01-12 ~ 자금 소진 시까지' },
      { type: '상환연장', name: '정책자금 상환연장', period: '상시 접수' },
    ],
  };

  const CONTACTS = [
    { name: '소상공인 통합콜센터', tel: '1533-0100', note: '1번 정책자금 · 채무조정 · 재기지원 상담' },
    { name: '중소기업 통합콜센터', tel: '1357', note: '중소기업·소상공인 지원사업 전반' },
    { name: '중진공 정책자금 전담콜센터', tel: '1811-3655', note: '중소기업 정책자금 문의' },
    { name: '지역신용보증재단', tel: '1588-7365', note: '대리대출 보증서 발급 (전국 17곳)' },
    { name: '신용보증기금', tel: '1588-6565', note: '보증서 발급' },
    { name: '기술보증기금', tel: '1544-1120', note: '보증서 발급' },
  ];

  const LINKS = [
    { name: '소상공인정책자금 사이트', url: 'https://ols.semas.or.kr', note: '소진공 직접·대리대출 신청' },
    { name: '중진공 누리집', url: 'https://www.kosmes.or.kr', note: '정책자금 신청·지역별 일정 공지' },
    { name: '기업마당', url: 'https://www.bizinfo.go.kr', note: '공고 원문' },
    { name: '정부24', url: 'https://www.gov.kr', note: '증명서 발급' },
  ];

  return { AS_OF, SOURCES, AGENCIES, DOCS, FUNDS, FORMS, SCHEDULE, CONTACTS, LINKS };
});

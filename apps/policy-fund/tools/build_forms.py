#!/usr/bin/env python3
"""서류 양식(docx/xlsx) 생성기.

사용법: python3 tools/build_forms.py   (apps/policy-fund 에서 실행)
필요 패키지: python-docx, openpyxl

생성물은 forms/ 에 저장된다. 작성예시의 상호·이름·금액은 모두 가상 데이터다.
항목 구성은 소진공 사이트 이용안내(영업현황·경력·자금집행계획)와
중진공 기업평가 항목(기술성·사업성·미래성장성·경영능력·계획의 타당성)을 따른다.
공식 서식이 아니므로 실제 신청은 각 기관 온라인 시스템에서 입력·제출한다.
"""
import os
from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor, Cm
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.datavalidation import DataValidation

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "forms")
os.makedirs(OUT, exist_ok=True)

FONT = "맑은 고딕"
NOTICE = "본 문서는 신청 준비용 참고 양식이며 공식 서식이 아닙니다. 실제 신청은 해당 기관의 온라인 시스템에서 입력·제출하세요."
SAMPLE_NOTICE = "작성예시 (가상 데이터): 상호·성명·금액은 모두 설명을 위해 만든 가상 값입니다. 본인 사업에 맞게 바꿔 쓰세요."
GRAY = RGBColor(0x59, 0x59, 0x59)
ACCENT = RGBColor(0x1F, 0x4E, 0x79)


# ---------- docx helpers ----------
def set_font(run, size=10.5, bold=False, color=None, italic=False):
    run.font.name = FONT
    run._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    run.font.size = Pt(size)
    run.bold = bold
    run.italic = italic
    if color is not None:
        run.font.color.rgb = color


def new_doc(title, subtitle, sample):
    d = Document()
    sec = d.sections[0]
    sec.left_margin = sec.right_margin = Cm(2)
    sec.top_margin = sec.bottom_margin = Cm(1.8)
    st = d.styles["Normal"]
    st.font.name = FONT
    st.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    st.font.size = Pt(10.5)
    p = d.add_paragraph()
    r = p.add_run(title)
    set_font(r, 20, True, ACCENT)
    p = d.add_paragraph()
    set_font(p.add_run(subtitle), 10.5, color=GRAY)
    note = SAMPLE_NOTICE if sample else NOTICE
    t = d.add_table(rows=1, cols=1)
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    shade(t.rows[0].cells[0], "FFF4CE" if sample else "EEF3F8")
    c = t.rows[0].cells[0]
    c.text = ""
    set_font(c.paragraphs[0].add_run(note), 9.5, color=RGBColor(0x40, 0x40, 0x40))
    d.add_paragraph()
    return d


def shade(cell, hex_fill):
    tcPr = cell._element.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_fill)
    tcPr.append(shd)


def h(d, text):
    p = d.add_paragraph()
    p.paragraph_format.space_before = Pt(10)
    p.paragraph_format.space_after = Pt(3)
    set_font(p.add_run(text), 13, True, ACCENT)


def hint(d, text):
    p = d.add_paragraph()
    p.paragraph_format.space_after = Pt(3)
    set_font(p.add_run("작성 안내  " + text), 9, color=GRAY, italic=True)


def para(d, text, bold=False, size=10.5):
    p = d.add_paragraph()
    set_font(p.add_run(text), size, bold)
    return p


def table(d, header, rows, widths=None, label_col=False):
    t = d.add_table(rows=1, cols=len(header))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, text in enumerate(header):
        c = t.rows[0].cells[i]
        c.text = ""
        shade(c, "DCE6F1")
        set_font(c.paragraphs[0].add_run(text), 10, True)
        c.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
    for row in rows:
        cells = t.add_row().cells
        for i, text in enumerate(row):
            cells[i].text = ""
            if label_col and i == 0:
                shade(cells[i], "F2F2F2")
            set_font(cells[i].paragraphs[0].add_run(str(text)), 10, bold=(label_col and i == 0))
    if widths:
        for row in t.rows:
            for i, w in enumerate(widths):
                row.cells[i].width = Cm(w)
    d.add_paragraph()
    return t


def kv(d, rows, widths=(4.2, 12.8)):
    return table(d, ["항목", "내용"], rows, widths=list(widths), label_col=True)


def save(d, name):
    d.save(os.path.join(OUT, name))
    print("wrote", name)


# ---------- 01 사업계획서 (소상공인용) ----------
def bp_smallbiz(sample):
    S = sample
    d = new_doc("사업계획서 (소상공인용)", "소상공인시장진흥공단 정책자금 직접대출 서류제출: 영업현황 · 경력 · 자금집행계획", S)
    h(d, "1. 업체 개요")
    hint(d, "신청서에 입력하는 개업일자·업종·주요 사업내용·상시근로자 수·최근 3개년 평균 연매출·사업장 주소와 같은 값으로 적습니다.")
    kv(d, [
        ["상호", "예시분식" if S else ""],
        ["대표자", "홍길동 (가상)" if S else ""],
        ["개업일자", "2021-03-02" if S else ""],
        ["업종 (표준산업분류)", "음식점업 (분식)" if S else ""],
        ["사업장 주소", "예시시 예시구 예시로 12, 1층" if S else ""],
        ["상시근로자 수", "2명" if S else ""],
        ["최근 3개년 평균 연매출액", "180,000,000원" if S else ""],
        ["주요 사업내용 (한 줄)", "학교 인근 분식 매장 운영 및 배달" if S else ""],
        ["신청 자금명", "일반경영안정자금 (대리대출)" if S else ""],
        ["신청 금액", "50,000,000원" if S else ""],
    ])
    h(d, "2. 영업현황")
    hint(d, "심사자가 사업을 한눈에 이해하도록 숫자와 사실 위주로 적습니다. 과장은 심사에서 불리합니다.")
    para(d, "2-1. 주요 상품·서비스와 판매 방식", True)
    table(d, ["상품·서비스", "판매 방식", "매출 비중", "대표 가격"], [
        ["떡볶이·김밥 세트", "매장 + 배달앱", "55%", "8,500원"] if S else ["", "", "", ""],
        ["튀김·분식 단품", "매장 + 포장", "30%", "3,000~5,000원"] if S else ["", "", "", ""],
        ["도시락 단체 주문", "전화 주문", "15%", "7,000원"] if S else ["", "", "", ""],
    ], widths=[5, 4.5, 3, 4.5])
    para(d, "2-2. 주요 고객과 거래처", True)
    para(d, "인근 중·고등학교 학생과 교직원, 주변 사무실 직장인이 주 고객이며, 식자재는 지역 도매업체 2곳에서 월 단위 정산으로 구매합니다." if S else "(주 고객층, 거래 비중이 큰 거래처, 결제 조건을 적어 주세요.)")
    para(d, "2-3. 최근 3개년 매출 추이", True)
    table(d, ["연도", "연 매출액(원)", "전년 대비", "변동 사유"], [
        ["2023", "165,000,000", "-", "개업 3년차 안정화"],
        ["2024", "182,000,000", "+10.3%", "배달앱 입점 확대"],
        ["2025", "193,000,000", "+6.0%", "단체 도시락 주문 증가"],
    ] if S else [["", "", "", ""]] * 3, widths=[2.5, 4.5, 3, 7])
    para(d, "2-4. 경쟁 환경과 강점", True)
    para(d, "반경 500m 내 분식점은 3곳입니다. 직접 만든 소스와 방학 기간 단체 도시락이 차별점이며 재방문율이 높습니다." if S else "(주변 경쟁 상황과 우리 가게만의 강점을 적어 주세요.)")
    para(d, "2-5. 최근 매출 변동과 원인", True)
    para(d, "올해 하반기 식자재 단가 상승으로 매출원가가 늘어 운영자금이 부족합니다. 매출은 전년과 비슷한 수준을 유지하고 있습니다." if S else "(최근 매출이 늘거나 줄었다면 그 이유와 앞으로의 전망을 적어 주세요.)")
    h(d, "3. 경력")
    hint(d, "대표자의 사업 관련 경력, 자격·면허를 적습니다. 같은 업종 경험이 있으면 가장 먼저 적습니다.")
    table(d, ["기간", "근무처·사업", "담당 업무", "비고"], [
        ["2015.03~2020.12", "예시식품(주)", "조리·메뉴 개발", "한식조리사 자격 취득"],
        ["2021.03~현재", "예시분식", "대표 · 운영 전반", ""],
    ] if S else [["", "", "", ""]] * 3, widths=[3.5, 5, 5, 3.5])
    h(d, "4. 자금집행계획")
    hint(d, "합계가 신청금액과 같아야 합니다. 사업과 무관한 용도로 쓰면 불이익이 있습니다. 자세한 계산은 자금집행계획표(xlsx)를 쓰세요.")
    table(d, ["구분", "세부 용도", "거래처·내용", "금액(원)", "집행 시기"], [
        ["운전", "식자재 구입", "지역 도매업체 2곳", "20,000,000", "대출 후 1~3개월"],
        ["운전", "임차료", "사업장 월세 6개월분", "12,000,000", "매월"],
        ["운전", "인건비", "직원 2명 급여", "10,000,000", "매월"],
        ["운전", "홍보·배달 수수료", "배달앱 광고비", "8,000,000", "대출 후 1~6개월"],
        ["", "합계", "", "50,000,000", ""],
    ] if S else [["", "", "", "", ""]] * 5, widths=[2, 4.5, 4.5, 3.5, 3])
    h(d, "5. 상환 계획")
    hint(d, "월 평균 매출, 고정비, 상환 가능 금액을 간단히 적습니다.")
    table(d, ["항목", "월 평균 금액(원)", "근거"], [
        ["매출", "16,000,000", "최근 12개월 평균"],
        ["매출원가·고정비", "13,000,000", "식자재·임차료·인건비·공과금"],
        ["상환 가능 금액", "1,000,000 이상", "거치 기간 후 원금 분할상환 가정"],
    ] if S else [["", "", ""]] * 3, widths=[5, 5, 7])
    h(d, "6. 유의사항 확인")
    para(d, "신청 화면에서는 '사업과 무관한 용도'와 '불이익' 문구를 직접 입력하고 유의사항에 체크하면 자동 서명됩니다. 아래에 미리 읽고 확인 서명해 두세요.")
    kv(d, [["확인 문구", "대출금을 사업과 무관한 용도로 사용할 경우 자금 조기회수 등 불이익을 받을 수 있음을 확인합니다."],
           ["작성일 / 대표자", "2026-00-00 / 홍길동 (인)" if S else "          년     월     일 /                (인)"]])
    return d


# ---------- 03 사업계획서 (중소기업용) ----------
def bp_sme(sample):
    S = sample
    d = new_doc("사업계획서 (중소기업용)", "중진공 정책자금 상담 · 기업평가 대비: 기술성 · 사업성 · 미래성장성 · 경영능력 · 계획의 타당성", S)
    h(d, "1. 기업 개요")
    hint(d, "업력은 사업개시일부터 신청서 제출일까지 계산합니다(법인 전환은 최초 창업일 기준).")
    kv(d, [
        ["기업명 / 대표자", "예시정밀(주) / 김예시 (가상)" if S else ""],
        ["설립일 · 업력", "2016-05-10 · 10년 5개월" if S else ""],
        ["업종 · 주요 제품", "금속가공 · 자동차 부품용 정밀 가공품" if S else ""],
        ["소재지 · 상시근로자", "예시시 산업단지 · 18명" if S else ""],
        ["최근 3개년 매출액", "2023: 21.0억 / 2024: 24.5억 / 2025: 28.2억원" if S else ""],
        ["신청 자금 · 금액 · 용도", "혁신성장지원자금(일반) · 5억원 · 시설자금(설비 구입)" if S else ""],
    ])
    h(d, "2. 대표자 및 경영진 (경영능력)")
    table(d, ["성명·직책", "주요 경력", "지분율", "담당"], [
        ["김예시 · 대표이사", "자동차 부품 제조 15년, 기계가공기능장", "70%", "경영 총괄"],
        ["박예시 · 공장장", "정밀가공 12년", "10%", "생산·품질"],
    ] if S else [["", "", "", ""]] * 3, widths=[4, 7, 2.5, 3.5])
    h(d, "3. 사업 내용과 기술 (기술성)")
    hint(d, "특허·인증·R&D 이력은 번호와 날짜까지 적습니다. 평가자가 확인할 수 있어야 합니다.")
    para(d, "주요 제품·서비스와 경쟁력", True)
    para(d, "5축 가공 기반 정밀 부품을 공급합니다. 공차 ±0.005mm를 안정적으로 맞추는 공정 노하우가 강점이며, 불량률은 0.4%입니다." if S else "(제품, 핵심 기술, 경쟁사 대비 차별점)")
    para(d, "기술 보유 현황", True)
    table(d, ["구분", "명칭·번호", "등록·인증일", "활용"], [
        ["특허", "정밀 고정 지그 (제10-0000000호, 가상)", "2022-08-11", "주력 제품 공정"],
        ["인증", "ISO 9001 (가상)", "2023-02-03", "납품 요건"],
    ] if S else [["", "", "", ""]] * 3, widths=[2.5, 7, 3.5, 4])
    h(d, "4. 시장과 영업 (사업성)")
    para(d, "주요 거래처 3곳이 매출의 68%를 차지하며 모두 3년 이상 거래 중입니다. 전기차 부품 수주 문의가 늘고 있습니다." if S else "(시장 규모와 성장성, 주요 고객과 거래 비중, 수주 현황·계획)")
    h(d, "5. 투자 계획과 자금 소요 (계획의 타당성)")
    hint(d, "시설자금은 견적서 금액과 일치하게, 운전자금은 사용 항목별로 적습니다.")
    table(d, ["구분", "내용", "소요액(억원)", "조달 방법"], [
        ["시설", "5축 머시닝센터 1대(견적서 기준)", "6.0", "정책자금 5.0 + 자기자금 1.0"],
        ["운전", "설비 도입 후 초기가동비", "0.5", "자기자금"],
        ["", "합계", "6.5", ""],
    ] if S else [["", "", "", ""]] * 3, widths=[2.5, 7, 3, 4.5])
    h(d, "6. 고용 · 수출 계획 (미래성장성)")
    hint(d, "고용 창출과 수출 실적은 기업평가에 반영됩니다. 최근 1년 증가 인원과 향후 계획을 적습니다.")
    kv(d, [["고용", "최근 1년 3명 증가, 설비 도입 후 2명 추가 채용 계획" if S else ""],
           ["수출", "직접 수출 없음, 협력사 경유 간접 수출 연 0.8억원 추정" if S else ""]])
    h(d, "7. 재무 현황과 전망")
    table(d, ["구분", "2023", "2024", "2025", "2026(예상)", "2027(예상)"], [
        ["매출액(억)", "21.0", "24.5", "28.2", "32.0", "36.0"],
        ["영업이익(억)", "1.6", "2.0", "2.5", "3.1", "3.6"],
        ["부채비율(%)", "145", "132", "120", "128", "115"],
    ] if S else [["", "", "", "", "", ""]] * 3, widths=[3.2, 2.6, 2.6, 2.6, 3, 3])
    h(d, "8. 상환 계획과 위험 요인")
    para(d, "영업이익과 감가상각비로 연 원리금 약 1.1억원을 상환할 수 있습니다. 주요 거래처 의존도는 신규 거래처 2곳 확보로 낮출 계획입니다." if S else "(상환 재원, 위험 요인과 대응)")
    return d


# ---------- 04 위임장 ----------
def proxy(sample):
    S = sample
    d = new_doc("위 임 장", "증명서 발급 · 서류 제출 등을 대리인이 할 때 사용", S)
    h(d, "위임인 (사업자 대표자)")
    kv(d, [["성명", "홍길동 (가상)" if S else ""], ["생년월일", "1980-00-00" if S else ""], ["상호 · 사업자등록번호", "예시분식 · 000-00-00000" if S else ""],
           ["연락처", "010-0000-0000" if S else ""]])
    h(d, "수임인 (대리인)")
    kv(d, [["성명", "이예시 (가상)" if S else ""], ["생년월일", "1985-00-00" if S else ""], ["위임인과의 관계", "직원" if S else ""], ["연락처", "010-1111-1111" if S else ""]])
    h(d, "위임 내용")
    kv(d, [["위임 사항", "소상공인 정책자금 관련 증명서 발급 신청 및 수령" if S else ""],
           ["제출처", "소상공인시장진흥공단 예시지역센터" if S else ""],
           ["위임 기간", "2026-10-14 ~ 2026-10-31" if S else ""]])
    para(d, "위 사항을 위임합니다.")
    para(d, ("2026년 10월 14일" if S else "      년     월     일"))
    para(d, ("위임인  홍길동  (인)" if S else "위임인              (인)"))
    hint(d, "본인 인증을 한 대표자만 온라인 발급이 가능하고, 위임 발급은 위임장 등 원본을 지참해 방문해야 합니다. 신분증 사본 등 추가 서류는 센터에 확인하세요.")
    return d


# ---------- 05 자가진단표 ----------
def selfcheck():
    d = new_doc("융자제한 자가진단표", "신청 전에 해당 항목이 있는지 점검합니다. 하나라도 '예'이면 신청 전에 상담으로 확인하세요.", False)
    h(d, "A. 소진공 융자제한 소상공인 (2026년 공고)")
    items_a = [
        "세금을 체납 중이다 (압류·매각의 유예 등을 받았다면 직접대출에 한해 대상)",
        "한국신용정보원에 '신용도판단정보' 또는 '공공정보'가 등록되어 있다",
        "허위 또는 부정한 방법으로 융자를 신청했거나 대출금을 목적 외로 쓴 적이 있다",
        "임직원의 자금횡령 등 사회적 물의를 일으켰다",
        "휴업 또는 폐업 중이다 (재해로 인한 휴업은 가동 중으로 간주)",
        "주된 업종이 정책자금 융자제외 업종이다 (도박·사치·향락, 금융·보험, 법무·세무 등)",
        "최근 5년 이내 소상공인 정책자금을 3회 이상 지원받았다 (특별경영안정자금은 횟수 제외, 시설자금·직접대출 성실상환자는 1회 추가 가능)",
        "(직접대출) 같은 해 같은 자금을 신청해 부결되었거나 승인 후 전액 포기한 지 6개월이 지나지 않았다",
    ]
    table(d, ["No", "점검 항목", "예", "아니오"], [[str(i + 1), t, "\u2610", "\u2610"] for i, t in enumerate(items_a)], widths=[1.2, 12.5, 1.6, 1.7])
    h(d, "B. 중진공 융자제한 기업 (2026년 공고, 변경공고 반영)")
    items_b = [
        "상장기업이거나 신용평가등급 BBB 이상, 또는 자본총계 200억원·자산총계 700억원 초과, 중진공 신용위험 최상위 등급(CR1)이다",
        "휴·폐업 중이다",
        "세금을 체납 중이다",
        "연체·대위변제·부도·금융질서문란·회생·파산 등 신용정보가 등록되어 있다",
        "융자제외 업종을 영위한다",
        "최근 3년 이내 정책자금을 허위·부정하게 신청했거나 운전자금을 목적 외로 쓴 적이 있다",
        "중대재해처벌법 위반, 상습체불, 임직원 횡령 등으로 사회적 물의를 일으켰다",
        "중기부 기술개발지원사업에서 최근 3년 이내 제재처분을 받았다",
        "소상공인이다 (제조업, 혁신성장·초격차·신산업 분야 영위 등 예외 있음)",
        "업종별 융자제한 부채비율을 초과한다 (업력 7년 미만 등 예외 있음)",
        "업력 5년 초과 기업이 2년 연속 적자 + 자본 전액잠식, 또는 3년 연속 이자보상배율 1.0 미만이다",
        "기업평가 탈락 또는 융자 결정 후 전액 포기한 지 6개월이 지나지 않았다",
        "정부·지자체 정책자금 융자·보증 실적이 최근 5년간 합계 200억원을 초과한다",
        "중진공 정책자금 누적 지원액이 운전자금 기준 25억원을 초과한다",
        "최근 5년 이내 정책자금을 3회 이상 지원받았다",
    ]
    table(d, ["No", "점검 항목", "예", "아니오"], [[str(i + 1), t, "\u2610", "\u2610"] for i, t in enumerate(items_b)], widths=[1.2, 12.5, 1.6, 1.7])
    hint(d, "항목마다 예외 규정이 있습니다. 판단이 어려우면 소상공인 통합콜센터 1533-0100(1번), 중진공 정책자금 콜센터 1811-3655, 중소기업 통합콜센터 1357로 문의하세요.")
    return d


# ---------- xlsx ----------
def fund_plan(sample):
    S = sample
    wb = Workbook()
    ws = wb.active
    ws.title = "자금집행계획"
    thin = Side(style="thin", color="BFBFBF")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    head_fill = PatternFill("solid", fgColor="DCE6F1")
    input_fill = PatternFill("solid", fgColor="FFF9E5")
    bold = Font(name=FONT, bold=True)
    base = Font(name=FONT)
    ws["A1"] = "자금집행계획표" + (" (작성예시: 가상 데이터)" if S else "")
    ws["A1"].font = Font(name=FONT, bold=True, size=14, color="1F4E79")
    ws["A2"] = "공식 서식이 아닌 신청 준비용 양식입니다. 노란 칸에 입력하세요."
    ws["A2"].font = Font(name=FONT, italic=True, color="595959", size=9)
    ws["A4"], ws["B4"] = "신청 자금명", "일반경영안정자금" if S else None
    ws["A5"], ws["B5"] = "신청 금액(원)", 50000000 if S else None
    for r in (4, 5):
        ws.cell(r, 1).font = bold
        ws.cell(r, 2).fill = input_fill
        ws.cell(r, 2).border = border
    ws["B5"].number_format = "#,##0"
    headers = ["No", "구분", "세부 용도", "거래처·내용", "금액(원)", "집행 예정월", "증빙 서류"]
    for i, t in enumerate(headers, 1):
        c = ws.cell(7, i, t)
        c.font, c.fill, c.border = bold, head_fill, border
        c.alignment = Alignment(horizontal="center")
    rows = [
        ("운전", "식자재 구입", "지역 도매업체 2곳", 20000000, "2026-11", "거래명세서"),
        ("운전", "임차료", "사업장 월세 6개월분", 12000000, "2026-11", "임대차계약서"),
        ("운전", "인건비", "직원 2명 급여", 10000000, "2026-11", "급여대장"),
        ("운전", "홍보·배달 수수료", "배달앱 광고비", 8000000, "2026-12", "정산서"),
    ] if S else []
    for n in range(12):
        r = 8 + n
        ws.cell(r, 1, n + 1)
        if n < len(rows):
            for j, v in enumerate(rows[n], 2):
                ws.cell(r, j, v)
        for j in range(1, 8):
            c = ws.cell(r, j)
            c.border = border
            c.font = base
            if j > 1:
                c.fill = input_fill
        ws.cell(r, 5).number_format = "#,##0"
    dv = DataValidation(type="list", formula1='"운전,시설"', allow_blank=True)
    ws.add_data_validation(dv)
    dv.add("B8:B19")
    ws["D20"], ws["E20"] = "합계", "=SUM(E8:E19)"
    ws["D21"], ws["E21"] = "신청금액과의 차액", "=B5-E20"
    ws["D22"] = "검증"
    ws["E22"] = '=IF(B5="","신청 금액을 입력하세요",IF(E21=0,"일치","차액 있음: 합계를 신청금액과 맞추세요"))'
    for r in (20, 21, 22):
        ws.cell(r, 4).font = bold
        ws.cell(r, 5).font = bold
    ws["E20"].number_format = ws["E21"].number_format = "#,##0"
    for col, w in zip("ABCDEFG", (6, 8, 22, 26, 16, 12, 18)):
        ws.column_dimensions[col].width = w
    ws.column_dimensions["B"].width = 20

    sim = wb.create_sheet("상환 시뮬레이터")
    sim["A1"] = "원금균등 상환 시뮬레이터 (단순 계산)"
    sim["A1"].font = Font(name=FONT, bold=True, size=14, color="1F4E79")
    sim["A2"] = "실제 상환 방식·금리는 약정서 기준입니다. 금리는 기준금리 + 가산금리를 직접 입력하세요(기준금리는 분기마다 변동, 소진공·중진공 누리집 공지)."
    sim["A2"].font = Font(name=FONT, italic=True, color="595959", size=9)
    labels = [("대출금액(원)", 50000000 if S else None), ("연 금리(%)", 5.0 if S else None), ("총 기간(개월)", 60 if S else None), ("거치 기간(개월)", 24 if S else None)]
    for i, (lab, val) in enumerate(labels, 4):
        sim.cell(i, 1, lab).font = bold
        c = sim.cell(i, 2, val)
        c.fill, c.border = input_fill, border
    sim["B4"].number_format = "#,##0"
    if S:
        sim["C5"] = "가정치(예시). 실제 금리가 아닙니다."
        sim["C5"].font = Font(name=FONT, italic=True, color="C00000", size=9)
    for i, t in enumerate(["회차", "원금 상환", "이자", "월 납입액", "대출 잔액"], 1):
        c = sim.cell(9, i, t)
        c.font, c.fill, c.border = bold, head_fill, border
        c.alignment = Alignment(horizontal="center")
    for n in range(1, 121):
        r = 9 + n
        prev = "$B$4" if n == 1 else f"E{r-1}"
        sim.cell(r, 1, f'=IF({n}>$B$6,"",{n})')
        sim.cell(r, 2, f'=IF(A{r}="","",IF(A{r}<=$B$7,0,$B$4/($B$6-$B$7)))')
        sim.cell(r, 3, f'=IF(A{r}="","",ROUND({prev}*$B$5/100/12,0))')
        sim.cell(r, 4, f'=IF(A{r}="","",B{r}+C{r})')
        sim.cell(r, 5, f'=IF(A{r}="","",{prev}-B{r})')
        for j in range(1, 6):
            sim.cell(r, j).border = border
            sim.cell(r, j).font = base
            if j > 1:
                sim.cell(r, j).number_format = "#,##0"
    sim["G4"], sim["H4"] = "총 이자(원)", "=SUM(C10:C129)"
    sim["G5"], sim["H5"] = "총 상환액(원)", "=SUM(D10:D129)"
    for r in (4, 5):
        sim.cell(r, 7).font = bold
        sim.cell(r, 8).number_format = "#,##0"
    for col, w in zip("ABCDEFGH", (14, 16, 14, 16, 16, 4, 14, 16)):
        sim.column_dimensions[col].width = w
    wb.save(os.path.join(OUT, "02-fund-plan-%s.xlsx" % ("sample" if S else "blank")))
    print("wrote 02 xlsx", S)


def main():
    save(bp_smallbiz(False), "01-business-plan-smallbiz-blank.docx")
    save(bp_smallbiz(True), "01-business-plan-smallbiz-sample.docx")
    fund_plan(False)
    fund_plan(True)
    save(bp_sme(False), "03-business-plan-sme-blank.docx")
    save(bp_sme(True), "03-business-plan-sme-sample.docx")
    save(proxy(False), "04-proxy-blank.docx")
    save(proxy(True), "04-proxy-sample.docx")
    save(selfcheck(), "05-self-check.docx")


if __name__ == "__main__":
    main()

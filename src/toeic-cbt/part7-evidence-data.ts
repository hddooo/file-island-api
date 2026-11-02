// Reviewer-curated Part 7 evidence: 48 questions over 12 passages. Keys are sha256(passage, utf8) hex.
// Offsets are string indices into the exact passage; ranges keep the reviewed quote order.
// Only offsets, hashes, Korean translations of each quoted span and reviewed reasons are stored — never source text.
export type Part7EvidenceKind='direct'|'inference'|'absence'|'contrast'|'insertion'|'vocabulary';
export interface Part7EvidenceSourceRange {readonly start:number;readonly end:number;readonly translation:string;}
export interface Part7EvidenceQuestion {readonly answer:string;readonly kind:Part7EvidenceKind;readonly explanation:string;readonly ranges:readonly Part7EvidenceSourceRange[];}
export interface Part7EvidencePassage {readonly length:number;readonly questions:Readonly<Record<number,Part7EvidenceQuestion>>;}
const r=(start:number,end:number,translation:string):Part7EvidenceSourceRange=>({start,end,translation});
export const PART7_EVIDENCE:Readonly<Record<string,Part7EvidencePassage>>={

  "1d977d22d2ada48e683b5c68c29ed9a8d5832051e7e067d78e3bba4775f934a0": {
    "length": 660,
    "questions": {
      "147": {
        "answer": "C",
        "kind": "direct",
        "explanation": "도로 재포장 계획과 8월 5~20일 차량 통제 일정을 안내하는 기사입니다.",
        "ranges": [
          {
            "start": 0,
            "end": 140,
            "translation": "WESTFIELD(6월 24일) — 시의회 의원 Judith Owen이 Wilkinson Drive 재포장과 새 진출로 건설 계획을 추가로 설명했습니다."
          },
          {
            "start": 141,
            "end": 296,
            "translation": "지난주 발표된 공사는 8월 5일부터 20일까지 진행될 예정이며 이 기간에는 모든 차량의 도로 통행이 금지됩니다."
          }
        ]
      },
      "148": {
        "answer": "C",
        "kind": "direct",
        "explanation": "주민들이 여름에 수영과 소풍을 즐기는 인기 장소입니다. Aspen Lane으로도 갈 수 있습니다.",
        "ranges": [
          {
            "start": 348,
            "end": 465,
            "translation": "Wilkinson Drive는 여름철 주민들이 수영과 소풍을 즐기는 인기 장소인 Kendra Lake로 가는 주된 도로입니다."
          },
          {
            "start": 466,
            "end": 625,
            "translation": "하지만 Aspen Lane으로도 호수에 갈 수 있어 더위를 식히러 가는 사람들에게 큰 불편을 주지는 않을 것이라고 강조했습니다."
          }
        ]
      }
    }
  },
  "7da3297aad645b893be8f8c5e8208c1cf74739bea0cad9fff80d7f4e0b3aac4d": {
    "length": 889,
    "questions": {
      "149": {
        "answer": "B",
        "kind": "inference",
        "explanation": "5월 3일 이메일의 last month는 4월이며, 그때 일본을 방문했습니다.",
        "ranges": [
          {
            "start": 0,
            "end": 131,
            "translation": "받는 사람: Nick Cohen / 보낸 사람: Cathy Garcia / 날짜: 5월 3일 / 제목: 로밍 추가 요금에 대한 답변"
          },
          {
            "start": 148,
            "end": 267,
            "translation": "지난달 일본 여행 중 발생한 휴대전화 서비스 문제에 관한 고객님의 불만에 답변드립니다."
          },
          {
            "start": 268,
            "end": 409,
            "translation": "고객님이 5기가바이트 로밍 요금제에 가입했지만 실수로 2기가바이트 요금제가 배정된 사실을 확인했습니다."
          }
        ]
      },
      "150": {
        "answer": "A",
        "kind": "direct",
        "explanation": "로밍을 활성화할 때 프로모션 칸에 GX727364를 입력해야 합니다.",
        "ranges": [
          {
            "start": 694,
            "end": 836,
            "translation": "혜택을 이용하려면 계정에 로그인한 뒤 로밍 서비스를 활성화할 때 프로모션 입력란에 GX727364를 입력하시면 됩니다."
          }
        ]
      }
    }
  },
  "d34c989a11585a72deb2ed4b0eb5b322fe2a5f49280ef4a500acf6172d487039": {
    "length": 637,
    "questions": {
      "153": {
        "answer": "D",
        "kind": "inference",
        "explanation": "get into shape와 become healthier는 건강과 체력을 기르려는 사람을 가리킵니다.",
        "ranges": [
          {
            "start": 0,
            "end": 104,
            "translation": "몸을 단련하고 더 건강해지고 싶다면 요가를 시작해 보시는 것은 어떨까요?"
          },
          {
            "start": 105,
            "end": 173,
            "translation": "초보자를 특별히 고려해 설계한 Moon Yoga Mat를 만나 보세요."
          }
        ]
      },
      "154": {
        "answer": "C",
        "kind": "absence",
        "explanation": "여러 무늬·천연 코르크·추가 보호층은 명시되어 있습니다. 방수성(C)은 언급되지 않으며 표시한 문장은 다른 보기 비교 근거입니다.",
        "ranges": [
          {
            "start": 174,
            "end": 301,
            "translation": "기본 줄무늬부터 정교한 꽃무늬까지 다양한 디자인의 이 매트는 천연 코르크로만 만들어졌습니다."
          },
          {
            "start": 302,
            "end": 384,
            "translation": "사용자를 보호하기 위해 두꺼운 바닥에 부드러운 소재를 한 겹 더했습니다."
          }
        ]
      }
    }
  },
  "98083e24a42491dddadfbb8205fb36db46dd78a24d616b751af7db5628aabbf4": {
    "length": 904,
    "questions": {
      "155": {
        "answer": "D",
        "kind": "direct",
        "explanation": "처음 논의한 금액보다 견적이 높아진 두 이유를 설명합니다.",
        "ranges": [
          {
            "start": 155,
            "end": 338,
            "translation": "어제 이메일로 보내 드린 창문 교체 견적에 관한 질문에 답변드립니다. 처음 논의한 금액보다 약간 높은 것이 맞습니다. — [1] —."
          },
          {
            "start": 339,
            "end": 401,
            "translation": "두 가지 이유로 가격을 올릴 수밖에 없었습니다. — [2] —."
          }
        ]
      },
      "156": {
        "answer": "C",
        "kind": "inference",
        "explanation": "your clothing shop은 수신인이 의류 매장을 운영하는 사람임을 보여 줍니다.",
        "ranges": [
          {
            "start": 448,
            "end": 600,
            "translation": "또 다른 이유는 의류 매장에 들어오는 오후 햇빛을 줄이기 위해 착색 유리를 원한다고 기술자에게 말씀하셨기 때문입니다."
          }
        ]
      },
      "157": {
        "answer": "B",
        "kind": "insertion",
        "explanation": "두 이유를 예고한 뒤 비표준 크기라는 첫 이유를 넣어야 custom window와 Another factor가 이어집니다.",
        "ranges": [
          {
            "start": 339,
            "end": 401,
            "translation": "두 가지 이유로 가격을 올릴 수밖에 없었습니다. — [2] —."
          },
          {
            "start": 402,
            "end": 447,
            "translation": "고객님을 위해 맞춤 창문을 제작해야 합니다."
          },
          {
            "start": 448,
            "end": 600,
            "translation": "또 다른 이유는 의류 매장에 들어오는 오후 햇빛을 줄이기 위해 착색 유리를 원한다고 기술자에게 말씀하셨기 때문입니다."
          }
        ]
      }
    }
  },
  "c1456a82b697e6c9d61f2db4ea77a4ab604736d1a36b0388b3d1666428983b14": {
    "length": 1102,
    "questions": {
      "168": {
        "answer": "A",
        "kind": "inference",
        "explanation": "과거 야생동물 사진가였고 지금은 동물 교육에 전념하므로 직업 변화가 있습니다.",
        "ranges": [
          {
            "start": 253,
            "end": 388,
            "translation": "Dobson 씨는 과거 야생동물 사진가였으며 지금은 지구에서 함께 살아가는 동물에 관한 지식을 전하는 데 전념하고 있습니다."
          }
        ]
      },
      "169": {
        "answer": "C",
        "kind": "direct",
        "explanation": "아이들이 도마뱀·앵무새 등 다양한 동물을 직접 만져 볼 수 있습니다.",
        "ranges": [
          {
            "start": 486,
            "end": 662,
            "translation": "워크숍에서 아이들을 가르칠 뿐 아니라 특별한 체험으로 도마뱀과 앵무새 등 다양한 이국적인 동물을 직접 만져 보게 할 예정입니다."
          }
        ]
      },
      "170": {
        "answer": "C",
        "kind": "inference",
        "explanation": "도서관 웹사이트·librarian·관내 2층 어린이센터가 함께 장소를 가리킵니다.",
        "ranges": [
          {
            "start": 663,
            "end": 739,
            "translation": "자녀를 등록하려면 www.madisonlibrary.com/summer를 방문하세요."
          },
          {
            "start": 740,
            "end": 792,
            "translation": "안내 데스크의 사서에게 문의해도 됩니다."
          },
          {
            "start": 864,
            "end": 918,
            "translation": "행사는 건물 2층 어린이 센터에서 열립니다."
          }
        ]
      },
      "171": {
        "answer": "B",
        "kind": "direct",
        "explanation": "행사는 our second-floor children’s center에서 열립니다.",
        "ranges": [
          {
            "start": 864,
            "end": 918,
            "translation": "행사는 건물 2층 어린이 센터에서 열립니다."
          }
        ]
      }
    }
  },
  "5491268f0c1f917123725f70f1eb44b40a8fa4748450fabd0b27e38355de5260": {
    "length": 1918,
    "questions": {
      "176": {
        "answer": "B",
        "kind": "inference",
        "explanation": "15년 근무 후 떠나는 선임 파트너를 위한 식사이므로 퇴직 행사입니다.",
        "ranges": [
          {
            "start": 149,
            "end": 282,
            "translation": "상사가 15년간 근무하고 퇴직하는 우리 법률 회사의 선임 파트너를 위한 특별 점심 행사를 준비하라고 지시했습니다."
          }
        ]
      },
      "177": {
        "answer": "B",
        "kind": "inference",
        "explanation": "30명·음료 포함·750달러 예산을 충족하는 명시된 선택은 740달러인 B입니다.",
        "ranges": [
          {
            "start": 617,
            "end": 726,
            "translation": "모두에게 충분한 음식과 생수·주스를 원하며 총예산은 750달러입니다."
          },
          {
            "start": 1435,
            "end": 1533,
            "translation": "선택 B: 개인용 피자, 닭 날개와 감자튀김 / 30명 비용 740달러, 음료 포함"
          },
          {
            "start": 1534,
            "end": 1621,
            "translation": "선택 C: 태국식 카레, 망고 찹쌀밥 / 30명 비용 775달러, 음료 포함"
          },
          {
            "start": 1622,
            "end": 1735,
            "translation": "선택 D: 고기·채식 샌드위치, 개인용 샐러드 / 30명 비용 725달러, 음료 미포함"
          }
        ]
      },
      "178": {
        "answer": "C",
        "kind": "vocabulary",
        "explanation": "accommodate my request는 식사·음료·예산 요청을 충족한다는 뜻입니다.",
        "ranges": [
          {
            "start": 617,
            "end": 726,
            "translation": "모두에게 충분한 음식과 생수·주스를 원하며 총예산은 750달러입니다."
          },
          {
            "start": 727,
            "end": 824,
            "translation": "제 요청을 충족해 주실 수 있다면 식사 선택 사항과 가격 정보를 보내 주세요."
          }
        ]
      },
      "179": {
        "answer": "D",
        "kind": "direct",
        "explanation": "금요일에 다른 도시의 법률 콘퍼런스에 참석하므로 목요일까지 답을 원합니다.",
        "ranges": [
          {
            "start": 825,
            "end": 943,
            "translation": "금요일에 다른 도시의 법률 학회에 참석할 예정이므로 목요일까지 답변해 주시면 감사하겠습니다."
          }
        ]
      },
      "180": {
        "answer": "D",
        "kind": "direct",
        "explanation": "예약할 때 총액의 50%를 지급해야 합니다.",
        "ranges": [
          {
            "start": 1332,
            "end": 1434,
            "translation": "선택 A: 참치·연어 김초밥, 된장국 / 30명 비용 780달러, 음료 미포함"
          },
          {
            "start": 1622,
            "end": 1735,
            "translation": "선택 D: 고기·채식 샌드위치, 개인용 샐러드 / 30명 비용 725달러, 음료 미포함"
          },
          {
            "start": 1736,
            "end": 1824,
            "translation": "예약 시 총액의 50퍼센트를 내셔야 합니다."
          }
        ]
      }
    }
  },
  "ae5c286d3766aed2439a47f45bdfd59aa1b0bc64e6eb31833bdee104339d8a92": {
    "length": 2223,
    "questions": {
      "186": {
        "answer": "D",
        "kind": "direct",
        "explanation": "카드 결제는 되었지만 회사 기록에 필요한 영수증 이메일을 받지 못했습니다.",
        "ranges": [
          {
            "start": 263,
            "end": 364,
            "translation": "카드에 총액이 청구되었지만 이메일 영수증은 아직 받지 못했습니다."
          },
          {
            "start": 365,
            "end": 436,
            "translation": "회사 기록에 필요하니 가능한 한 빨리 보내 주세요."
          }
        ]
      },
      "187": {
        "answer": "C",
        "kind": "direct",
        "explanation": "지난주 주문 처리 애플리케이션의 새 버전을 설치했습니다.",
        "ranges": [
          {
            "start": 904,
            "end": 1054,
            "translation": "이 오류에 대해 사과드립니다. 지난주 주문 처리 프로그램의 새 버전을 설치했는데 일부 오류가 있는 것 같습니다."
          }
        ]
      },
      "188": {
        "answer": "B",
        "kind": "inference",
        "explanation": "이메일의 $60 in total을 영수증 총액 열에 대입하면 Millhouse Sandpaper입니다.",
        "ranges": [
          {
            "start": 1158,
            "end": 1314,
            "translation": "계정 정보를 보다가 총 60달러를 쓰신 제품을 거의 매주 구매하신다는 점을 알게 되었습니다."
          },
          {
            "start": 1315,
            "end": 1430,
            "translation": "대량 주문 10퍼센트 할인 대상이 되도록 한 달에 한 번 구매하는 것을 고려해 보세요."
          },
          {
            "start": 1746,
            "end": 1784,
            "translation": "Apex 페인트 / 통당 60달러 / 3통 / 180달러"
          },
          {
            "start": 1785,
            "end": 1832,
            "translation": "Millhouse 사포 / 롤당 20달러 / 3롤 / 60달러"
          }
        ]
      },
      "189": {
        "answer": "B",
        "kind": "inference",
        "explanation": "영수증은 이미 재발송했고 남은 질문은 Wilson 드라이버의 재입고 시점입니다.",
        "ranges": [
          {
            "start": 437,
            "end": 519,
            "translation": "또한 매장에 Wilson 드라이버가 언제 다시 입고되는지 궁금합니다."
          },
          {
            "start": 1055,
            "end": 1125,
            "translation": "몇 분 전에 영수증이 첨부된 이메일을 받으셨을 것입니다."
          },
          {
            "start": 1431,
            "end": 1526,
            "translation": "또한 고객님의 질문에 답하는 데 필요한 정보를 관리자 Neal Sutter에게 요청했습니다."
          },
          {
            "start": 1527,
            "end": 1579,
            "translation": "답변을 받으면 알려 드리겠습니다."
          }
        ]
      },
      "190": {
        "answer": "D",
        "kind": "direct",
        "explanation": "고객 만족도 설문을 제출한 모든 참여자에게 상품권을 줍니다.",
        "ranges": [
          {
            "start": 1960,
            "end": 2069,
            "translation": "서비스 개선을 위해 고객 만족도 설문을 작성해 제출해 주시기 바랍니다."
          },
          {
            "start": 2112,
            "end": 2223,
            "translation": "도움이 되는 의견에 감사하는 뜻으로 참여 고객 전원에게 25달러 상품권을 드립니다!"
          }
        ]
      }
    }
  },
  "c1469af5976a92da6b388fa17f99848446d5c638fec053b9418c9fc6daba8769": {
    "length": 2349,
    "questions": {
      "191": {
        "answer": "D",
        "kind": "direct",
        "explanation": "매일 또는 매주 정기 방문을 예약하는 고객에게 요금 할인을 제공합니다.",
        "ranges": [
          {
            "start": 69,
            "end": 200,
            "translation": "Brentwood Cleaning은 30년 넘게 Portland 광역권의 사업체에 우수한 서비스를 제공해 왔습니다."
          },
          {
            "start": 959,
            "end": 1047,
            "translation": "매일 또는 매주 방문을 예약하는 고객의 할인 요금도 꼭 문의하세요!"
          }
        ]
      },
      "192": {
        "answer": "B",
        "kind": "direct",
        "explanation": "Ruben Graphic Design의 요청은 General cleanup after renovations입니다.",
        "ranges": [
          {
            "start": 1187,
            "end": 1259,
            "translation": "Ruben Graphic Design / 23 2nd Avenue / 개보수 후 전체 청소"
          },
          {
            "start": 1328,
            "end": 1398,
            "translation": "Motis Office Supply / 56 Sawyer Road / 로비 바닥 물걸레질과 왁스 작업"
          }
        ]
      },
      "193": {
        "answer": "C",
        "kind": "inference",
        "explanation": "후기의 카펫 청소를 일정표의 Kline Publishing에 연결하면 67 Clover Lane입니다.",
        "ranges": [
          {
            "start": 1260,
            "end": 1327,
            "translation": "Kline Publishing / 67 Clover Lane / 접수 공간 카펫 청소"
          },
          {
            "start": 1713,
            "end": 1797,
            "translation": "카펫을 아주 잘 청소해 주어서 이용하길 잘했다고 생각합니다."
          }
        ]
      },
      "194": {
        "answer": "C",
        "kind": "inference",
        "explanation": "후기에 나온 Ecoclean은 no synthetic ingredients 제품입니다. 동물 실험 없음은 다른 브랜드 Greenwash의 특성입니다.",
        "ranges": [
          {
            "start": 394,
            "end": 620,
            "translation": "친환경 기업이라는 자부심을 갖고 지속 가능한 포장·동물 실험 미실시의 Greenwash와 100퍼센트 생분해성·합성 성분 미포함의 Ecoclean 청소용품만 사용합니다."
          },
          {
            "start": 1868,
            "end": 1997,
            "translation": "작업자들이 사용한 Ecoclean 세제조차 다른 대부분의 세정제처럼 강한 냄새가 나지 않아 인상적이었습니다."
          }
        ]
      },
      "195": {
        "answer": "D",
        "kind": "direct",
        "explanation": "예정 완료 3시보다 이른 2시 30분 전에 일을 마치도록 했습니다.",
        "ranges": [
          {
            "start": 2073,
            "end": 2267,
            "translation": "실수로 오후 2시 30분에 고객 회의를 잡았다고 말하자, 원래 3시 완료 예정이었는데도 그 전에 작업을 마쳐 주었습니다."
          }
        ]
      }
    }
  },
  "a094475fe18ce54e779e4fbede3550d6c81e2ec9ffeb85bf39437e067355041c": {
    "length": 2350,
    "questions": {
      "196": {
        "answer": "D",
        "kind": "direct",
        "explanation": "Chicago·Dallas 등 매장을 열어 전국 체인으로 확장하는 것을 기념합니다.",
        "ranges": [
          {
            "start": 340,
            "end": 568,
            "translation": "올여름 Chicago·Dallas 등 주요 도시의 매장 개점으로 전국 체인이 되는 것을 기념해 7월 1~15일 여러 인기 브랜드를 최대 40퍼센트 할인합니다."
          }
        ]
      },
      "197": {
        "answer": "A",
        "kind": "inference",
        "explanation": "사은품 기준은 세금·배송료 전 250달러이며 상품 소계는 225달러여서 미달입니다.",
        "ranges": [
          {
            "start": 589,
            "end": 711,
            "translation": "세금과 배송비를 더하기 전 금액으로 250달러 이상 구매하면 First Star Sports 배낭을 드립니다."
          },
          {
            "start": 1218,
            "end": 1279,
            "translation": "상품 소계 225달러 / 배송비 15달러 / 세금 25달러 / 총액 265달러"
          },
          {
            "start": 1280,
            "end": 1326,
            "translation": "위 가격에는 적용 가능한 모든 할인이 포함되어 있습니다."
          },
          {
            "start": 1327,
            "end": 1419,
            "translation": "온라인 구매 상품을 반품하려면 여기를 클릭해 배송료 선불 라벨을 출력하세요."
          }
        ]
      },
      "198": {
        "answer": "C",
        "kind": "direct",
        "explanation": "온라인 구매 반품에는 prepaid shipping label을 출력하므로 반송 배송료를 별도로 낼 필요가 없습니다.",
        "ranges": [
          {
            "start": 1327,
            "end": 1419,
            "translation": "온라인 구매 상품을 반품하려면 여기를 클릭해 배송료 선불 라벨을 출력하세요."
          },
          {
            "start": 1420,
            "end": 1552,
            "translation": "환불을 받으려면 구매 후 2주 안에 원래 포장 상태로 반품 상품이 도착해야 합니다."
          }
        ]
      },
      "199": {
        "answer": "B",
        "kind": "direct",
        "explanation": "포인트가 잘못 배정되었는지 묻는 질문에 오류가 아니라고 답합니다.",
        "ranges": [
          {
            "start": 1690,
            "end": 1800,
            "translation": "최근 주문에 관해 Zone Sporting Goods 고객 서비스 부서에 문의해 주셔서 감사합니다."
          },
          {
            "start": 1801,
            "end": 1918,
            "translation": "문의하신 구매 상품의 적립 포인트 부여에는 오류가 없었습니다."
          }
        ]
      },
      "200": {
        "answer": "D",
        "kind": "inference",
        "explanation": "이달의 브랜드 Zipper에 두 배 포인트가 붙으며 주문표에서 Zipper 제품은 운동화입니다.",
        "ranges": [
          {
            "start": 1180,
            "end": 1217,
            "translation": "Zipper / 운동화(사이즈 12) / 110달러"
          },
          {
            "start": 1919,
            "end": 2077,
            "translation": "매달 다른 회사의 상품을 선정해 구매 회원에게 포인트를 두 배로 드리며 7월의 이달의 브랜드는 Zipper입니다."
          },
          {
            "start": 2078,
            "end": 2155,
            "translation": "그래서 해당 상품에 일반적인 150포인트 대신 300포인트를 받으신 것입니다."
          }
        ]
      }
    }
  }
,
 d701bf1430889f136dcdae024bd8a927814a6be68851570c6a5cdfe558645f77:{length:1081,questions:{
  151:{answer:'C',kind:'absence',explanation:'온라인 영업·신규 고객·연간 예산은 명시돼 있습니다. 지난달 매출 감소(C)는 언급되지 않습니다.',ranges:[r(121,144,'신규 고객 확보'),r(193,234,'Mobilia 웹사이트에서 매출을 더 올리다'),r(859,917,'올해 마케팅 예산은 이미 배정받았습니다')]},
  152:{answer:'C',kind:'inference',explanation:'that은 앞서 정해진 예산 한도를 받습니다. 그 한도 안에서 진행하겠다는 C입니다.',ranges:[r(923,978,'배정된 금액보다 더 많이 쓸 수는 없을 겁니다.'),r(1016,1081,'그 점은 감안해서 진행할게요. 예산은 문제가 되지 않을 것 같습니다.')]},
 }},
 '1fbfa7449a8a9235d08aa4579a830b999c812f84097a5e4f16180cb6c72e2ccf':{length:938,questions:{
  155:{answer:'A',kind:'direct',explanation:'전 지점의 영업시간 연장이 공지의 중심 목적이므로 A입니다.',ranges:[r(100,178,'전국 모든 지점의 영업시간을 연장할 예정입니다!')]},
  156:{answer:'C',kind:'direct',explanation:'주말 아침 뷔페가 주말의 특별 식사 옵션(C)에 해당합니다.',ranges:[r(368,402,'주말에 새로 운영하는 아침 뷔페')]},
  157:{answer:'B',kind:'direct',explanation:'뷔페는 9시~정오에만 제공됩니다(B). 예약은 권장일 뿐 필수는 아닙니다.',ranges:[r(704,769,'아침 뷔페는 오전 9시부터 낮 12시까지 이용할 수 있습니다.'),r(770,799,'예약을 권장합니다.')]},
 }},
 '6869767d931a40acb040abc4febca1baaf237bc8560404c761ddbba455da3906':{length:1330,questions:{
  158:{answer:'B',kind:'direct',explanation:'새 어학원을 연 사건을 소개하는 기사이므로 사업 개시(B)입니다.',ranges:[r(691,762,'Mayer는 금요일에 Collinsway Tower에서 Fluency Masters Academy를 열었다.')]},
  159:{answer:'D',kind:'absence',explanation:'언어 전문가 설립·원어민 강사·평일 수업은 명시돼 있지만 외국 회사와의 제휴(D)는 없습니다.',ranges:[r(387,407,'언어학자 Kenny Mayer'),r(958,1030,'각 언어의 원어민이 평일 저녁에 수업을 진행할 것이다.')]},
  160:{answer:'C',kind:'inference',explanation:'글쓴이가 Vanna Tan이고 자신의 인터뷰를 언급하므로 Tan이 Mayer를 인터뷰했습니다(C).',ranges:[r(49,61,'글: Vanna Tan'),r(657,689,'라고 Mayer는 우리와의 인터뷰에서 말했다.')]},
 }},
 '78b059328c5eba5fe34a6a2c5533b6fbe307898c92a1b05941837f40b444e843':{length:997,questions:{
  161:{answer:'C',kind:'direct',explanation:'지원 거절 결과와 다른 회사 지원 계획을 함께 알리는 편지이므로 지원 현황 논의(C)입니다.',ranges:[r(85,189,'Goldbear Technologies의 수석 기술 이사직 지원이 받아들여지지 않았습니다.'),r(311,413,'인도 서부의 다른 회사인 Pioneer Plastics Manufacturing에 귀하의 지원서를 제출할 계획입니다.')]},
  162:{answer:'B',kind:'direct',explanation:'이력서와 추천서를 보내겠다는 말이 서류 발송(B)의 직접 근거입니다.',ranges:[r(741,803,'귀하의 이력서와 추천서를 먼저 전달하겠습니다.')]},
  163:{answer:'C',kind:'insertion',explanation:'전화하도록 권한 뒤 그 전화로 문의할 내용을 넣는 [3] 위치(C)가 자연스럽습니다.',ranges:[r(623,723,'가능한 한 빨리 인도 지사의 Chynna Dara에게 555-1433으로 전화하시길 권합니다. — [3] —.'),r(724,803,'그동안 저는 귀하의 이력서와 추천서를 먼저 전달하겠습니다.')]},
 }},
 '3c43bb4f9c734fda9532acd68a900532258539f31520a6eed076aea050760764':{length:1657,questions:{
  164:{answer:'A',kind:'direct',explanation:'2주 뒤 예정된 일은 새 박물관의 안전점검(A)입니다.',ranges:[r(64,164,'새 박물관의 안전 점검입니다. 4월 18일로 잡혔는데, 이제 딱 2주 남았습니다.')]},
  165:{answer:'D',kind:'inference',explanation:'Gordon의 담당 업무는 도장입니다. 그 팀의 주말 근무는 도장 작업 계속(D)을 뜻합니다.',ranges:[r(405,448,'이번 주에 도장 작업을 시작할 예정입니다'),r(1334,1447,'Gordon Geary — 오전 10시 3분 / 작업반과 이야기했는데, 6명은 토요일에, 4명은 일요일에 일할 의향이 있습니다.')]},
  166:{answer:'C',kind:'contrast',explanation:'복도·화장실은 타일이라고 명시됐으므로 건물 전체를 대리석으로 시공한다는 C는 틀립니다.',ranges:[r(281,316,'대리석 바닥 작업은 거의 끝났습니다.'),r(1020,1148,'로비는 거의 끝났고 Jefferson 전시관은 모두 완료됐습니다. 그리고 복도와 화장실에는 타일을 깔았습니다.')]},
  167:{answer:'C',kind:'inference',explanation:'주말 근무 인원이 확보돼 도장 일정을 맞출 수 있다는 뜻(C)입니다.',ranges:[r(1384,1465,'6명은 토요일에, 4명은 일요일에 일할 의향이 있습니다. 그러면 도움이 될 겁니다.'),r(1510,1560,'주말 작업 덕분에 일정을 맞출 수 있을 것 같습니다.')]},
 }},
 '3e466eb47586691510dcff4fae2a6072656e290a1ce968292b3d95c899a8a2b1':{length:1247,questions:{
  168:{answer:'B',kind:'inference',explanation:'회계 부서 주소로 환급 절차를 안내하므로 회계 직원(B)으로 판단합니다.',ranges:[r(0,48,'보낸 사람: Liza Singer (회계 부서 이메일 주소)'),r(288,347,'회계 부서에 내는 월별 비용 환급 신청')]},
  169:{answer:'C',kind:'direct',explanation:'원본 영수증이 신청서에 첨부할 지불 증빙(C)입니다.',ranges:[r(427,488,'프로젝트 경비의 영수증 원본을 모두 신청서에 첨부하세요')]},
  170:{answer:'A',kind:'inference',explanation:'Ricks는 서류를 받아 평가 담당자에게 전달하므로 환급 서류 정리(A)를 맡습니다.',ranges:[r(493,588,'Ricks 씨에게 제출하세요. 그 후 Ricks 씨가 서류를 Scott 씨에게 전달해 검토받게 합니다')]},
  171:{answer:'D',kind:'contrast',explanation:'영수증은 월별 환급 신청에 붙입니다. 분기 제출물은 지출 요약이므로 영수증을 분기 말 제출한다는 D와 다릅니다.',ranges:[r(277,318,'월별 비용 환급 신청서 제출'),r(991,1082,'각 분기 말 최소 2주 전까지 팀 지출 요약을 제출하세요.')]},
 }},
 '68260962c581683c19142fcde1ba72b925480881ad93188d79631878124bfd8d':{length:1654,questions:{
  172:{answer:'B',kind:'direct',explanation:'새 정책에 맞춘 내부 규정 변경(B)이 메모의 주제입니다.',ranges:[r(214,301,'이 새 정책에 맞추기 위해 당사 내부 규정 일부를 개정했습니다.')]},
  173:{answer:'C',kind:'direct',explanation:'구매관리부는 매주 웹사이트를 확인해야 하므로 C입니다.',ranges:[r(536,608,'구매관리부는 매주 CSB 웹사이트에 접속해야 합니다')]},
  174:{answer:'D',kind:'direct',explanation:'장갑·고무 앞치마·마스크 착용 의무가 특정 복장 착용(D)의 근거입니다.',ranges:[r(1408,1509,'모든 식품 취급자와 기계 작업자는 장갑, 고무 앞치마, 마스크를 착용해야 합니다.')]},
  175:{answer:'B',kind:'insertion',explanation:'보관하라는 문장 다음 [2]에 보관 용기의 온도 조건을 덧붙이므로 B입니다.',ranges:[r(1059,1145,'검사를 통과한 감자는 그다음 즉시 세척해 보관해야 합니다. — [2] —.')]},
 }},
 bc3b20fd4a6249817f6c08317a34e0db85c04ec37252258444d26d9fe02841af:{length:3114,questions:{
  176:{answer:'D',kind:'direct',explanation:'응모작을 받는 감독자에게 대회 세부 규정 숙지(D)를 요청합니다.',ranges:[r(561,703,'감독자로서 여러분은 응모작 접수를 맡게 되므로, 대회 세부 사항을 반드시 잘 숙지해 주십시오.')]},
  177:{answer:'C',kind:'absence',explanation:'10년째인 행사·학생 참여·재료 제공은 명시돼 있습니다. 유명 예술가에게 상금을 준다는 C는 없습니다.',ranges:[r(344,364,'올해로 10년째를 맞은'),r(727,769,'대학생들의 응모작을 받는'),r(2618,2690,'디자인을 완성하는 데 필요한 재료가 제공될 것입니다')]},
  178:{answer:'C',kind:'direct',explanation:'6월 새 여름 컬렉션 출시가 새 상품 출시 계획(C)의 근거입니다.',ranges:[r(2814,2905,'귀하의 작품은 6월에 출시될 저희의 다가오는 여름 컬렉션에 포함될 것입니다.')]},
  179:{answer:'A',kind:'inference',explanation:'두 번째 메일의 수영복을 첫 메일의 운동복 심사 분야와 연결하면 Vittorio Bellucci(A)입니다.',ranges:[r(1341,1378,'운동복 — Vittorio Bellucci 씨'),r(2319,2385,'심사위원단은 귀하의 수영복 디자인이 지닌 세련미를 마음에 들어 했습니다.')]},
  180:{answer:'D',kind:'direct',explanation:'금요일 오리엔테이션에서 패션쇼 안내를 받으므로 D입니다.',ranges:[r(2539,2617,'4월 5일 금요일 Hayden Boutique 본사에서 열리는 오리엔테이션에 참석하다.'),r(2618,2755,'디자인을 완성하는 데 필요한 재료와 함께 5월 패션쇼에 관한 자세한 안내도 받게 됩니다.')]},
 }},
 b7d20b70fefc6599daf57f7eb99da3b8f484f0fcb98e83380062aeb0bd5a38a1:{length:2275,questions:{
  181:{answer:'A',kind:'direct',explanation:'문제를 더 조사하고 보고서를 보내 달라는 요청이 첫 메일의 목적입니다.',ranges:[r(597,683,'귀하의 조사팀이 이 문제를 좀 더 면밀히 살펴봐 주신다면 정말 감사하겠습니다.'),r(1010,1070,'조사를 마치는 대로 보고서를 보내 주십시오.')]},
  182:{answer:'D',kind:'inference',explanation:'자신의 다른 제품개발 팀원들을 언급하므로 Corbin의 업무는 신제품 개발(D)입니다.',ranges:[r(928,1005,'다음 주에 다른 제품 개발 팀원들과 회의가 있습니다')]},
  183:{answer:'A',kind:'absence',explanation:'출시 예정·수출·두 매체의 평가가 명시돼 있습니다. 원두 샘플 조달은 완제품 상품을 공급처에서 산다는 A의 근거가 아닙니다.',ranges:[r(262,306,'다음 분기에 출시될 예정인 새 커피 블렌드'),r(757,781,'우리의 주요 수출 제품'),r(469,511,'매체 Subway Magazine과 The Prime Food Journal'),r(2135,2187,'새 공급업체에서 커피 원두 샘플을 조달하다')]},
  184:{answer:'C',kind:'direct',explanation:'산도가 약해 선명한 맛이 부족하다는 조사 결과가 C의 근거입니다.',ranges:[r(1493,1583,'산도가 5.0으로, 커피 애호가들이 찾는 선명하고 깔끔한 맛이 부족합니다.')]},
  185:{answer:'B',kind:'direct',explanation:'추가 지시를 기다린다고 명시하므로 추가 안내 요청(B)입니다.',ranges:[r(1928,2029,'지시를 기다리겠습니다. 그 밖에 제가 했으면 하는 일이 있으면 알려 주십시오')]},
 }},
 '75fe0117d346c813b71359de0e921375547f4d87cc0c2996841ef9b7839bf299':{length:2777,questions:{
  186:{answer:'C',kind:'direct',explanation:'절약액 열을 비교하면 $6.88인 Action Photography(C)가 가장 큽니다.',ranges:[r(353,393,'잡지 Action Photography | 3.99달러 | 41달러 | 6.88달러'),r(394,434,'잡지 Backyard Gardening | 1.29달러 | 11달러 | 4.48달러'),r(435,476,'잡지 The Clarion Monthly | 2.49달러 | 24달러 | 5.88달러'),r(477,516,'잡지 Fit & Fashionable | 4.29달러 | 48달러 | 3.48달러'),r(517,553,'잡지 Sports Insider | 3.49달러 | 39달러 | 2.88달러')]},
  187:{answer:'B',kind:'absence',explanation:'미발행분 환급이나 새 구독 전환을 원했으며 같은 구독의 1년 갱신(B)은 요청하지 않았습니다.',ranges:[r(1487,1532,'사용하지 않은 부분은 환불받고 싶습니다.'),r(1533,1620,'잔액을 새 구독에 적용하고 차액이 있으면 지불할 의향도 있습니다.')]},
  188:{answer:'D',kind:'inference',explanation:'메일의 구독 잡지를 광고 표의 연간 가격과 연결하면 $24(D)입니다.',ranges:[r(435,476,'잡지 The Clarion Monthly | 2.49달러 | 24달러 | 5.88달러'),r(915,993,'지난 3년 동안 The Clarion Monthly를 계속 구독해 왔습니다')]},
  189:{answer:'A',kind:'direct',explanation:'잔액의 새 구독 전환이 불가능한 직접 이유는 회계 부서 정책(A)입니다.',ranges:[r(2178,2281,'계정 잔액을 새 구독에 적용하는 것은 저희 회계 부서 방침에 어긋납니다.')]},
  190:{answer:'D',kind:'inference',explanation:'시사 기사를 좋아하는 취향에 맞춘 추천이므로 즐길 만한 기사(D)가 실린다고 판단합니다.',ranges:[r(1706,1753,'시사 문제를 깊이 있게 다룬 기사를 좋아합니다.'),r(2536,2632,'뉴스 관련이었던 이전 구독을 바탕으로 The Global Reporter를 추천드립니다')]},
 }},
 f19a76481a56170cb29b4ddfc60801954376dcd1936bb3a0d3db035ae7ad4a17:{length:2529,questions:{
  191:{answer:'D',kind:'direct',explanation:'토요일에 열리는 수업은 Dance(D)입니다.',ranges:[r(681,714,'댄스 | 토요일 | 오후 3:45–4:45')]},
  192:{answer:'C',kind:'inference',explanation:'선택한 계좌이체 방식은 결제 증빙 제출을 요구하므로 C입니다.',ranges:[r(1351,1383,'계좌 이체 [선택됨]'),r(1404,1542,'계좌 이체나 인터넷 이체는 아래 계좌 정보를 이용하고, 결제 증빙을 청구 담당 이메일 주소로 보내 주십시오')]},
  193:{answer:'B',kind:'inference',explanation:'무료 체험 기간 중 가입·요가 선택·수강 사실을 연결하면 요가 수업이 무료였다는 B입니다.',ranges:[r(163,287,'6월 1일부터 6월 15일 사이에 회원 가입하면 원하는 수업 1회를 무료로 들을 수 있습니다.'),r(918,930,'날짜: 6월 9일'),r(1670,1685,'요가 [선택됨]'),r(1816,1880,'지난 6월 11일 화요일에 참석한 수업이 정말 즐거웠습니다.')]},
  194:{answer:'B',kind:'direct',explanation:'새 회원 소개에 대한 보상을 문의하므로 B입니다.',ranges:[r(2380,2479,'체육관에 신규 고객을 소개하는 회원에게 혜택을 주시는지 알고 싶었습니다.')]},
  195:{answer:'D',kind:'inference',explanation:'선택한 월간 계획에서 4명 단체로 바꾸려 하므로 Group의 Monthly 가격인 1인 HK$400(D)입니다.',ranges:[r(1179,1221,'단체(4인 이상) | 400홍콩달러 | 200홍콩달러'),r(2316,2373,'저를 포함해 총 네 명이 될 것입니다.'),r(1139,1178,'개인 | 450홍콩달러 [선택됨] | 350홍콩달러')]},
 }},
 '21b09dd083e28e37f97f1d95f2a0503df5ba118fa0ecd712314185f74fba7573':{length:2768,questions:{
  196:{answer:'A',kind:'direct',explanation:'자동차용 휴대 청소기의 제조사는 Jiffy(A)입니다.',ranges:[r(753,814,'모든 Jiffy 휴대용 차량 청소기 1+1 행사.')]},
  197:{answer:'C',kind:'absence',explanation:'환급·1+1·일부 상품 할인은 있지만 사용한 상품의 반품(C)은 제공한다고 명시하지 않았습니다.',ranges:[r(595,622,'5% 현금 환급을 받으세요'),r(753,779,'1+1 행사'),r(1160,1198,'일부 온라인 구매 상품 할인')]},
  198:{answer:'C',kind:'inference',explanation:'9월1일 전 등록한 계정과 $100 이상 냉장고 주문을 연결하면 무료 배송 자격(C)이 있습니다.',ranges:[r(1033,1154,'9월 1일 전에 계정을 등록하면 원클릭 결제와 100달러 이상 주문 무료 배송을 누릴 수 있습니다'),r(1363,1378,'날짜: 8월 29일'),r(1563,1658,'그곳에서는 Goldline 소형 냉장고를 귀사 웹사이트의 172달러보다 싼 156달러에 팔고 있습니다.'),r(1712,1752,'저는 이미 계정을 등록했습니다')]},
  199:{answer:'A',kind:'vocabulary',explanation:'trust that은 여기서 자격이 있다고 생각한다는 뜻이므로 assume(A)에 가깝습니다.',ranges:[r(2031,2091,'제가 여전히 귀사 웹사이트의 혜택을 받을 자격이 있다고 생각합니다.')]},
  200:{answer:'D',kind:'inference',explanation:'8월 구매·24개월 보증을 광고의 8월 Baronial 2년 보증과 연결하면 Upright 범주(D)입니다.',ranges:[r(436,515,'올해 8월에 한해 모든 Baronial 청소기에 2년 연장 보증이 제공됩니다.'),r(376,399,'업라이트(직립형) 청소기'),r(2300,2327,'구매일: 8월 26일'),r(2502,2590,'본 보증서는 기재된 제품의 보증 기간을 24개월로 연장합니다.')]},
 }},
};

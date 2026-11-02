/** Reviewed teaching examples. Exact-source matching never replaces later user edits or changes note revisions. */
interface ExamplePatch {expression:string;expectedExample:string;example:string;translation:string;structure?:string;confusion?:string;}
const patches:ExamplePatch[] = [
  {
    "expression": "admit (admitting)",
    "expectedExample": "Spectators are purchasing tickets to the final match of the Wilbur Tennis Championship as the event is fast approaching.",
    "example": "Event staff are admitting ticket holders to the stadium for the final match.",
    "translation": "행사 직원들은 결승전 표를 가진 관중들을 경기장에 입장시키고 있습니다."
  },
  {
    "expression": "affluent",
    "expectedExample": "As soon as he assumed his new position, sales director Carl Reynolds set an ambitious target for the team for the next quarter.",
    "example": "The new tennis club offers private coaching for affluent customers.",
    "translation": "새 테니스 클럽은 부유한 고객들에게 개인 지도를 제공합니다."
  },
  {
    "expression": "eligible",
    "expectedExample": "As soon as he assumed his new position, sales director Carl Reynolds set an ambitious target for the team for the next quarter.",
    "example": "Employees who complete the course are eligible for reimbursement.\nOnly full-time employees are eligible to apply for the new sales position.",
    "translation": "과정을 수료한 직원은 비용을 환급받을 자격이 있습니다.\n정규직 직원만 새로운 영업직에 지원할 자격이 있습니다."
  },
  {
    "expression": "happen (happening)",
    "expectedExample": "Spectators are purchasing tickets to the final match of the Wilbur Tennis Championship as the event is fast approaching.",
    "example": "The final match is happening at the sports center this weekend.",
    "translation": "결승전은 이번 주말에 스포츠 센터에서 열립니다."
  },
  {
    "expression": "hold (holding)",
    "expectedExample": "Spectators are purchasing tickets to the final match of the Wilbur Tennis Championship as the event is fast approaching.",
    "example": "The club is holding a tennis championship at its new sports center.",
    "translation": "그 클럽은 새 스포츠 센터에서 테니스 선수권 대회를 개최하고 있습니다."
  },
  {
    "expression": "influential",
    "expectedExample": "As soon as he assumed his new position, sales director Carl Reynolds set an ambitious target for the team for the next quarter.",
    "example": "The sales director is an influential figure in the company.",
    "translation": "그 영업 이사는 회사에서 영향력 있는 인물입니다."
  },
  {
    "expression": "range from A to B",
    "expectedExample": "ranging from traditional Cuban plates to modern French specialties.",
    "example": "The restaurant offers dishes ranging from traditional Cuban plates to modern French specialties.",
    "translation": "그 식당은 전통 쿠바 요리부터 현대적인 프랑스 특선 요리까지 다양한 음식을 제공합니다.",
    "structure": "range from A to B: A부터 B까지 다양하게 걸치다\nranging은 range의 -ing형입니다.\nplates는 이 문맥에서 요리, specialties는 특선 요리입니다.",
    "confusion": "from과 to로 범위의 양끝을 함께 표시합니다."
  },
  {
    "expression": "ready-to-wear lines",
    "expectedExample": "Alaina Switch who produced superb clothing for both our formal and ready-to-wear lines.",
    "example": "Alaina Switch produced superb clothing for both our formal and ready-to-wear lines.",
    "translation": "알레이나 스위치는 우리의 정장 라인과 기성복 라인 모두를 위해 훌륭한 의류를 제작했습니다."
  },
  {
    "expression": "superb clothing",
    "expectedExample": "Alaina Switch who produced superb clothing for both our formal and ready-to-wear lines.",
    "example": "Alaina Switch produced superb clothing for both our formal and ready-to-wear lines.",
    "translation": "알레이나 스위치는 우리의 정장 라인과 기성복 라인 모두를 위해 훌륭한 의류를 제작했습니다.",
    "structure": "superb: 매우 훌륭한·뛰어난\nclothing: 의류(불가산명사)\nsuperb clothing: 훌륭한 의류",
    "confusion": "정장 라인과 기성복 라인을 나열한 문장입니다. 정장이라고 해서 모두 맞춤복이라는 뜻은 아닙니다."
  },
  {
    "expression": "a portion of",
    "expectedExample": "the Department of Public Works will close a portion of Dean Avenue at 10am today.",
    "example": "The Department of Public Works will close a portion of Dean Avenue at 10 a.m. today.",
    "translation": "공공사업부는 오늘 오전 10시에 Dean Avenue의 일부 구간을 폐쇄할 예정입니다."
  },
  {
    "expression": "be capable of ~",
    "expectedExample": "it would help her understand what our firm is capable of doing.",
    "example": "It would help her understand what our firm is capable of doing.",
    "translation": "그것은 그녀가 우리 회사가 어떤 일을 할 수 있는지 이해하는 데 도움이 될 거예요."
  },
  {
    "expression": "firm",
    "expectedExample": "it would help her understand what our firm is capable of doing.",
    "example": "It would help her understand what our firm is capable of doing.",
    "translation": "그것은 그녀가 우리 회사가 어떤 일을 할 수 있는지 이해하는 데 도움이 될 거예요."
  },
  {
    "expression": "would have been able to + 동사 / wouldn't have been able to + 동사",
    "expectedExample": "Had she not provided me with a grant to travel abroad, I wouldn't have been able to take the photos shown here.",
    "example": "With a travel grant, I would have been able to photograph the exhibition abroad.\nWithout the travel grant, I wouldn't have been able to take those photographs.",
    "translation": "여행 지원금이 있었더라면 해외 전시회를 촬영할 수 있었을 텐데요.\n그 여행 지원금이 없었더라면 그 사진들을 찍을 수 없었을 것입니다."
  }
];
export function teachingExample(n:{expression:string;example:string;translation?:string;structure:string;confusion:string}){
 const patch=patches.find(p=>p.expression.normalize('NFKC').toLowerCase()===n.expression.normalize('NFKC').toLowerCase()&&p.expectedExample===n.example);
 return patch?{example:patch.example,translation:patch.translation,structure:patch.structure??n.structure,confusion:patch.confusion??n.confusion,exampleKind:'authored_learning' as const,originalExample:n.example,originalTranslation:n.translation||''}:{example:n.example,translation:n.translation||'',structure:n.structure,confusion:n.confusion,exampleKind:'source' as const,originalExample:null,originalTranslation:null};
}

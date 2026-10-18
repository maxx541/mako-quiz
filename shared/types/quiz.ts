/** 存檔、手機畫面、公布與統計用的是三套不同形狀，不要混成一個型別。 */

export type SlideType =
  | 'single'
  | 'multi'
  | 'truefalse'
  | 'match'
  | 'categorize'
  | 'order'
  | 'type'
  | 'list'
  | 'number'
  | 'soup'
  | 'reveal'
  | 'music'
  | 'scale'
  | 'open'
  | 'qa'
  | 'content'

export type SlideTypeMeta = { label: string; icon: string; group: string; desc: string }

export type Points = 'none' | 'standard' | 'double'
export type SpeedBonus = 'inherit' | 'on' | 'off'
export type RevealMode = 'tiles' | 'blur' | 'zoom'
export type OpenDisplay = 'cloud' | 'list'

export type Explain = { text: string; image: string | null }
export type Option = { id: string; text: string; correct: boolean; image: string | null }
export type Pair = {
  id: string
  left: string
  right: string
  leftImage: string | null
  rightImage: string | null
}
export type Category = { id: string; name: string }
export type CatItem = { id: string; text: string; image: string | null; categoryId: string }
export type OrderItem = { id: string; text: string; image: string | null }
export type DisplayItem = { id: string; text: string; image: string | null }

export type SlideBase = {
  id: string
  title: string
  note: string
  image: string | null
  timeLimit: number
  points: Points
  speedBonus: SpeedBonus
  explain: Explain
}

export type ChoiceSlide = SlideBase & {
  type: 'single' | 'multi' | 'truefalse'
  options: Option[]
  poll: boolean
}

export type MusicSlide = SlideBase & {
  type: 'music'
  audio: string | null
  audioStart: number
  autoPlay: boolean
  options: Option[]
  poll: boolean
}

export type RevealSlide = SlideBase & {
  type: 'reveal'
  stages: number
  stageSeconds: number
  revealMode: RevealMode
  grid: { rows: number; cols: number }
  stageTiles: number[][]
  options: Option[]
  poll: boolean
}

export type MatchSlide = SlideBase & { type: 'match'; pairs: Pair[] }

export type CategorizeSlide = SlideBase & {
  type: 'categorize'
  categories: Category[]
  items: CatItem[]
}

export type OrderSlide = SlideBase & { type: 'order'; items: OrderItem[] }

export type TypeSlide = SlideBase & {
  type: 'type'
  accepted: string[]
  ignoreCase: boolean
  ignoreSpace: boolean
}

export type ListSlide = SlideBase & {
  type: 'list'
  accepted: string[]
  allBonus: number
  maxSubmissions: number
  ignoreCase: boolean
  ignoreSpace: boolean
}

export type NumberSlide = SlideBase & {
  type: 'number'
  answer: number
  tolerance: number
  unit: string
}

export type SoupSlide = SlideBase & {
  type: 'soup'
  hints: { text: string }[]
  stageSeconds: number
  accepted: string[]
  ignoreCase: boolean
  ignoreSpace: boolean
}

export type ScaleSlide = SlideBase & {
  type: 'scale'
  min: number
  max: number
  minLabel: string
  maxLabel: string
}

export type OpenSlide = SlideBase & {
  type: 'open'
  maxChars: number
  maxSubmissions: number
  display: OpenDisplay
}

export type QaSlide = SlideBase & { type: 'qa' }
export type ContentSlide = SlideBase & { type: 'content'; body: string }

export type Slide =
  | ChoiceSlide
  | MusicSlide
  | RevealSlide
  | MatchSlide
  | CategorizeSlide
  | OrderSlide
  | TypeSlide
  | ListSlide
  | NumberSlide
  | SoupSlide
  | ScaleSlide
  | OpenSlide
  | QaSlide
  | ContentSlide

export type OptionSlide = ChoiceSlide | MusicSlide | RevealSlide

export type Background = {
  image: string | null
  dim: number
  blur: number
  auto: boolean
}

export type Reaction = { id: string; url: string | null; label: string }

export type PresentationSettings = {
  speedBonus: boolean
  showLeaderboard: boolean
  allowLateJoin: boolean
  qaEnabled: boolean
  qaAnonymous: boolean
  qaUpvote: boolean
  qaModeration: boolean
  reactionsEnabled: boolean
}

export type Presentation = {
  id: string
  title: string
  description: string
  theme: string
  background: Background
  cover: string | null
  lobbyMusic: string | null
  quizMusic: string | null
  quizMusicVolume: number
  reactions: Reaction[]
  settings: PresentationSettings
  slides: Slide[]
  createdAt: number
  updatedAt: number
}

export type PresentationSummary = {
  id: string
  title: string
  description: string
  theme: string
  background: Background
  cover: string | null
  slideCount: number
  createdAt: number
  updatedAt: number
}

export type PresentationInput = {
  title?: string
  description?: string
  theme?: string
  background?: Partial<Background>
  cover?: string | null
  lobbyMusic?: string | null
  quizMusic?: string | null
  quizMusicVolume?: number
  reactions?: Reaction[]
  settings?: Partial<PresentationSettings>
  slides?: Slide[]
}

/** 選項 id、複選／順序／複數答案，或配對與分類的 id 對照 */
export type AnswerValue = string | number | string[] | Record<string, string>

export type Answer = {
  value: AnswerValue
  at: number
  ms: number
  ratio: number
  correct: boolean
  points: number
  stage?: number
  tries?: number
}

export type GradeEntry = Answer & { playerId: string; name: string }

export type Player = {
  id: string
  token: string
  name: string
  avatar: string | null
  score: number
  streak: number
  socketId: string | null
  connected: boolean
  joinedAt: number
}

export type RankedPlayer = {
  id: string
  name: string
  avatar: string | null
  score: number
  streak: number
  connected: boolean
  rank: number
}

export type QaItem = {
  id: string
  text: string
  authorId: string
  author: string
  votes: string[]
  answered: boolean
  pinned: boolean
  approved: boolean
  createdAt: number
}

export type QaView = {
  id: string
  text: string
  author: string
  votes: number
  voted: boolean
  answered: boolean
  pinned: boolean
  approved: boolean
  createdAt: number
}

export type ExplainView = { text: string; image: string | null }

export type PlayerOption = { id: string; text: string; image: string | null; color: string }

type PlayerCore = {
  id: string
  title: string
  image: string | null
  timeLimit: number
  points: Points
  graded: boolean
  speedBonus: boolean
}

/** 給參與者的題目：沒有正解 */
export type PlayerSlide =
  | (PlayerCore & { type: 'single' | 'multi' | 'truefalse' | 'music'; options: PlayerOption[] })
  | (PlayerCore & { type: 'reveal'; image: null; options: PlayerOption[]; stages: number })
  | (PlayerCore & { type: 'soup'; hints: { text: string }[]; stages: number })
  | (PlayerCore & { type: 'number'; unit: string })
  | (PlayerCore & { type: 'scale'; min: number; max: number; minLabel: string; maxLabel: string })
  | (PlayerCore & {
      type: 'match'
      lefts: DisplayItem[]
      rights: { id: string; text: string; image: string | null }[]
    })
  | (PlayerCore & { type: 'categorize'; categories: Category[]; items: DisplayItem[] })
  | (PlayerCore & { type: 'order'; items: DisplayItem[] })
  | (PlayerCore & { type: 'type' })
  | (PlayerCore & { type: 'list'; total: number; maxSubmissions: number; allBonus: number })
  | (PlayerCore & { type: 'open'; maxChars: number; maxSubmissions: number; display: OpenDisplay })
  | (PlayerCore & { type: 'qa' })
  | (PlayerCore & { type: 'content'; body: string })

export type ChoiceSolution = { optionIds: string[] }
export type RevealSolution = { optionIds: string[]; image: string | null }
export type MatchSolution = { pairs: Pair[] }
export type CategorizeSolution = {
  categories: { id: string; name: string; items: { text: string; image: string | null }[] }[]
}
export type OrderSolution = { items: DisplayItem[] }
export type TypeSolution = { accepted: string[] }
export type ListSolution = { answers: { text: string; alts: string[] }[]; allBonus: number }
export type SoupSolution = { accepted: string[]; hints: { text: string }[] }
export type NumberSolution = { answer: number; unit: string; tolerance: number }

export type Solution =
  | ChoiceSolution
  | RevealSolution
  | MatchSolution
  | CategorizeSolution
  | OrderSolution
  | TypeSolution
  | ListSolution
  | SoupSolution
  | NumberSolution

export type PeopleRow = { name: string; value: string; correct: boolean }
export type ListPerson = { name: string; hits: number; items: { text: string; ok: boolean }[] }
export type StageHit = { stage: number; count: number }
export type Bar = {
  id: string
  text: string
  image: string | null
  color: string
  correct: boolean
  count: number
}

export type Aggregate =
  | {
      kind: 'number'
      total: number
      answer: number
      unit: string
      closest: { name: string; value: number; diff: number }[]
      avg: number | null
      median: number | null
      min: number | null
      max: number | null
      exact: number
      people: PeopleRow[]
    }
  | {
      kind: 'scale'
      total: number
      buckets: { value: number; count: number }[]
      avg: number | null
      min: number
      max: number
      minLabel: string
      maxLabel: string
    }
  | { kind: 'bars'; total: number; bars: Bar[]; stageHits?: StageHit[] }
  | {
      kind: 'pairs'
      total: number
      rows: (Pair & { count: number })[]
      perfect: number
    }
  | {
      kind: 'categorize'
      total: number
      cols: { id: string; name: string; items: (DisplayItem & { count: number })[] }[]
      perfect: number
    }
  | {
      kind: 'order'
      total: number
      rows: (DisplayItem & { position: number; count: number })[]
      perfect: number
    }
  | {
      kind: 'answers'
      total: number
      rows: { text: string; count: number; correct: boolean }[]
      correctCount: number
      people: PeopleRow[]
      stageHits?: StageHit[]
    }
  | {
      kind: 'list'
      total: number
      groupTotal: number
      rows: { text: string; count: number }[]
      perfect: number
      people: ListPerson[]
    }
  | {
      kind: 'open'
      total: number
      texts: { name: string; text: string }[]
      words: { text: string; count: number }[]
      display: OpenDisplay
    }
  | { kind: 'none'; total: number }

export type SessionState = 'lobby' | 'live' | 'results' | 'leaderboard' | 'ended'

export type HostSlide = Slide & {
  graded: boolean
  speedBonusOn: boolean
  displayItems: DisplayItem[] | null
}

export type SlideOutline = { id: string; type: SlideType; title: string }

export type HostView = {
  code: string
  joinUrl: string
  title: string
  theme: string
  background: Background | null
  cover: string | null
  lobbyMusic: string | null
  quizMusic: string | null
  quizMusicVolume: number
  reactions: Reaction[]
  state: SessionState
  locked: boolean
  stage: number
  stages: number
  stagePoints: number
  index: number
  total: number
  slide: HostSlide | null
  outline: SlideOutline[]
  endsAt: number | null
  serverNow: number
  playerCount: number
  connectedCount: number
  answeredCount: number
  players: RankedPlayer[]
  results: Aggregate | null
  solution: Solution | null
  explain: ExplainView | null
  qa: QaView[]
  settings: PresentationSettings
}

export type MyAnswer = {
  value: AnswerValue
  correct: boolean | null
  ratio: number | null
  points: number | null
  stage: number
  tries: number
  marks?: boolean[]
  hits?: number
  groupHit?: boolean[]
}

export type PlayerSelf = {
  id: string
  name: string
  avatar: string | null
  score: number
  rank: number
  streak: number
}

export type PlayerSettings = {
  qaEnabled: boolean
  qaUpvote: boolean
  qaAnonymous: boolean
  reactionsEnabled: boolean
}

export type PlayerView = {
  code: string
  title: string
  theme: string
  background: Background | null
  reactions: Reaction[]
  state: SessionState
  locked: boolean
  stage: number
  stagePoints: number
  stages: number
  index: number
  total: number
  slide: PlayerSlide | null
  endsAt: number | null
  serverNow: number
  me: PlayerSelf
  playerCount: number
  myAnswer: MyAnswer | null
  solution: Solution | null
  explain: ExplainView | null
  results: Aggregate | null
  liveResults: Aggregate | null
  podium: RankedPlayer[] | null
  qa: QaView[]
  settings: PlayerSettings
}

export type HostOpenPayload = { presentationId?: string; token?: string; origin?: string }
export type HostResumePayload = { code?: string; token?: string }
export type HostActionPayload = {
  index?: number
  seconds?: number
  playerId?: string
  id?: string
  patch?: Partial<QaItem>
} & Partial<PresentationSettings>
export type PlayerJoinPayload = { code?: string; name?: string; token?: string }
export type PlayerAnswerPayload = { slideId?: string; value?: unknown }

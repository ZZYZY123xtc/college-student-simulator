// game.js
// =========================
// 大学生模拟器 v0.4.3（适配 grade_rule v3.2）
// ✅ 新增：社交属性 social（影响运气/突发好事权重/心情下滑折扣）
// ✅ 自动选课：按培养方案 planByTerm，保证 4 年修满学分（160）
// ✅ 第3周退补选：弹窗 + 可反复加/退课 + 自动排冲突（强制课不可退）
// ✅ 一周只允许 3 次行动
// ✅ CET4/6 证书显示
// ✅ 【新规则适配】必修卡B，选修秒A，需“高分解锁”
//
// 文件依赖：
// - course.js -> window.COURSE.generatePlan
// - grade_rule.js (deprecated; no longer used by grading flow)
// - event.js -> window.EVENTS + window.eventMatchesState
// =========================

/* ========== 常量 ========== */
const TERM_WEEKS = 16;
const TERMS_PER_YEAR = 2;
const ACTIONS_PER_WEEK = 3;                  // ✅ 一周只能做 3 件事
const FINALS_WEEKS = [14, 15, 16];

const FAMILY_ALLOWANCE_MONTHLY = { poor: 800, ok: 1500, mid: 3000, rich: 8000 };
const ASK_PARENTS_AMOUNT = { poor: 0, ok: 200, mid: 1000, rich: 10000 };

const WORK_REWARD = 400;
const WORK_ENERGY_COST = 15;
const WORK_STRESS_COST = 10;

// 学习动作消耗（每次 doStudyAction）
const STUDY_ENERGY_COST = 12;

const MONTHLY_ESSENTIALS_MIN = 200;
const MONTHLY_ESSENTIALS_MAX = 400;
const MONTHLY_PHONE_TOPUP = 50;

const EXAM_MATERIAL_FEE = 50;
// v0.4.2：周进入扣 7 天随机开销（钱会自己蒸发）
const DAILY_LIVING_COST_RANGE = {
  poor: [10, 20],
  ok: [20, 49],
  mid: [50, 100],
  rich: [50, 100],
};


const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const randi = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const DEBUG_STUDY = false;
const TEST_MODE = (typeof window !== "undefined")
  && (window.TEST_MODE === true || (window.location && new URLSearchParams(window.location.search).get("test") === "1"));

// 参数表（集中可调）
const PARAMS = {
  health: {
    initial: 75,
    clampMin: 0,
    clampMax: 100,
    weeklyDrift: {
      stressPenalty: [
        { min: 0,  max: 60, delta:  0 },
        { min: 61, max: 70, delta: -1 },
        { min: 71, max: 80, delta: -2 },
        { min: 81, max: 90, delta: -3 },
        { min: 91, max: 100, delta: -4 }
      ],
      energyPenalty: [
        { min: 0,  max: 24, delta: -2 },
        { min: 25, max: 39, delta: -1 },
        { min: 40, max: 100, delta: 0 }
      ],
      moodPenalty: [
        { min: 0,  max: 24, delta: -1 },
        { min: 25, max: 100, delta: 0 }
      ],
      selfHeal: [
        { cond: { stressMax: 55, energyMin: 60 }, delta: +2 },
        { cond: { stressMax: 60, energyMin: 50 }, delta: +1 }
      ],
      deltaClamp: { min: -8, max: +5 }
    },
    weeklyNoRestPenalty: { requireActionId: "rest", deltaHealth: -2 },
    actionEffects: {
      study:   { health: -5, energy: -10, stress: +6, mood: -1 },
      research:{ health: -1, energy: -14, stress: +8, mood: -2 },
      work:    { health: -2, energy: -12, stress: +6, mood: -1 },
      party:   { health:  0, energy:  -8, stress: -3, mood: +4, money: -60, social: +5 },
      rest:    { health: +2, energy: +18, stress: -12, mood: +3 },
      workout: { health: +5, energy: -10, stress: -6, mood: +2, money: -10, social: +0 }
    },
    efficiencyByHealth: [
      { min: 60, mult: 1.00 },
      { min: 40, mult: 0.85 },
      { min: 20, mult: 0.65 },
      { min: 0,  mult: 0.40 }
    ]
  },
  illness: {
    thresholds: { minor: 40, major: 20 },
    penalty: {
      minor: { durationWeeks: 1, actionCapDelta: -1, extraEffMult: 0.90 },
      major: { durationWeeks: 2, actionCapDelta: -2, extraEffMult: 0.70 }
    },
    events: {
      minor: {
        id: "HEALTH_MINOR",
        title: "小病来袭：免疫力欠费",
        text: "你有点感冒/肠胃不适。问题不大，但会拖慢你。",
        options: [
          { text: "买药+早睡", effects: { money: -80, health: +12, stress: -4, energy: +8, note: "先修好自己。" } },
          { text: "请假休息", effects: { health: +10, stress: -6, mood: +1, note: "你选择恢复。" } },
          { text: "硬扛",     effects: { health: -6, stress: +4, mood: -2, note: "你选择赌一把。" } }
        ]
      },
      major: {
        id: "HEALTH_MAJOR",
        title: "大病警告：你扛不住了",
        text: "你开始发烧、头晕、浑身酸痛。继续硬撑可能会出更大代价。",
        options: [
          { text: "去医院（住院观察）", effects: { money: -600, health: +35, energy: +20, stress: -8, note: "钱没了，但人保住了。" } },
          { text: "硬扛（继续上强度）", effects: { health: -10, stress: +8, mood: -4, note: "你把身体当一次性电池。" } }
        ]
      }
    }
  },
  severe: {
    mood: {
      threshold: 0,
      sustainWeeks: 1,
      suspendWeeks: 32,
      event: {
        id: "MOOD_SEVERE",
        title: "情绪低谷：你什么都不想做",
        text: "你陷入了持续性的低落与逃避，继续硬撑只会更糟。",
        options: [
          { text: "犹豫/逃避（办理休学一年）", effects: { suspendWeeks: 32, note: "你选择暂停一年。" } }
        ]
      }
    },
    stress: {
      threshold: 90,
      riskDurationWeeks: 2,
      suspendWeeks: 32,
      riskWeightMult: 1.6,
      riskEffMult: 0.85,
      event: {
        id: "STRESS_SEVERE",
        title: "崩溃风险：抑郁风险期",
        text: "压力过载，你进入抑郁风险期。继续硬撑可能会带来更大代价。",
        options: [
          { text: "办理休学一年（保命）", effects: { suspendWeeks: 32, note: "你决定停下来恢复。" } }
        ]
      }
    }
  }
};

// Phase B/C parameters (evidence + routes)
const PARAMS_V2 = {
  evidence: {
    showPerTerm: 5,
    keepPerTermMax: 60,
    negativeTags: ["fail", "failed", "revoke", "revoked", "setback", "crash"]
  },
  hidden: { clampMin: 0, clampMax: 100, diminishingDivisor: 130 },
  actionEvidence: {
    study: { deltas: { academicPower: +0.80, englishPower: +0.20, stability: +0.10 }, weight: 1, tags: ["学习", "自律"] },
    research: { deltas: { researchPower: +0.90, academicPower: +0.30, luck: +0.10, stability: +0.05 }, weight: 1, tags: ["科研", "导师"] },
    work: { deltas: { careerPower: +0.90, stability: +0.10 }, weight: 1, tags: ["实习", "项目"] },
    party: { deltas: { luck: +0.15, stability: +0.05 }, weight: 1, tags: ["社交", "机会"] },
    rest: { deltas: { stability: +0.20 }, weight: 1, tags: ["休息", "恢复"] },
        tags: ["pushmian", "checkpoint", "predicted"],
    english: { deltas: { englishPower: +1.00, academicPower: +0.20 }, weight: 1, tags: ["英语"] }
  },
  milestones: {
    cet4_pass: { deltas: { englishPower: +10, stability: +2, luck: +0.5 }, weight: 4, tags: ["英语", "里程碑"] },
    cet6_pass: { deltas: { englishPower: +12, stability: +2, luck: +0.5 }, weight: 4, tags: ["英语", "里程碑"] },
    internship_good: { deltas: { careerPower: +12, stability: +3, luck: +1 }, weight: 4, tags: ["实习", "里程碑"] },
    paper_minor: { deltas: { researchPower: +10, academicPower: +3, luck: +1 }, weight: 5, tags: ["论文", "科研"] },
    paper_major: { deltas: { researchPower: +18, academicPower: +6, luck: +2 }, weight: 5, tags: ["论文", "科研", "导师"] },
    fail_course: { deltas: { stability: -12, academicPower: -4 }, weight: 5, tags: ["挂科"] },
    discipline: { deltas: { stability: -20, luck: -5 }, weight: 5, tags: ["处分"] },
    suspend_1y: { deltas: { stability: -8 }, weight: 5, tags: ["休学"] }
  },
  routeChoice: { term: 6, week: 1, options: ["pg", "qiuzhao", "abroad", "kaoyan", "gongkao"] },
  pushmian: {
    gpaThreshold: 3.7,
    predictAtTermEnd: 6,
    finalAtTermEnd: 7,
    offerScoreWeights: { researchPower: 0.45, academicPower: 0.25, englishPower: 0.15, stability: 0.10, luck: 0.05 },
    tiers: [
      { minScore: 78, tier: "top" },
      { minScore: 65, tier: "good" },
      { minScore: 50, tier: "basic" },
      { minScore: 0, tier: "rare" }
    ],
    maxPendingOffers: 2
  },
  job: {
    weights: { careerPower: 0.50, academicPower: 0.20, englishPower: 0.10, stability: 0.15, researchPower: 0.05, luck: 0.10 },
    tiers: [
      { minScore: 78, result: "SSP_offer" },
      { minScore: 68, result: "SP_offer" },
      { minScore: 58, result: "P_offer" },
      { minScore: 0, result: "fail" }
    ]
  },
  overseas: {
    hard: { englishMin: 60 },
    weights: { englishPower: 0.30, researchPower: 0.30, academicPower: 0.20, careerPower: 0.10, stability: 0.05, luck: 0.05 },
    tiers: [
      { minScore: 80, result: "Top_overseas" },
      { minScore: 70, result: "Good_overseas" },
      { minScore: 60, result: "Basic_overseas" },
      { minScore: 0, result: "fail" }
    ]
  },
  postgrad: { weights: { academicPower: 0.45, englishPower: 0.20, stability: 0.20, luck: 0.15 }, passScore: 60 },
  civil: { weights: { stability: 0.40, luck: 0.25, academicPower: 0.20, careerPower: 0.10, englishPower: 0.05 }, passScore: 58 },
  routeEventWeightMult: { pushmian: 1.8, job: 1.6, overseas: 1.6, postgrad: 1.5, civil: 1.5 },
  moneyCutoff: {
    severeThreshold: 20,
    options: [
      { text: "向父母求助", effects: { money: +300, mood: -2, stress: +2 }, evidence: { title: "你向家里求助渡过断供", tags: ["断供", "求助"], deltas: { stability: +0.2 } } },
      { text: "被迫兼职（本周强制）", effects: { flags: { forcedWorkThisWeek: true } }, evidence: { title: "你被迫把时间换成现金流", tags: ["断供", "兼职"], deltas: { careerPower: +0.5, stability: -0.1 } } },
      { text: "卖东西/退订开销", effects: { money: +120, stress: -1, mood: -1 }, evidence: { title: "你清理开销保住现金流", tags: ["断供", "节制"], deltas: { stability: +0.3 } } },
      { text: "找朋友周转", effects: { money: +150, social: -3, stress: +1 }, evidence: { title: "你用人情换了周转", tags: ["断供", "人情"], deltas: { luck: +0.2, stability: -0.2 } } }
    ]
  }
};
function getCurrentTermIndex() {
  return (state.year - 1) * TERMS_PER_YEAR + state.term;
}

function ensureSeasonState() {
  state.seasons = state.seasons || {};
  const defaults = {
    pushmian: { unlocked: false, stage: 0, tokens: 0, badges: [], deadlineAbsWeek: null },
    job: { unlocked: false, stage: 0, tokens: 0, badges: [], deadlineAbsWeek: null },
    overseas: { unlocked: false, stage: 0, tokens: 0, badges: [], deadlineAbsWeek: null },
    postgrad: { unlocked: false, stage: 0, tokens: 0, badges: [], deadlineAbsWeek: null },
    civil: { unlocked: false, stage: 0, tokens: 0, badges: [], deadlineAbsWeek: null }
  };
  for (const key of Object.keys(defaults)) {
    if (!state.seasons[key]) state.seasons[key] = defaults[key];
    const s = state.seasons[key];
    s.unlocked = !!s.unlocked;
    s.stage = Number(s.stage || 0);
    s.tokens = Number(s.tokens || 0);
    s.badges = Array.isArray(s.badges) ? s.badges : [];
    s.deadlineAbsWeek = s.deadlineAbsWeek || null;
  }
}

function getSeason(route) {
  ensureSeasonState();
  return state.seasons[route];
}

function setSeasonStage(route, stage) {
  const s = getSeason(route);
  s.unlocked = true;
  s.stage = Math.max(0, Number(stage || 0));
}

function addSeasonTokens(route, delta) {
  const s = getSeason(route);
  s.tokens = Math.max(0, Number(s.tokens || 0) + Number(delta || 0));
}

function awardBadge(route, name) {
  if (!name) return;
  const s = getSeason(route);
  if (!s.badges.includes(name)) s.badges.push(name);
}

function unlockSeason(route, stage, tokenDelta) {
  const s = getSeason(route);
  s.unlocked = true;
  if (stage) s.stage = Math.max(s.stage, Number(stage || 0));
  if (typeof tokenDelta === "number") addSeasonTokens(route, tokenDelta);
}

function hasSeasonBadge(route, badge) {
  if (!badge) return false;
  const s = getSeason(route);
  return Array.isArray(s.badges) && s.badges.includes(badge);
}

function ensurePushmianPrepSeason() {
  const route = getActiveRoute();
  if (route && route !== "pg") return;
  const term = getCurrentTermIndex();
  if (term < 6) return;
  const gpa = calcCumulativeGPA();
  if (gpa < PARAMS_V2.pushmian.gpaThreshold) return;
  const s = getSeason("pushmian");
  if (!s.unlocked) {
    s.unlocked = true;
    s.stage = Math.max(s.stage, 1);
  }
}

function updateSeasonProgressByTime() {
  const term = getCurrentTermIndex();
  const week = state.week;
  const seasonRoutes = Object.keys(state.seasons || {});
  for (const route of seasonRoutes) {
    const s = getSeason(route);
    if (!s.unlocked) continue;
    if (s.stage < 2 && term >= 6 && week >= 4) s.stage = 2;
    if (s.stage < 3 && term >= 7 && week >= 4) s.stage = 3;
  }
}

/* ========== DOM helpers ========== */
const byId = (id) => document.getElementById(id);
function setText(el, text) { if (el) el.textContent = text; }
function clear(el) { if (el) el.innerHTML = ""; }

/* ========== UI 绑定（必须和 index.html 的 id 对齐） ========== */
const ui = {
  timeText: byId("timeText"),
  metaTerm: byId("metaTerm"),
  metaWeek: byId("metaWeek"),
  timeText: byId("timeText"),

  txtEnergy: byId("txtEnergy"),
  txtStress: byId("txtStress"),
  txtMood: byId("txtMood"),
  txtHealth: byId("txtHealth"),
  txtMoney: byId("txtMoney"),
  txtSocial: byId("txtSocial"),

  barEnergy: byId("barEnergy"),
  barStress: byId("barStress"),
  barMood: byId("barMood"),
  barHealth: byId("barHealth"),
  barMoney: byId("barMoney"),
  barSocial: byId("barSocial"),

  // Overview
  btnAcaMed: byId("btnAcaMed"),
  btnAcaStem: byId("btnAcaStem"),
  btnAcaBiz: byId("btnAcaBiz"),
  btnAcaArts: byId("btnAcaArts"),
  txtAcaHint: byId("txtAcaHint"),

  btnFamPoor: byId("btnFamPoor"),
  btnFamOk: byId("btnFamOk"),
  btnFamMid: byId("btnFamMid"),
  btnFamRich: byId("btnFamRich"),
  txtFamHint: byId("txtFamHint"),

  btnRouteAbroad: byId("btnRouteAbroad"),
  btnRouteBaoyan: byId("btnRouteBaoyan"),
  btnRouteKaoyan: byId("btnRouteKaoyan"),
  btnRouteGongkao: byId("btnRouteGongkao"),
  btnRouteQiuzhao: byId("btnRouteQiuzhao"),
  txtRouteHint: byId("txtRouteHint"),

  btnStart: byId("btnStart"),
  txtStartHint: byId("txtStartHint"),

  // Tabs + panes
  tabs: Array.from(document.querySelectorAll(".tab")),
  panes: Array.from(document.querySelectorAll(".pane")),

  // Courses tab
  btnAutoPlan: byId("btnAutoPlan"),
  btnOpenAddDrop: byId("btnOpenAddDrop"),
  courseList: byId("courseList"),
  certList: byId("certList"),
  gradeList: byId("gradeList"),

  // Week tab
  btnNextWeek: byId("btnNextWeek"),
  actionPanel: byId("actionPanel"),
  txtActionsLeft: byId("txtActionsLeft"),
  logBox: byId("logBox"),

  // Season tab
  seasonSummary: byId("seasonSummary"),
  seasonList: byId("seasonList"),
  seasonBadges: byId("seasonBadges"),
  seasonOffers: byId("seasonOffers"),
  seasonTodo: byId("seasonTodo"),
  btnRouteTodo: byId("btnRouteTodo"),
  endingList: byId("endingList"),

  // Event modal
  modalEvent: byId("modalEvent"),
  evTitle: byId("evTitle"),
  evText: byId("evText"),
  evOptions: byId("evOptions"),
  evHint: byId("evHint"),

  // Add-drop modal
  modalAddDrop: byId("modalAddDrop"),
  btnResolveConflicts: byId("btnResolveConflicts"),
  btnCloseAddDrop: byId("btnCloseAddDrop"),
  btnCloseAddDropX: byId("btnCloseAddDropX"),
  adCurrent: byId("adCurrent"),
  adPool: byId("adPool"),
  adHint: byId("adHint"),
};

/* ========== 状态 ========== */
const state = {
  // 学籍
  started: false,
  year: 1,
  term: 1,
  week: 1,

  // 选择
  family: null,                 // poor/ok/mid/rich
  academy: null,                // 中文：医/理工/商科/文社
  academyNormalized: null,      // medicine/stem/biz/arts
  route: null,                  // ✅ 路线可不选：research/career/abroad/null

  // 数值
  energy: 80,
  stress: 20,
  mood: 70,
  health: PARAMS.health.initial,
  money: 200,
  social: 50,                   // ✅ 新增社交属性

  // 隐藏属性（长线，不直接对玩家展示）
  hiddenProfile: {
    academicPower: 0,
    researchPower: 0,
    careerPower: 0,
    englishPower: 0,
    stability: 0,
    luck: 0
  },
  evidenceLog: [],
  track: {
    pushmian: { status: "locked", predictedAtTerm: null, confirmedAtTerm: null },
    job: { status: "locked" },
    overseas: { status: "locked" },
    postgrad: { status: "locked" },
    civil: { status: "locked" }
  },
  seasons: {
    pushmian: { unlocked: false, stage: 0, tokens: 0, badges: [], deadlineAbsWeek: null },
    job: { unlocked: false, stage: 0, tokens: 0, badges: [], deadlineAbsWeek: null },
    overseas: { unlocked: false, stage: 0, tokens: 0, badges: [], deadlineAbsWeek: null },
    postgrad: { unlocked: false, stage: 0, tokens: 0, badges: [], deadlineAbsWeek: null },
    civil: { unlocked: false, stage: 0, tokens: 0, badges: [], deadlineAbsWeek: null }
  },
  offers: [],
  outcomes: {},
  endingUnlocked: {},
  routeChoice: null,
  route: null,                  // 单一路线：pg|kaoyan|abroad|gongkao|qiuzhao
  testGPA: null,
  logHistory: [],
  flags: {},                    // 【新】存储全局状态，如 allRequiredReachedB
  status: {},                   // 存放 healthPenalty 等持续性状态
  branches: {
    autumnRecruit: {
      enabled: false,
      resume: 0,
      prep: 0,
      queue: [],
      offers: [],
      inbox: []
    }
  },

  // 学期状态
  termGradeBonus: 0,            // 本学期成绩修正（事件/选择）
  termStudy: 0,                 // 本学期学习次数
  termResearch: 0,              // 本学期科研次数
  studyThisWeek: 0,             // 本周学习次数（CET近4周统计）
  studyRecent4: [],             // 最近4周学习次数

  // 学习分配（v3.1 成绩规则需要）
  totalStudyThisTerm: 0,        // 本学期“学习动作”总次数
  finalsStudyWeeksThisTerm: 0,  // 期末周学习次数（0..3）
  studyActionsByCourseId: {},   // { courseId: hits }
  masteredCourseIds: [],        // 学到 A(≥90) 的课程（用于自动分配时跳过）

  disciplineFlag: false,        // 纪律处分（可扩展）
  conflictsResolved: true,      // 退补选后是否已解决冲突（默认 true）

  // 证书/轨迹
  certs: {
    cet4: null, // {score, pass, term, year}
    cet6: null,
  },
  milestones: {
    sci: 0,
    offers: 0,
  },

  // 课程 - 唯一真相源：termSelectedCourses
  curriculumPlan: null,         // from course.js
  allCoursesPool: [],
  termSelectedCourses: [],      // 本学期已选课程（唯一真相源）
  recommendedCoursesThisTerm: { current: [], retake: [], overdue: [] }, // 本学期推荐/补修/逾期补修
  completedCourseIds: new Set(), // 已通过课程ID（硬规则：不可再选）
  failedCourseIds: new Set(), // 挂科课程ID（可重修）
  failedCourseRecords: {}, // courseId -> { termIndex, year, term }
  mandatoryChainProgress: {}, // 强制链进度 { chainGroup: completedOrder }
  creditsEarned: 0,

  // 月度（1月=4周）
  monthlyDinnerWeeks: [],
  monthlyDinnerAbsMonth: null,
  parentsAskedAbsMonth: null,


  // 每周
  actionsLeft: ACTIONS_PER_WEEK,
  weekActionCounts: {},

  // 事件
  recentEventIds: [],
  eventCooldownUntilAbsWeek: {},  // id -> absWeek
  eventPending: false,
  pendingEvent: null,

  // 四六级考试
  cetRegistrationShownThisTerm: false, // 本学期是否已显示报名弹窗
  cetExamPending: false, // 是否有CET考试待处理

  // 弹窗状态
  addDropShownThisTerm: false,
  lastTermReport: null,
  showGradeReminder: false,

  // 成绩历史记录（用于总成绩视图）
  gradeHistory: [], // [{ year, term, courses: [{ name, percent, letter, gpa, credits, pass }], termGPA, totalCredits }]
  
  // 成绩视图状态
  gradeViewMode: "term", // "term" | "total"

  // ========== 新学习系统（4槽+队列） ==========
  // 学习队列（循环队列，存 courseId）
  studyQueue: [],
  
  // 4个并行学习槽（存 courseId，null 表示空槽）
  studySlots: [null, null, null, null],
  
  // 每门课的学习进度
  courseProgress: {}, // { courseId: { stage: 1|2, hits: number, done: boolean } }
  
  // 课程难度缓存（避免重复计算）
  courseDifficulty: {}, // { courseId: difficulty }
  
  // 阶段阈值
  THRESHOLD_B: 3,          // stage 1 完成阈值（达到B）
  THRESHOLD_A_PLUS: 5,     // stage 2 完成阈值（达到A）
  
  // 难度→进度增量映射
  DIFFICULTY_TO_POINTS: {
    1: 3.0,
    2: 2.0,
    3: 1.0,
    4: 0.5,
    5: 0.3,
  },
};

const START_HINT_DEFAULT = "提示：第1周选课，第3周退补选（弹窗），期末周14-16。";

function setStartHint(text) {
  setText(ui.txtStartHint, text || START_HINT_DEFAULT);
}

/* ========== 日志 ========== */
function logLine(text) {
  const line = document.createElement("div");
  line.className = "line";
  line.textContent = text;
  ui.logBox.appendChild(line);
  ui.logBox.scrollTop = ui.logBox.scrollHeight;
  state.logHistory = state.logHistory || [];
  state.logHistory.push(String(text));
  if (state.logHistory.length > 500) {
    state.logHistory = state.logHistory.slice(-500);
  }
  // 也输出到控制台，便于在 DevTools 中复制验证信息
  try { console.log(text); } catch (e) { /* noop */ }
}

/* ========== 日志：数值变化（你要的“每个选项结束后显示变化”） ========== */
function snapshotMainStats() {
  return {
    energy: Number(state.energy || 0),
    stress: Number(state.stress || 0),
    mood: Number(state.mood || 0),
    money: Number(state.money || 0),
    social: Number(state.social || 0),
    termGradeBonus: Number(state.termGradeBonus || 0),
  };
}

function formatDeltaLine(before, after) {
  const parts = [];
  const push = (label, d) => {
    if (!d) return;
    const s = d > 0 ? `+${d}` : `${d}`;
    parts.push(`${label}${s}`);
  };

  push("精力", after.energy - before.energy);
  push("压力", after.stress - before.stress);
  push("心情", after.mood - before.mood);
  push("金钱", after.money - before.money);
  push("社交", after.social - before.social);
  push("成绩修正", after.termGradeBonus - before.termGradeBonus);

  if (!parts.length) return "";
  return `【数值变化】${parts.join(" · ")}`;
}

function applyMoodDelta(rawDelta) {
  let delta = Number(rawDelta) || 0;
  if (delta < 0 && Number(state.social || 0) > 90) {
    // High social buffers negative mood swings a bit.
    delta = Math.min(-1, Math.round(delta * 0.8));
  }
  state.mood = clamp(state.mood + delta, 0, 100);
  return delta;
}

function applyHiddenDeltas(deltas) {
  if (!deltas) return;
  const min = PARAMS_V2.hidden.clampMin;
  const max = PARAMS_V2.hidden.clampMax;
  const div = PARAMS_V2.hidden.diminishingDivisor || 130;
  state.hiddenProfile = state.hiddenProfile || {
    academicPower: 0,
    researchPower: 0,
    careerPower: 0,
    englishPower: 0,
    stability: 0,
    luck: 0
  };
  for (const k of Object.keys(deltas)) {
    const raw = Number(deltas[k] || 0);
    if (!raw) continue;
    const cur = Number(state.hiddenProfile[k] || 0);
    const eff = raw * (1 - cur / div);
    const next = clamp(cur + eff, min, max);
    state.hiddenProfile[k] = next;
  }
}

function trimEvidenceLog(term, year) {
  const maxKeep = PARAMS_V2.evidence.keepPerTermMax || 60;
  if (!maxKeep) return;
  let count = 0;
  for (const e of state.evidenceLog) {
    if (e.term === term && e.year === year) count += 1;
  }
  while (count > maxKeep) {
    const idx = state.evidenceLog.findIndex(e => e.term === term && e.year === year);
    if (idx < 0) break;
    state.evidenceLog.splice(idx, 1);
    count -= 1;
  }
}

const ACTION_EVIDENCE_TITLES = {
  study: "你完成了一次学习。",
  research: "你的科研推进了一步。",
  work: "你完成了一次兼职。",
  party: "你参加了一次社交活动。",
  rest: "你休息了一次。",
  workout: "你完成了一次运动训练。"
};

function addEvidence(entry) {
  const e = entry || {};
  const ev = {
    type: e.type || "event",
    term: Number(e.term || state.term),
    week: Number(e.week || state.week),
    absWeek: Number(e.absWeek || absWeekIndex()),
    year: Number(e.year || state.year),
    title: e.title || "一次经历塑造了你。",
    tags: Array.isArray(e.tags) ? e.tags : [],
    deltas: e.deltas || {},
    weight: Number(e.weight || 1),
    meta: e.meta || {}
  };
  state.evidenceLog = state.evidenceLog || [];
  applyHiddenDeltas(ev.deltas);
  state.evidenceLog.push(ev);
  trimEvidenceLog(ev.term, ev.year);
  return ev;
}

function addActionEvidence(actionId) {
  const cfg = PARAMS_V2.actionEvidence && PARAMS_V2.actionEvidence[actionId];
  if (!cfg) return;
  addEvidence({
    type: "action",
    title: cfg.title || ACTION_EVIDENCE_TITLES[actionId] || `你完成了一次行动：${actionId}。`,
    tags: cfg.tags || [],
    deltas: cfg.deltas || {},
    weight: cfg.weight || 1,
    meta: { actionId }
  });
}



/* ========== 通用效果应用器（供行动/事件调用） ========== */
function applyEffects(effects) {
  if (!effects || typeof effects !== 'object') return;
  const merged = Object.assign({}, effects);
  if (typeof merged.stress === "number" && merged.stress > 0) {
    const buff = Number(state.status?.postLeaveBuffWeeks || 0);
    if (buff > 0) merged.stress = Math.max(0, merged.stress - 1);
  }
  // 数值型变化
  const hmin = PARAMS.health.clampMin, hmax = PARAMS.health.clampMax;
  if (typeof merged.energy === 'number') state.energy = clamp(state.energy + merged.energy, 0, 100);
  if (typeof merged.health === 'number') state.health = clamp(state.health + merged.health, hmin, hmax);
  if (typeof merged.stress === 'number') state.stress = clamp(state.stress + merged.stress, 0, 100);
  if (typeof merged.mood === 'number') applyMoodDelta(merged.mood);
  if (typeof merged.money === 'number') state.money = Math.max(0, state.money + merged.money);
  if (typeof merged.social === 'number') state.social = clamp(state.social + merged.social, 0, 100);


  if (merged.hidden && typeof merged.hidden === 'object') {
    addEvidence({
      type: "event",
      title: merged.evidenceTitle || (merged.note ? String(merged.note) : "一次经历影响了你。"),
      tags: merged.evidenceTags || ["经历"],
      deltas: merged.hidden,
      weight: merged.evidenceWeight || 1,
      meta: merged.evidenceMeta || {}
    });
  }

  if (merged.flags && typeof merged.flags === 'object') {
    state.flags = state.flags || {};
    for (const k of Object.keys(merged.flags)) {
      state.flags[k] = !!merged.flags[k];
    }
  }

  if (typeof merged.suspendWeeks === 'number') {
    setSuspensionWeeks(merged.suspendWeeks, merged.suspendReason);
  }

  // 其他直接写入
  if (typeof merged.termGradeBonus === 'number') state.termGradeBonus = (state.termGradeBonus || 0) + merged.termGradeBonus;

  // 可选说明文本
  if (merged.note) logLine(String(merged.note));

  // 防止资金或其他触发状态未同步到 UI
  try { render(); } catch (e) { /* noop */ }
}

// Apply action effects from PARAMS.health.actionEffects with optional extras
function applyActionEffects(actionId, extras) {
  extras = extras || {};
  const base = (PARAMS.health.actionEffects && PARAMS.health.actionEffects[actionId]) || {};
  state.weekActionCounts = state.weekActionCounts || {};
  state.weekActionCounts[actionId] = (state.weekActionCounts[actionId] || 0) + 1;
  const weeklyCount = state.weekActionCounts[actionId];
  // clone/merge shallow for numeric fields and nested hidden/note
  const merged = Object.assign({}, base, extras);
  // merge hidden sub-object
  if (base.hidden || extras.hidden) {
    merged.hidden = Object.assign({}, base.hidden || {}, extras.hidden || {});
  }
  if (actionId === "study" || actionId === "party") {
    const healthSteps = [-5, -8, -10];
    const idx = Math.min(weeklyCount, healthSteps.length) - 1;
    const extraHealth = typeof extras.health === "number" ? extras.health : 0;
    merged.health = healthSteps[idx] + extraHealth;
  }
  applyEffects(merged);
  addActionEvidence(actionId);
}

/* ========== 学习动作封装（供按钮/脚本直接调用） ========== */
function doStudyAction() {
  if (state.actionsLeft <= 0) return;
  const before = snapshotMainStats();
  state.actionsLeft--;
  state.termStudy = (state.termStudy || 0) + 1;
  state.totalStudyThisTerm = (state.totalStudyThisTerm || 0) + 1;
  state.studyThisWeek = (state.studyThisWeek || 0) + 1;

  // 学习应消耗精力/影响心情（保持与其他行动一致的 applyEffects 使用方式）
  try {
    applyActionEffects("study");
  } catch (e) {
    // 如果 applyEffects 出错，不影响学习推进
  }

  // 调度学习系统的一次推进（会返回日志行数组）
  let logs = [];
  try {
    if (typeof runStudyOnce === 'function') logs = runStudyOnce() || [];
    else logs = ["学习系统未初始化。"];
  } catch (e) {
    logs = ["学习执行出错：" + e.toString()];
  }

  for (const l of logs) if (l) logLine(l);

  const d = formatDeltaLine(before, snapshotMainStats());
  if (d) logLine(d);
}

/* ========== Tab ========== */
function setTab(tabId) {
  ui.tabs.forEach(btn => btn.classList.toggle("active", btn.dataset.tab === tabId));
  ui.panes.forEach(p => p.classList.toggle("active", p.id === tabId));
}

/* ========== 社交 -> 运气（你要的“社交高运气好”） ========== */
function calcLuckEffective() {
  // 以 50 为“中性社交”，高于 50 会加运气，低于 50 会略减
  const baseLuck = Number(state.hiddenProfile.luck || 0);
  const socialBonus = (Number(state.social || 50) - 50) / 20;  // 90 -> +2
  return baseLuck + socialBonus;
}

function computeDifficulty(course) {
  if (!course) return 3;
  const name = String(course.name || "");
  const type = String(course.type || "");
  const area = String(course.area || "");
  const isPE = name.includes("体育");
  const isGeneralElective = name.includes("通识选修") || name.includes("任选小课") || area === "通识";
  const isEnglish = name.includes("英语");
  const isPolitics = name.includes("思政") || name.includes("政治");

  let difficulty = 3;
  if (isPE || isGeneralElective) {
    difficulty = 1;
  } else if (isEnglish || isPolitics) {
    difficulty = 2;
  } else {
    const credits = Number(course.credits) || 0;
    if (credits <= 1) difficulty = 2;
    else if (credits === 2) difficulty = 3;
    else if (credits === 3) difficulty = 4;
    else difficulty = 5;
  }
  course.difficulty = difficulty;
  return difficulty;
}

/* ========== 新学习系统：难度计算 ========== */
/**
 * 计算课程难度（1-5档）
 * 规则：
 * 1. 选修课、体育课 → difficulty = 1
 * 2. 英语类、思政类 → difficulty = 2
 * 3. 其余专业课 → 按学分映射（1学分→2，2学分→3，3学分→4，4学分及以上→5）
 */
function calculateCourseDifficulty(course) {
  return computeDifficulty(course);
}

/* ========== 新学习系统：队列初始化 ========== */
/**
 * 学期开始时初始化学习队列
 * 1. 计算每门课的 difficulty
 * 2. 按 difficulty 升序排序
 * 3. 生成队列（存 courseId）
 */
// 重建学习队列（不重置进度，只调整顺序）
function rebuildStudyQueue() {
  if (!state.termSelectedCourses || state.termSelectedCourses.length === 0) {
    state.studyQueue = [];
    logLine("学习队列为空。当前无可学课程。");
    return;
  }

  // 仅处理本学期选择的课程（state.termSelectedCourses）
  const candidates = state.termSelectedCourses.filter(course =>
    !state.completedCourseIds.has(course.id) &&
    !course.dropped &&
    !state.courseProgress?.[course.id]?.done
  );

  // 初始化 courseProgress 或根据已有 hits 设置阶段
  for (const course of candidates) {
    if (!state.courseProgress[course.id]) {
      state.courseProgress[course.id] = {
        hits: 0.0,
        stage: 1,
        done: false,
      };
    } else {
      const hits = Number(state.courseProgress[course.id].hits || 0);
      state.courseProgress[course.id].stage = hits >= 3.0 ? 2 : 1;
    }
  }

  const candidateIds = new Set(candidates.map(c => c.id));

  // 清理 studySlots：移除不属于候选集或重复的槽位
  const slotSet = new Set();
  for (let i = 0; i < state.studySlots.length; i++) {
    const slotId = state.studySlots[i];
    if (!slotId) continue;
    if (!candidateIds.has(slotId) || slotSet.has(slotId)) {
      state.studySlots[i] = null;
      continue;
    }
    slotSet.add(slotId);
  }

  // 构建新的学习队列：按 difficulty 升序稳定排序（slot 中的课程不加入队列）
  const sortedCandidates = candidates
    .filter(c => !slotSet.has(c.id))
    .map(c => ({
      course: c,
      diff: Number(c.difficulty ?? computeDifficulty(c) ?? 3)
    }))
    .sort((a, b) => {
      if (a.diff !== b.diff) return a.diff - b.diff;
      return String(a.course.name).localeCompare(String(b.course.name));
    })
    .map(x => x.course.id);

  state.studyQueue = sortedCandidates;

  const preview = state.studyQueue.slice(0, 10).map(id => {
    const c = state.termSelectedCourses.find(x => x.id === id);
    const name = c?.name || id;
    const diff = computeDifficulty(c);
    const hits = state.courseProgress[id]?.hits?.toFixed(1) || "0.0";
    return `${name}(D${diff},hits=${hits})`;
  });

  logLine(`学习队列：${state.studyQueue.length} 门（前 10 项：${preview.join(" · ")})`);
}

  // 预览队列的前若干项用于日志输出
function initStudySystem() {
  rebuildStudyQueue();
}


/* ========== 新学习系统：推进单门课程 ========== */
/**
 * 推进指定课程的学习进度
 * @param {string} courseId 课程ID
 * @returns {object|null} 返回完成信息，如果完成阶段则返回 { stage: 1|2, courseId }
 */

/* ========== 新学习系统：单次学习调度 ========== */
/**
 * 执行一次学习动作（消耗4个tick）
 * 返回本次学习的日志信息
 */
// 四槽学习系统（简化版：轮转队列）
function runStudyOnce() {
  const logs = [];
  let tickBudget = 4; // 本次学习动作的 tick 预算（最多 4 次学习单元）

  // 只考虑 termSelectedCourses 中未完成且未被删除的课程作为学习候选
  const studyCandidates = state.termSelectedCourses.filter(course =>
    !state.completedCourseIds.has(course.id) &&
    !course.dropped &&
    !state.courseProgress?.[course.id]?.done
  );

  if (studyCandidates.length === 0) {
    logs.push("本周暂无学习候选。");
    return logs;
  }

  for (const course of studyCandidates) {
    if (!state.courseProgress[course.id]) {
      state.courseProgress[course.id] = { hits: 0.0, stage: 1, done: false };
    }
  }

  // 校验并清理 studySlots 的有效性（去除非法或重复的 slotId）
  const validIds = new Set(studyCandidates.map(c => c.id));
  const slotSet = new Set();
  for (let i = 0; i < 4; i++) {
    const slotId = state.studySlots[i];
    if (!slotId) continue;
    if (!validIds.has(slotId) || slotSet.has(slotId)) {
      state.studySlots[i] = null;
    } else {
      slotSet.add(slotId);
    }
  }

  if (!Array.isArray(state.studyQueue)) state.studyQueue = [];
  let queueSet = new Set(state.studyQueue);
  const queueShift = () => {
    const id = state.studyQueue.shift();
    if (id != null) queueSet.delete(id);
    return id;
  };
  const queuePush = (id) => {
    if (!queueSet.has(id)) {
      state.studyQueue.push(id);
      queueSet.add(id);
    }
  };

  if (state.studyQueue.length === 0) {
    rebuildStudyQueue();
    queueSet = new Set(state.studyQueue);
  }

  // 防止同一轮内同一 courseId 被推进多次或占用多个槽
  const processedThisAction = new Set();
  // 标记当前已有槽位里的课程为已处理，以免被再次分配
  for (let i = 0; i < state.studySlots.length; i++) {
    const id = state.studySlots[i];
    if (id) processedThisAction.add(id);
  }

  const queueShiftNonProcessed = (excludedSet) => {
    if (!Array.isArray(state.studyQueue) || state.studyQueue.length === 0) return null;
    const maxTry = state.studyQueue.length;
    for (let t = 0; t < maxTry; t++) {
      const id = state.studyQueue.shift();
      if (id == null) continue;
      queueSet.delete(id);
      if (excludedSet && excludedSet.has(id)) {
        // 将其放回队尾并继续寻找未处理项
        if (!queueSet.has(id)) { state.studyQueue.push(id); queueSet.add(id); }
        continue;
      }
      return id;
    }
    return null;
  };

  while (tickBudget > 0) {
    let actionTaken = false;

    // 1. 分配空槽：从队列中取课程填充到空的学习槽
    for (let slotIdx = 0; slotIdx < 4; slotIdx++) {
      if (tickBudget <= 0) break;
      if (state.studySlots[slotIdx] !== null) continue;

      if (state.studyQueue.length > 0) {
        const courseId = queueShiftNonProcessed(processedThisAction);
        if (!courseId) continue;
        // 再次防护：若该 id 已在槽中则跳过
        if ((state.studySlots || []).some(sid => sid === courseId)) {
          // 已存在则回队尾
          queuePush(courseId);
          continue;
        }
        state.studySlots[slotIdx] = courseId;
        processedThisAction.add(courseId);
        const course = state.termSelectedCourses.find(c => c.id === courseId);
        logs.push(`槽${slotIdx + 1} 学习：${course?.name || courseId}`);
        actionTaken = true;
      }
    }

    // 2. 对槽内课程进行学习推进（消耗 tick）
    for (let slotIdx = 0; slotIdx < 4; slotIdx++) {
      if (tickBudget <= 0) break;
      const courseId = state.studySlots[slotIdx];
      if (!courseId) continue;

      const course = state.termSelectedCourses.find(c => c.id === courseId);
      if (!course) continue;

      const progress = state.courseProgress[courseId];
      if (!progress || progress.done) continue;

      const difficulty = computeDifficulty(course);
        const baseGain = state.DIFFICULTY_TO_POINTS?.[difficulty] || 1.0;
        const mult = (typeof getEffMult === 'function') ? getEffMult() : 1.0;
        const gain = +(baseGain * mult);
      const hitsBefore = Number(progress.hits || 0);
      const stageBefore = Number(progress.stage || 1);
      // 严格累加 hits（不可重置），并封顶 5.0
      progress.hits = Math.min(5.0, hitsBefore + gain);
      const stageAfter = progress.hits >= 3.0 ? 2 : 1;
      progress.stage = stageAfter;

        logs.push(`  - ${course.name} (D${difficulty}) hits +${gain.toFixed(1)} (base ${baseGain.toFixed(1)}×mult ${mult.toFixed(2)}) (${hitsBefore.toFixed(1)}→${progress.hits.toFixed(1)})`);
      if (stageAfter !== stageBefore) {
        logs.push(`    阶段升级：stage ${stageBefore} → stage ${stageAfter}（hits ${hitsBefore.toFixed(1)}→${progress.hits.toFixed(1)}）`);
      }

      // 达到 5.0 视为完成（done），立即走课程结算流程并计入已修
      if (progress.hits >= 5.0) {
        progress.done = true;
        logs.push(`    完成课程 ${course.name} (hits=${progress.hits.toFixed(1)})`);
        try { finalizeCourse(course); } catch (e) { logs.push(`    结课时出错：${e.toString()}`); }
      }

      // 只有在阶段升级（首次达到B）或完成时，才移出槽位并（若未完成）回队尾；否则保留在槽位等待下次推进
      if (stageAfter !== stageBefore || progress.done) {
        // 移出槽位
        state.studySlots[slotIdx] = null;
        if (!progress.done) {
          queuePush(courseId);
          logs.push(`    已返回队列：${course.name}`);
        }
      }

      actionTaken = true;
      tickBudget--;
    }

    if (!actionTaken) break;
  }

  return logs;
}

/* ========== 课程工具 ========== */
function isLockedCourseThisTerm(courseId) {
  const locked = state.curriculumPlan?.lockedByTerm?.[getCurrentTermIndex()] || [];
  return locked.includes(courseId);
}

function isCourseSelectedThisTerm(courseId) {
  return (state.termSelectedCourses || []).some(c => c.id === courseId);
}

function getFailedRecord(courseId) {
  return state.failedCourseRecords ? state.failedCourseRecords[courseId] : null;
}

function isRetakeTerm(courseId) {
  const rec = getFailedRecord(courseId);
  if (!rec) return false;
  // Allow retake from the next term onward until passed.
  return getCurrentTermIndex() >= rec.termIndex + 1;
}

// ========== 强制课系统（唯一入口）==========

// 初始化强制链进度（学期开始时调用）
function initMandatoryChainProgress() {
  state.mandatoryChainProgress = {};
  // 从课程池中收集所有强制链
  const chains = new Map(); // chainGroup -> [{course, order}]
  for (const course of state.allCoursesPool) {
    if (course.chainGroup && course.chainOrder != null) {
      if (!chains.has(course.chainGroup)) {
        chains.set(course.chainGroup, []);
      }
      chains.get(course.chainGroup).push({ course, order: course.chainOrder });
    }
  }
  // 为每个链计算已完成进度
  for (const [chainGroup, courses] of chains) {
    courses.sort((a, b) => a.order - b.order);
    let completedOrder = 0;
    for (const { course } of courses) {
      if (state.completedCourseIds.has(course.id)) {
        completedOrder = Math.max(completedOrder, course.chainOrder);
      } else {
        break; // 必须按顺序完成
      }
    }
    state.mandatoryChainProgress[chainGroup] = completedOrder;
  }
}

// 强制课唯一入口函数
function ensureMandatoryCoursesForTerm(termIndex) {
  if (!state.curriculumPlan) return;

  const lockedIds = state.curriculumPlan.lockedByTerm?.[termIndex] || [];
  if (!lockedIds.length) return;

  const existingIds = new Set(state.termSelectedCourses.map(c => c.id));
  const usedSlots = new Set();
  for (const c of state.termSelectedCourses) {
    (c.timeslots || []).forEach(slot => usedSlots.add(slot));
  }

  let newAdded = 0;
  let alreadyExists = 0;

  for (const id of lockedIds) {
    // 跳过已通过的课程
    if (state.completedCourseIds.has(id)) continue;

    const course = state.allCoursesPool.find(c => c.id === id);
    if (!course) continue;

    if (existingIds.has(id)) {
      alreadyExists++;
      continue;
    }

    // 检查是否可以选择（硬规则）
    const check = canSelectCourse(course);
    if (!check.allowed) {
      logLine(`⚠️ 强制课 ${course.name} 无法加入：${check.reason}`);
      continue;
    }

    // 分配时段
    course.locked = true;
    course.nonDroppable = true;
    if (!course.timeslots || course.timeslots.length === 0) {
      assignRandomSlot(course, usedSlots, true);
    }

    state.termSelectedCourses.push(course);
    newAdded++;
  }

  if (newAdded > 0 || alreadyExists > 0) {
    logLine(`[Mandatory] term=${termIndex} 新增${newAdded}门，已存在${alreadyExists}门，总强制课=${state.termSelectedCourses.filter(c => c.locked).length}`);
  }
}

// 获取强制链中下一门应学习的课程
function getNextMandatoryCourseInChain(chainGroup) {
  const progress = state.mandatoryChainProgress[chainGroup] || 0;
  const nextOrder = progress + 1;

  const candidates = state.allCoursesPool.filter(c =>
    c.chainGroup === chainGroup &&
    c.chainOrder === nextOrder &&
    !state.completedCourseIds.has(c.id) &&
    !isCourseSelectedThisTerm(c.id)
  );

  if (candidates.length === 0) return null;

  // 返回第一个匹配的（按ID排序保证确定性）
  candidates.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return candidates[0];
}

// 检查本学期是否已经有该链的课程
function hasChainCourseThisTerm(chainGroup) {
  return state.termSelectedCourses.some(c => c.chainGroup === chainGroup);
}

// 硬规则过滤器：检查课程是否可以被选择
function canSelectCourse(course) {
  // 1) Completed courses cannot be selected again
  if (state.completedCourseIds.has(course.id)) {
    return { allowed: false, reason: "completed" };
  }

  // 2) No duplicate selections in the same term
  if (isCourseSelectedThisTerm(course.id)) {
    return { allowed: false, reason: "already selected" };
  }

  // 3) Failed courses only appear from the retake term onward
  if (state.failedCourseIds.has(course.id) && !isRetakeTerm(course.id)) {
    return { allowed: false, reason: "retake term only" };
  }

  // 4) Chain rule: only one course from the same chain per term
  if (course.chainGroup && hasChainCourseThisTerm(course.chainGroup)) {
    return { allowed: false, reason: `chain ${course.chainGroup} already in term` };
  }

  return { allowed: true, reason: "" };
}

function courseConflicts(a, b) {
  const A = new Set(a.timeslots || []);
  for (const t of (b.timeslots || [])) if (A.has(t)) return true;
  return false;
}

function anyConflict(courseList) {
  for (let i = 0; i < courseList.length; i++) {
    for (let j = i + 1; j < courseList.length; j++) {
      if (courseConflicts(courseList[i], courseList[j])) return true;
    }
  }
  return false;
}

function getTimeSlotsPool() {
  return (window.COURSE && Array.isArray(window.COURSE.TIME_SLOTS)) ? window.COURSE.TIME_SLOTS : [];
}

function assignRandomSlot(course, usedSlots, allowConflict = false) {
  const pool = getTimeSlotsPool();
  if (!course || pool.length === 0) return { assigned: false, conflict: true };
  const tries = 50;
  for (let i = 0; i < tries; i++) {
    const slot = pool[Math.floor(Math.random() * pool.length)];
    if (!usedSlots.has(slot)) {
      course.timeslots = [slot];
      usedSlots.add(slot);
      return { assigned: true, conflict: false };
    }
  }

  if (allowConflict) {
    const slot = pool[Math.floor(Math.random() * pool.length)];
    course.timeslots = [slot];
    usedSlots.add(slot);
    return { assigned: true, conflict: true };
  }

  return { assigned: false, conflict: true };
}

/* ========== 渲染 ========== */
function renderMeta() {
  const month = Math.floor((state.week - 1) / 4) + 1;
  const combo = `第${state.year}学年 · 第${state.term}学期 · 第${state.week}周（第${month}月）`;
  if (ui.timeText) setText(ui.timeText, combo);
  setText(ui.metaTerm, `第 ${state.year} 学年 · 第 ${state.term} 学期`);
  setText(ui.metaWeek, `第 ${state.week} 周`);
}

function renderBars() {
  setText(ui.txtEnergy, `${state.energy}/100`);
  setText(ui.txtStress, `${state.stress}/100`);
  setText(ui.txtMood, `${state.mood}/100`);
  setText(ui.txtHealth, `${state.health}/100`);
  setText(ui.txtMoney, `${state.money} 元`);
  setText(ui.txtSocial, `${state.social}/100`);

  ui.barEnergy.style.width = `${state.energy}%`;
  ui.barStress.style.width = `${state.stress}%`;
  ui.barMood.style.width = `${state.mood}%`;
  ui.barHealth.style.width = `${state.health}%`;
  ui.barSocial.style.width = `${state.social}%`;
  ui.barMoney.style.width = `${Math.min(100, Math.floor(state.money / 3000 * 100))}%`;
  
  if (ui.barEnergy) {
    if (state.energy < 15) ui.barEnergy.style.background = "linear-gradient(90deg, rgba(239,68,68,.9), rgba(245,158,11,.85))";
    else ui.barEnergy.style.background = "linear-gradient(90deg, rgba(43,108,255,.85), rgba(42,214,125,.85))";
  }
  if (ui.barStress) {
    if (state.stress >= 75) ui.barStress.style.background = "linear-gradient(90deg, rgba(239,68,68,.9), rgba(245,158,11,.85))";
    else ui.barStress.style.background = "linear-gradient(90deg, rgba(43,108,255,.85), rgba(42,214,125,.85))";
  }
}

function renderCourseList() {
  clear(ui.courseList);

  if (!state.curriculumPlan) {
    ui.courseList.innerHTML = `<div class="hint">未生成培养方案：请先在“概览”选择学院并开始。</div>`;
    return;
  }
  const selected = state.termSelectedCourses || [];
  // 推荐仅作为 UI 缓存，从缓存派生并排除已选课程，缓存本身不参与业务逻辑
  const recGroups = state.recommendedCoursesThisTerm || {};
  const filterSelected = (list) => (list || []).filter(x => !selected.some(s => s.id === x.id));
  const recCurrent = filterSelected(recGroups.current);
  const recRetake = filterSelected(recGroups.retake);
  const recOverdue = filterSelected(recGroups.overdue);
  const recAny = recCurrent.length + recRetake.length + recOverdue.length;

  const failedIds = state.failedCourseIds ? Array.from(state.failedCourseIds).filter(id => isRetakeTerm(id)) : [];
  if (failedIds.length) {
    const failBox = document.createElement("div");
    failBox.className = "hint";
    const names = failedIds.map(id => {
      const c = (state.allCoursesPool || []).find(x => x.id === id); // 从总池子里找
      return c ? c.name : id;
    });
    failBox.textContent = `⚠️ 挂科待重修：${failedIds.length} 门（${names.join("、")}）。重修 = 下学期起把这门课再选一次再学一次。`;
    ui.courseList.appendChild(failBox);
  }

  if (!selected.length && !recAny) {
    ui.courseList.innerHTML = `<div class="hint">本学期还没生成选课建议。第1周点击“按培养方案自动选课”（会自动加入强制课 + 生成推荐）。</div>`;
    return;
  }

  // 已选课程
  const titleSel = document.createElement("div");
  titleSel.className = "hint";
  titleSel.textContent = "【已选课程】";
  ui.courseList.appendChild(titleSel);

  if (!selected.length) {
    const tip = document.createElement("div");
    tip.className = "hint";
    tip.textContent = "当前未选任何课（如果本学期强制课为 0，可从下方推荐里自选）。";
    ui.courseList.appendChild(tip);
  } else {
    for (const c of selected) {
      const row = document.createElement("div");
      row.className = "line";

      const locked = isLockedCourseThisTerm(c.id);
      const retake = state.failedCourseIds && state.failedCourseIds.has(c.id) && isRetakeTerm(c.id);
      const badgeLocked = locked ? `<span class="badge lock">强制</span>` : `<span class="badge">可退</span>`;
      const badgeRetake = retake ? ` <span class="badge lock">重修</span>` : "";
      const slot = (c.timeslots || []).join(", ");

      row.innerHTML = `${badgeLocked}${badgeRetake} <b>${c.name}</b> · ${c.credits} 学分 · 难度${c.difficulty} · 上课：${slot}`;
      ui.courseList.appendChild(row);
    }
  }

  const credits = selected.reduce((s, c) => s + (Number(c.credits) || 0), 0);
  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = `本学期已选学分：${credits}（培养方案目标：${state.curriculumPlan.termTargetCredits[getCurrentTermIndex()]}）。第3周会弹出退补选，你也可以现在点“退补选”。`;
  ui.courseList.appendChild(hint);

  // 推荐（可选）
  if (recAny) {
    const hr = document.createElement("hr");
    hr.className = "sep";
    ui.courseList.appendChild(hr);

    const renderRecSection = (title, list, badgeText) => {
      if (!list.length) return;
      const titleRec = document.createElement("div");
      titleRec.className = "hint";
      titleRec.textContent = title;
      ui.courseList.appendChild(titleRec);

      for (const c of list) {
      const row = document.createElement("div");
      row.className = "rowBetween";

      const slot = (c.timeslots || []).join(", ");
      const left = document.createElement("div");
      const recBadge = `<span class="badge${c._retake ? " lock" : ""}">${badgeText}</span>`;
      left.innerHTML = `${recBadge} <b>${c.name}</b> · ${c.credits} 学分 · 难度${c.difficulty} · 上课：${slot}`;

      const btn = document.createElement("button");
      btn.className = "btn primary";
      btn.textContent = "加课";

      const wouldConflict = selected.some(x => courseConflicts(x, c));
      if (wouldConflict) {
        btn.disabled = true;
        btn.textContent = "冲突";
      }

      btn.addEventListener("click", () => {
        if (selected.some(x => x.id === c.id)) return;
        if (selected.some(x => courseConflicts(x, c))) return;
        state.termSelectedCourses.push(c);
        // 不直接修改推荐缓存，render 时会从缓存/规则派生推荐
        rebuildStudyQueue();
        render();
      });

      row.appendChild(left);
      row.appendChild(btn);
      ui.courseList.appendChild(row);
      }
    };

    renderRecSection("【本学期推荐（可选，不强制）】", recCurrent, "推荐");
    renderRecSection("【补修推荐（挂科需重修）】", recRetake, "补修");
    renderRecSection("【逾期补修（建议补上）】", recOverdue, "逾期");
  }
}

/* ========== 成绩列表渲染（双视图） ========== */
function letterFromSimGpa(simGpa) {
  const sim = Math.max(0, Math.min(5, Number(simGpa) || 0));
  if (sim >= 4.5) return "A+";
  if (sim >= 4.0) return "A";
  if (sim >= 3.5) return "A-";
  if (sim >= 3.0) return "B";
  if (sim >= 1.0) return "C";
  return "F";
}

function percentRangeForLetter(letter) {
  switch (letter) {
    case "A+": return [95, 100];
    case "A": return [90, 94];
    case "A-": return [85, 89];
    case "B+": return [82, 84];
    case "B": return [78, 81];
    case "B-": return [75, 77];
    case "C+": return [71, 74];
    case "C": return [66, 70];
    case "C-": return [62, 65];
    case "D": return [60, 61];
    default: return [0, 59];
  }
}

function letterFromPercent(percent) {
  if (percent >= 95) return "A+";
  if (percent >= 90) return "A";
  if (percent >= 85) return "A-";
  if (percent >= 82) return "B+";
  if (percent >= 78) return "B";
  if (percent >= 75) return "B-";
  if (percent >= 71) return "C+";
  if (percent >= 66) return "C";
  if (percent >= 62) return "C-";
  if (percent >= 60) return "D";
  return "F";
}

function gpaRangeForPercent(percent) {
  if (percent >= 95) return [4.5, 5.0];
  if (percent >= 90) return [4.0, 4.4];
  if (percent >= 85) return [3.5, 3.9];
  if (percent >= 82) return [3.2, 3.4];
  if (percent >= 78) return [2.8, 3.1];
  if (percent >= 75) return [2.5, 2.7];
  if (percent >= 71) return [2.1, 2.4];
  if (percent >= 66) return [1.6, 2.0];
  if (percent >= 62) return [1.2, 1.5];
  if (percent >= 60) return [1.0, 1.1];
  return [0.0, 0.0];
}

// 根据模拟绩点（hits/simGpa）确定最终字母等级（使用指定绩点区间映射）
function letterFromSimGpa(simGpa) {
  const s = Number(simGpa || 0);
  if (s >= 4.5) return "A+";
  if (s >= 4.0) return "A";
  if (s >= 3.5) return "A-";
  if (s >= 3.2) return "B+";
  if (s >= 2.8) return "B";
  if (s >= 2.5) return "B-";
  if (s >= 2.1) return "C+";
  if (s >= 1.6) return "C";
  if (s >= 1.2) return "C-";
  if (s >= 1.0) return "D";
  return "F";
}

// 为单门课程生成并固化最终成绩（仅执行一次，幂等）
function finalizeCourse(course) {
  if (!course) return;
  if (!state.courseProgress || !state.courseProgress[course.id]) state.courseProgress = state.courseProgress || {};
  const progress = state.courseProgress[course.id] || { hits: 0.0 };
  if (course.finalized) return;

  const simGpa = Number(progress.hits || 0);
  const letter = letterFromSimGpa(simGpa);
  const range = percentRangeForLetter(letter);
  const finalPercent = randi(range[0], range[1]);
  const [gMin, gMax] = gpaRangeForPercent(finalPercent);
  let finalGpa = 0.0;
  if (gMax > 0 && gMax >= gMin) {
    // 在绩点区间内均匀随机并保留一位小数
    finalGpa = Math.round((gMin + Math.random() * (gMax - gMin)) * 10) / 10;
  }

  // 固化到 course 对象，且仅生成一次
  course.simGpa = simGpa;
  course.finalLetter = letter;
  course.finalPercent = finalPercent;
  course.finalGpa = finalGpa;
  course.finalized = true;

  // 只有在通过（percent>=60）时，计入已通过集合与学分
  const passed = finalPercent >= 60;
  if (passed) {
    state.completedCourseIds.add(course.id);
    state.creditsEarned = (state.creditsEarned || 0) + Number(course.credits || 0);
    if (state.failedCourseIds && state.failedCourseIds.has(course.id)) state.failedCourseIds.delete(course.id);
    if (state.failedCourseRecords && state.failedCourseRecords[course.id]) delete state.failedCourseRecords[course.id];
  } else {
    state.failedCourseIds = state.failedCourseIds || new Set();
    state.failedCourseIds.add(course.id);
    state.failedCourseRecords = state.failedCourseRecords || {};
    state.failedCourseRecords[course.id] = { termIndex: getCurrentTermIndex(), year: state.year, term: state.term };
    const m = PARAMS_V2.milestones.fail_course;
    addEvidence({
      type: "milestone",
      title: `You failed ${course.name}.`,
      tags: m.tags || ["fail"],
      deltas: m.deltas || {},
      weight: m.weight || 5,
      meta: { courseId: course.id }
    });
  }

  // 记录标准化 final 日志
  logLine(`[Final] ${course.id} ${course.name} hits=${simGpa.toFixed(1)} letter=${letter} percent=${finalPercent} gpa=${finalGpa.toFixed(1)} passed=${passed}`);
}

function sanitizeCurrentTermHistory() {
  if (!state.gradeHistory || state.gradeHistory.length === 0) return;
  const lastTerm = state.gradeHistory[state.gradeHistory.length - 1];
  if (!lastTerm) return;
  if (lastTerm.year !== state.year || lastTerm.term !== state.term) return;

  const courseByName = new Map((state.termSelectedCourses || []).map(c => [c.name, c]));
  lastTerm.courses = lastTerm.courses.map(r => {
    if (r && r.percent === 50 && r.letter === "F" && Number(r.gpa || 0) === 0 && r.pass === false) {
      const course = courseByName.get(r.name);
      if (course && !course.isCompleted && course.finalPercent == null) {
        return { ...r, percent: null, letter: null, gpa: null, pass: null, status: "进行中" };
      }
    }
    return r;
  });
}

function renderGradeList() {
  if (!ui.gradeList) return;

  // 如果没有成绩历史，显示提示
  if (!state.gradeHistory || state.gradeHistory.length === 0) {
    ui.gradeList.innerHTML = `<div class="hint">期末周结束后自动生成本学期各科成绩。</div>`;
    return;
  }

  sanitizeCurrentTermHistory();
  const courseByName = new Map((state.termSelectedCourses || []).map(c => [c.name, c]));

  if (state.gradeViewMode === "term") {
    // 视图A：分学期成绩（显示最近一个学期的成绩）
    const lastTerm = state.gradeHistory[state.gradeHistory.length - 1];
    if (!lastTerm) {
      ui.gradeList.innerHTML = `<div class="hint">暂无成绩记录。</div>`;
      return;
    }

    const header = `第${lastTerm.year}学年·第${lastTerm.term}学期期末`;
    const summary = `学期GPA：${lastTerm.termGPA.toFixed(2)}；累计已修学分：${lastTerm.totalCredits}/${state.curriculumPlan?.graduateCredits || 160}`;
    const rowsHtml = lastTerm.courses.map(r => {
      const course = courseByName.get(r.name);
      let percentText = (r.percent == null) ? "进行中" : Math.round(r.percent);
      let letterText = (r.letter == null) ? "-" : r.letter;
      let gpaText = (r.gpa == null) ? "-" : r.gpa.toFixed(1);
      let resultText = (r.status || (r.pass ? "通过" : "挂科"));
      if (r.percent == null && course && !course.isCompleted && state.week < TERM_WEEKS) {
        const simGpa = state.courseProgress?.[course.id]?.hits ?? 0;
        const predLetter = letterFromSimGpa(simGpa);
        const range = percentRangeForLetter(predLetter);
        percentText = `预测：${predLetter}（${range[0]}-${range[1]}）`;
        letterText = "预测";
        gpaText = "-";
        resultText = "进行中";
      }
      return `
      <tr>
        <td>${r.name}</td>
        <td>${percentText}</td>
        <td>${letterText}</td>
        <td>${gpaText}</td>
        <td>${r.credits}</td>
        <td>${resultText}</td>
      </tr>`;
    }).join("");

    ui.gradeList.innerHTML = `
      <div class="rowBetween" style="margin-bottom: 12px;">
        <h3 style="margin: 0;">成绩（期末生成）</h3>
        <div class="btnRow">
          <button class="btn active" id="btnGradeViewTerm">分学期</button>
          <button class="btn" id="btnGradeViewTotal">总成绩</button>
        </div>
      </div>
      <div class=\"gradeSummary\">${header}</div>
      <div class=\"gradeSummary\">${summary}</div>
      <table class=\"table\">
        <thead>
          <tr>
            <th>课程</th>
            <th>分数</th>
            <th>等级</th>
            <th>GPA</th>
            <th>学分</th>
            <th>结果</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    `;
  } else {
    // 视图B：总成绩（显示所有已修课程）
    const allCourses = [];
    let totalCredits = 0;
    let totalGpaCredits = 0;

    // 收集所有学期的课程
    for (const termRecord of state.gradeHistory) {
      for (const course of termRecord.courses) {
        allCourses.push({
          ...course,
          year: termRecord.year,
          term: termRecord.term,
        });
        if (course.percent != null) {
          totalCredits += course.credits;
          totalGpaCredits += course.gpa * course.credits;
        }
      }
    }

    const overallGPA = totalCredits > 0 ? (totalGpaCredits / totalCredits) : 0;
    const summary = `总GPA：${overallGPA.toFixed(2)}；累计已修学分：${totalCredits}/${state.curriculumPlan?.graduateCredits || 160}`;

    // 按学年学期排序
    allCourses.sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      if (a.term !== b.term) return a.term - b.term;
      return a.name.localeCompare(b.name);
    });

    const rowsHtml = allCourses.map(r => {
      const course = courseByName.get(r.name);
      let percentText = (r.percent == null) ? "进行中" : Math.round(r.percent);
      let letterText = (r.letter == null) ? "-" : r.letter;
      let gpaText = (r.gpa == null) ? "-" : r.gpa.toFixed(1);
      let resultText = (r.status || (r.pass ? "通过" : "挂科"));
      if (r.percent == null && course && !course.isCompleted && state.week < TERM_WEEKS) {
        const simGpa = state.courseProgress?.[course.id]?.hits ?? 0;
        const predLetter = letterFromSimGpa(simGpa);
        const range = percentRangeForLetter(predLetter);
        percentText = `预测：${predLetter}（${range[0]}-${range[1]}）`;
        letterText = "预测";
        gpaText = "-";
        resultText = "进行中";
      }
      return `
      <tr>
        <td>${r.name}</td>
        <td>第${r.year}学年·第${r.term}学期</td>
        <td>${percentText}</td>
        <td>${letterText}</td>
        <td>${gpaText}</td>
        <td>${r.credits}</td>
        <td>${resultText}</td>
      </tr>`;
    }).join("");

    ui.gradeList.innerHTML = `
      <div class="rowBetween" style="margin-bottom: 12px;">
        <h3 style="margin: 0;">成绩（期末生成）</h3>
        <div class="btnRow">
          <button class="btn" id="btnGradeViewTerm">分学期</button>
          <button class="btn active" id="btnGradeViewTotal">总成绩</button>
        </div>
      </div>
      <div class=\"gradeSummary\">${summary}</div>
      <table class=\"table\">
        <thead>
          <tr>
            <th>课程</th>
            <th>学期</th>
            <th>分数</th>
            <th>等级</th>
            <th>GPA</th>
            <th>学分</th>
            <th>结果</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    `;
  }

  // 绑定切换按钮事件
  const btnTerm = document.getElementById("btnGradeViewTerm");
  const btnTotal = document.getElementById("btnGradeViewTotal");
  
  if (btnTerm) {
    btnTerm.onclick = () => {
      state.gradeViewMode = "term";
      renderGradeList();
    };
  }
  
  if (btnTotal) {
    btnTotal.onclick = () => {
      state.gradeViewMode = "total";
      renderGradeList();
    };
  }
}

function renderCerts() {
  const lines = [];

  // 毕业进度 + 挂科待重修
  const gradNeed = (window.COURSE && window.COURSE.GRADUATE_CREDITS) || 160;
  const failIds = state.failedCourseIds ? Array.from(state.failedCourseIds) : [];
  const failNames = failIds
    .map(id => (state.allCoursesPool || []).find(c => c.id === id)) // 从总池子里找
    .filter(Boolean)
    .map(c => c.name);

  lines.push(`毕业进度：已修学分 ${state.creditsEarned}/${gradNeed}`);
  if (failIds.length) {
    lines.push(`挂科待重修：${failIds.length} 门（${failNames.join("、")}）`);
  } else {
    lines.push("挂科待重修：0 门");
  }

  // 【新】显示高分解锁状态
  const unlockStatus = state.flags?.allRequiredReachedB ? "已解锁 A+" : "未解锁 A+";
  lines.push(`学分状态：${unlockStatus}`);


  if (state.certs.cet4) {
    const x = state.certs.cet4;
    lines.push(`CET4：${x.score}（${x.pass ? "通过" : "未过"}，第${x.year}学年·第${x.term}学期）`);
  } else {
    lines.push("CET4：未参加/未记录");
  }

  if (state.certs.cet6) {
    const x = state.certs.cet6;
    lines.push(`CET6：${x.score}（${x.pass ? "通过" : "未过"}，第${x.year}学年·第${x.term}学期）`);
  } else {
    lines.push("CET6：未参加/未记录");
  }

  lines.push(`科研：SCI 计数 ${state.milestones.sci}；就业：Offer 计数 ${state.milestones.offers}`);

  ui.certList.textContent = lines.join(" / ");
}

/* ========== 就业中心（单入口 + 弹窗，占用行动次数） ========== */
function autumnAbsWeek() { return absWeekIndex(); }

// 就业公司池（优先复用 route_spec.js 的 COMPANY_40，否则用兜底列表）
const AUTUMN_COMPANY_POOL = (typeof COMPANY_40 !== "undefined" && Array.isArray(COMPANY_40) && COMPANY_40.length)
  ? COMPANY_40
  : ["字节跳动","腾讯","阿里巴巴","华为","美团","京东","网易","百度","小米","滴滴","微软","谷歌(中国岗)","亚马逊","苹果(中国岗)","麦肯锡","波士顿咨询","贝恩","德勤","普华永道","安永","药明康德","恒瑞医药","迈瑞医疗","国家电网","中国移动","中国电信","中石化","中石油","中车集团"];

const AUTUMN_COMPANY_TIERS = {
  top: ["苹果(中国岗)", "谷歌(中国岗)", "微软", "亚马逊", "字节跳动", "腾讯", "阿里巴巴", "华为", "美团", "百度"],
  high: ["京东", "网易", "小米", "滴滴", "麦肯锡", "波士顿咨询", "贝恩", "德勤", "普华永道", "安永"],
  mid: ["药明康德", "药明生物", "恒瑞医药", "百济神州", "信达生物", "复星医药", "迈瑞医疗", "联影医疗", "中科院系统单位", "国家电网"],
  basic: ["中国移动", "中国电信", "中石化", "中石油", "中国航天科工", "中国船舶", "中车集团", "地方国企平台公司"]
};

const AUTUMN_TIER_RULES = {
  top: {
    screen: { resume: 1.0, prep: 0.5, rand: [0, 0], threshold: 70 },
    offer:  { resume: 0.5, prep: 1.0, rand: [0, 0], threshold: 85 }
  },
  high: {
    screen: { resume: 0.8, prep: 0.6, rand: [0, 6], threshold: 60 },
    offer:  { resume: 0.5, prep: 0.9, rand: [0, 8], threshold: 68 }
  },
  mid: {
    screen: { resume: 0.7, prep: 0.6, rand: [0, 10], threshold: 50 },
    offer:  { resume: 0.5, prep: 0.8, rand: [0, 10], threshold: 64 }
  },
  basic: {
    screen: { resume: 0.6, prep: 0.5, rand: [0, 12], threshold: 46 },
    offer:  { resume: 0.4, prep: 0.7, rand: [0, 12], threshold: 58 }
  }
};

function getAutumnCompanyTier(name) {
  if (!name) return "mid";
  if (AUTUMN_COMPANY_TIERS.top.includes(name)) return "top";
  if (AUTUMN_COMPANY_TIERS.high.includes(name)) return "high";
  if (AUTUMN_COMPANY_TIERS.mid.includes(name)) return "mid";
  if (AUTUMN_COMPANY_TIERS.basic.includes(name)) return "basic";
  return "mid";
}

function calcAutumnScore(rule, ar) {
  const rMin = Array.isArray(rule.rand) ? rule.rand[0] : 0;
  const rMax = Array.isArray(rule.rand) ? rule.rand[1] : 0;
  return ar.resume * rule.resume + ar.prep * rule.prep + randi(rMin, rMax);
}

function getRouteSwing() {
  const luck = Number(state.hiddenProfile?.luck || 0);
  const social = Number(state.social || 0);
  const stress = Number(state.stress || 0);
  let swing = randi(-8, 8);
  swing += luck * 0.2;
  if (social >= 80) swing += 2;
  if (Number(state.delayTerms || 0) > 0) swing += 2;
  if (stress >= 85) swing -= 6;
  else if (stress >= 70) swing -= 3;
  return swing;
}

function applyScoreWithReroll(branch, base, threshold, label) {
  let score = base + getRouteSwing();
  if (score < threshold && branch && (branch.safetyToken || 0) > 0) {
    branch.safetyToken = Math.max(0, (branch.safetyToken || 0) - 1);
    const reroll = base + getRouteSwing();
    score = Math.max(score, reroll);
    if (branch.inbox) branch.inbox.push(`【${label}】保底票触发重掷。`);
  }
  return score;
}

function addSafetyProgress(branch) {
  if (!branch) return;
  if ((branch.safetyToken || 0) >= 1) return;
  branch.keyActions = Number(branch.keyActions || 0) + 1;
  if (branch.keyActions >= 4) {
    branch.keyActions = 0;
    branch.safetyToken = 1;
    if (branch.inbox) branch.inbox.push("【系统】获得一张保底票。");
  }
}

function jobNotify(text) { try { window.alert(text); } catch (e) { /* alert 可能被禁，用不到时忽略 */ } }

function canAwardAutumnBadges() {
  const gradNeed = state.curriculumPlan?.graduateCredits || 160;
  const creditsOk = Number(state.creditsEarned || 0) >= gradNeed;
  const suspendedEver = !!(state.flags && state.flags.suspendedEver);
  return creditsOk && !suspendedEver;
}

function canGraduateNow() {
  const gradNeed = state.curriculumPlan?.graduateCredits || 160;
  const creditsOk = Number(state.creditsEarned || 0) >= gradNeed;
  const noFail = !state.failedCourseIds || state.failedCourseIds.size === 0;
  return creditsOk && noFail;
}


function resetAutumnWeeklySubmit(ar, now) {
  if (!ar) return;
  if (ar.submitWeek !== now) {
    ar.submitWeek = now;
    ar.submitCount = 0;
  }
}

function absWeekAt(termIndex, week) {
  return (termIndex - 1) * TERM_WEEKS + week;
}

function isRouteCenterTime() {
  const termIdx = getCurrentTermIndex();
  return (termIdx === 7 && state.week >= 4) || termIdx >= 8;
}

function openCompanyPickModal(options) {
  const { suggested, maxPick, onConfirm } = options;
  let modal = document.getElementById("jobCompanyModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "jobCompanyModal";
    Object.assign(modal.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(0,0,0,0.45)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: "10000"
    });
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.style.display = "none"; });
    document.body.appendChild(modal);
  }

  const panel = document.createElement("div");
  Object.assign(panel.style, {
    background: "#111827",
    color: "#e5e7eb",
    minWidth: "360px",
    maxWidth: "520px",
    padding: "16px",
    borderRadius: "10px",
    boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
    maxHeight: "80vh",
    overflow: "hidden"
  });

  const title = document.createElement("div");
  title.style.fontSize = "18px";
  title.style.fontWeight = "700";
  title.style.marginBottom = "10px";
  const useCustomTitle = !!options.title;
  const titleBase = options.title || "选择要投递的公司";
  const unit = options.unit || (useCustomTitle ? "所" : "家");
  const renderTitle = (remaining) => {
    if (useCustomTitle) title.textContent = `${titleBase}（可选${remaining}${unit}）`;
    else title.textContent = `选择要投递的公司（本周剩余${remaining}家）`;
  };
  renderTitle(maxPick);
  panel.appendChild(title);

  const grid = document.createElement("div");
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = "repeat(2, 1fr)";
  grid.style.gap = "8px";

  const picked = new Set();
  const refreshButtons = () => {
    Array.from(grid.children).forEach(btn => {
      const chosen = picked.has(btn.dataset.name);
      btn.style.background = chosen ? "#2563eb" : "#1f2937";
      btn.style.color = chosen ? "#fff" : "#e5e7eb";
      btn.disabled = !chosen && picked.size >= maxPick;
    });
    confirmBtn.disabled = picked.size === 0;
    renderTitle(maxPick - picked.size);
  };

  suggested.forEach(name => {
    const btn = document.createElement("button");
    btn.dataset.name = name;
    btn.className = "btn";
    btn.textContent = name;
    btn.style.background = "#1f2937";
    btn.style.border = "1px solid #374151";
    btn.style.color = "#e5e7eb";
    btn.addEventListener("click", () => {
      if (picked.has(name)) picked.delete(name); else picked.add(name);
      refreshButtons();
    });
    grid.appendChild(btn);
  });
  const scrollBox = document.createElement("div");
  scrollBox.style.maxHeight = "55vh";
  scrollBox.style.overflowY = "auto";
  scrollBox.style.paddingRight = "4px";
  scrollBox.appendChild(grid);
  panel.appendChild(scrollBox);

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "btn";
  confirmBtn.style.marginTop = "12px";
  confirmBtn.textContent = options.confirmText || "确认投递";
  confirmBtn.addEventListener("click", () => {
    modal.style.display = "none";
    onConfirm(Array.from(picked));
  });
  panel.appendChild(confirmBtn);

  modal.innerHTML = "";
  modal.appendChild(panel);
  modal.style.display = "flex";
  refreshButtons();
}

function ensureAutumnEnabledIfNeeded() {
  state.branches = state.branches || {};
  const ar = state.branches.autumnRecruit || (state.branches.autumnRecruit = { enabled: false, resume: 0, prep: 0, queue: [], offers: [], inbox: [] });
  const termIdx = state.segment?.termIndex || getCurrentTermIndex();
  const route = getActiveRoute();
  if (route && route !== "qiuzhao") return;
  if (!ar.enabled && (state.segment?.type || "TERM") === "TERM" && ((termIdx === 7 && state.week >= 4) || termIdx >= 8)) {
    ar.enabled = true;
    ar.inbox.push("就业季开启：在“就业中心”投递/准备，结果按周结算。");
  }
}

function tickAutumnRecruit() {
  const route = getActiveRoute();
  if (route && route !== "qiuzhao") return;
  ensureAutumnEnabledIfNeeded();
  const ar = state.branches.autumnRecruit;
  if (!ar || !ar.enabled) return;
  const now = autumnAbsWeek();
  resetAutumnWeeklySubmit(ar, now);
  const nextQueue = [];
  for (const item of ar.queue) {
    if (item.dueWeek > now) { nextQueue.push(item); continue; }
    const tier = getAutumnCompanyTier(item.company);
    const rules = AUTUMN_TIER_RULES[tier] || AUTUMN_TIER_RULES.mid;
    if (item.type === "screen") {
      const score = calcAutumnScore(rules.screen, ar);
      const pass = score >= rules.screen.threshold;
      const msgScreen = `【就业】${item.company} 简历${pass ? "通过" : "未过"}（${Math.round(score)}）`;
      ar.inbox.push(msgScreen);
      jobNotify(msgScreen);
      if (pass) {
        nextQueue.push({ id: `${item.id}_iv`, company: item.company, type: "interview_ready", dueWeek: now, stage: "一面" });
      }
    } else if (item.type === "interview_result") {
      const score = calcAutumnScore(rules.offer, ar);
      const pass = score >= rules.offer.threshold;
      if (pass) {
        const offerScore = Math.round(score);
        ar.offers.push({ name: item.company, score: offerScore });
        const tierLabel = getAutumnCompanyTier(item.company);
        addOffer({
          kind: "job",
          status: "autumn",
          tier: tierLabel,
          source: "autumn",
          name: item.company,
          score: offerScore
        });
        state.flags = state.flags || {};
        if (!state.flags.jobFirstOffer) state.flags.jobFirstOffer = true;
        if (tierLabel === "top") state.flags.jobTopOffer = true;
        const msgPass = `【就业】${item.company} 面试通过，获得 offer（${Math.round(score)}）`;
        ar.inbox.push(msgPass);
        jobNotify(msgPass);
      } else {
        const msgFail = `【就业】${item.company} 面试未通过（${Math.round(score)}）`;
        ar.inbox.push(msgFail);
        jobNotify(msgFail);
      }
    } else {
      nextQueue.push(item);
    }
  }
  ar.queue = nextQueue;
}

function jobCenterAvailable() {
  ensureAutumnEnabledIfNeeded();
  const ar = state.branches?.autumnRecruit;
  const route = getActiveRoute();
  return !!(ar && ar.enabled && route === "qiuzhao");
}

function getJobCenterActions() {
  const list = [];
  list.push({ id: "resume_opt", name: "改简历（+简历度）", effects: { resume: 4, stress: 1 } });
  list.push({ id: "prep_practice", name: "刷题/面经（+准备度）", effects: { prep: 4, stress: 3, mood: -1 } });
  list.push({ id: "submit_app", name: "投递（进入筛选）" });
  const ar = state.branches?.autumnRecruit;
  const now = autumnAbsWeek();
  if (ar?.queue?.some(q => q.type === "interview_ready" && q.dueWeek <= now)) {
    list.push({ id: "attend_interview_ready", name: "参加安排（面试）" });
  }
  return list.slice(0, 4);
}

function ensureJobCenterButton() {
  const host = ui.actionPanel?.parentElement || document.body;
  let btn = document.getElementById("btnJobCenter");
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "btnJobCenter";
    btn.className = "btn";
    btn.style.marginLeft = "8px";
    btn.textContent = "就业中心";
    btn.addEventListener("click", openJobCenterModal);
    if (host && host.insertBefore) host.insertBefore(btn, host.firstChild);
    else document.body.appendChild(btn);
  }
  const show = jobCenterAvailable();
  btn.style.display = show ? "inline-block" : "none";
  const noEnergy = state.energy <= 0;
  btn.disabled = state.actionsLeft <= 0 || noEnergy;
  btn.title = state.actionsLeft <= 0 ? "本周行动已用完" : (noEnergy ? "精力值为0，只能选择休息" : "");
}

function openJobCenterModal() {
  ensureAutumnEnabledIfNeeded();
  const ar = state.branches?.autumnRecruit;
  if (!ar || !ar.enabled) return;
  resetAutumnWeeklySubmit(ar, autumnAbsWeek());
  let modal = document.getElementById("jobCenterModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "jobCenterModal";
    Object.assign(modal.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(0,0,0,0.45)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: "9999"
    });
    modal.addEventListener("click", (e) => { if (e.target === modal) closeJobCenterModal(); });
    document.body.appendChild(modal);
  }

  const panel = document.createElement("div");
  Object.assign(panel.style, {
    background: "#111827",
    color: "#e5e7eb",
    minWidth: "360px",
    maxWidth: "520px",
    padding: "18px",
    borderRadius: "10px",
    boxShadow: "0 10px 30px rgba(0,0,0,0.35)"
  });

  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.justifyContent = "space-between";
  header.style.alignItems = "center";
  header.innerHTML = `<div style="font-size:18px;font-weight:700;">就业中心</div><button class="btn" id="jobCenterClose">关闭</button>`;
  panel.appendChild(header);

  const inboxBox = document.createElement("div");
  inboxBox.style.marginTop = "10px";
  inboxBox.innerHTML = `<div style="font-weight:600;">本周通知</div>`;
  const msgs = ar.inbox && ar.inbox.length ? ar.inbox.slice() : ["暂无新通知"];
  msgs.forEach(m => {
    const div = document.createElement("div");
    div.className = "muted";
    div.textContent = m;
    inboxBox.appendChild(div);
  });
  panel.appendChild(inboxBox);
  ar.inbox = [];

  const actions = getJobCenterActions();
  const actWrap = document.createElement("div");
  actWrap.style.marginTop = "12px";
  actWrap.innerHTML = `<div style="margin-bottom:6px;font-weight:600;">本周可做的就业动作（消耗行动次数）</div>`;
  if (!actions.length) {
    const none = document.createElement("div");
    none.className = "muted";
    none.textContent = "暂无可执行的就业动作";
    actWrap.appendChild(none);
  } else {
    actions.forEach(a => {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.style.display = "block";
      btn.style.width = "100%";
      btn.style.marginBottom = "8px";
      btn.textContent = a.name || a.id;
      const noEnergyExceptRest = state.energy <= 0;
      btn.disabled = state.actionsLeft <= 0 || noEnergyExceptRest;
      if (noEnergyExceptRest) btn.title = "精力值为0，只能选择休息";
      btn.addEventListener("click", () => {
        if (state.actionsLeft <= 0) { logLine("本周行动已用完"); return; }
        if (state.energy <= 0) { logLine("精力值为0，只能选择休息"); return; }
        handleAutumnAction(a);
        closeJobCenterModal();
        if (state.actionsLeft <= 0 && !state.eventPending) nextWeek();
        else render();
      });
      actWrap.appendChild(btn);
    });
  }
  panel.appendChild(actWrap);

  const now = autumnAbsWeek();
  const pendingInterview = ar.queue.filter(a => a.type === "interview_ready" && a.dueWeek <= now).map(a => a.company);
  const status = document.createElement("div");
  status.style.marginTop = "12px";
  status.innerHTML = `
    <div style="margin-bottom:6px;font-weight:600;">进度</div>
    <div class="muted">简历度：${ar.resume} / 准备度：${ar.prep}</div>
    <div class="muted">待安排面试：${pendingInterview.join("、") || "无"}</div>
    <div class="muted">Offer：${(ar.offers || []).map(o => o.name).join("、") || "暂无"}</div>
  `;
  panel.appendChild(status);

  modal.innerHTML = "";
  modal.appendChild(panel);
  modal.style.display = "flex";

  const closeBtn = panel.querySelector("#jobCenterClose");
  if (closeBtn) closeBtn.addEventListener("click", closeJobCenterModal);
}

function closeJobCenterModal() {
  const modal = document.getElementById("jobCenterModal");
  if (modal) modal.style.display = "none";
}

function handleAutumnAction(action) {
  ensureAutumnEnabledIfNeeded();
  const ar = state.branches.autumnRecruit;
  if (!ar) return;
  if (state.actionsLeft <= 0) { logLine("本周行动已用完"); return; }

  const now = autumnAbsWeek();
  if (action.id === "resume_opt") {
    state.actionsLeft -= 1;
    ar.resume += 4;
    applyEffects({ stress: +5, energy: -10 });
    logLine("【就业】你打磨了简历，简历度+4");
  } else if (action.id === "prep_practice") {
    state.actionsLeft -= 1;
    ar.prep += 4;
    applyEffects({ stress: +10, energy: -10 });
    logLine("【就业】刷题/面经，提高准备度+4");
  } else if (action.id === "submit_app") {
    resetAutumnWeeklySubmit(ar, now);
    if ((ar.submitCount || 0) > 0) { logLine("【就业】本周已投递过（每周一次，最多 3 家）"); return; }

    const suggested = AUTUMN_COMPANY_POOL.slice().sort(() => Math.random() - 0.5).slice(0, 6);
    openCompanyPickModal({
      suggested,
      maxPick: 3,
      onConfirm: (picked) => {
        if (!picked || !picked.length) return;
        state.actionsLeft = Math.max(0, (state.actionsLeft || 0) - 1);
        ar.submitCount = 0;
        picked.slice(0, 3).forEach((company) => {
          ar.queue.push({ id: `job_${now}_${Math.random().toString(36).slice(2, 6)}`, company, type: "screen", dueWeek: now + randi(1, 2) });
          logLine(`【就业】已投递：${company}（简历度 ${ar.resume} / 准备度 ${ar.prep}，预计 1-2 周出筛选结果）`);
          ar.submitCount = (ar.submitCount || 0) + 1;
        });
        jobNotify(`本周已投递 ${ar.submitCount} 家（上限 3），筛选结果将陆续公布。`);
        render();
      }
    });

  } else if (action.id === "attend_interview_ready") {
    const target = ar.queue.find(a => a.type === "interview_ready" && a.dueWeek <= now);
    if (!target) { logLine("【就业】本周没有待参加的面试"); return; }
    state.actionsLeft -= 1;
    ar.queue = ar.queue.filter(a => a !== target);
    ar.queue.push({ id: `${target.id}_res`, company: target.company, type: "interview_result", dueWeek: now + 1, stage: target.stage });
    logLine(`【就业】已参加面试：${target.company}（结果下周公布）`);
  }
}

/* ========== 考研中心 ========== */
function isKaoyanCenterTime() {
  const termIdx = getCurrentTermIndex();
  if (termIdx < 7) return false;
  if (termIdx === 7) return true;
  if (termIdx === 8) return state.week <= 8;
  return false;
}

function initKaoyanState(ky) {
  if (!ky) return;
  ky.flags = ky.flags || {};
  ky.queue = ky.queue || [];
  ky.inbox = ky.inbox || [];
  if (ky.major == null && ky.knowledge != null) ky.major = ky.knowledge;
  ky.english = ky.english ?? 0;
  ky.politics = ky.politics ?? 0;
  ky.major = ky.major ?? 0;
  ky.math = ky.math ?? 0;
  ky.stability = ky.stability ?? 50;
  ky.burnout = Number(state.stress || 0);
  ky.interview = ky.interview ?? 0;
  if (ky.hasMath == null) {
    const aca = state.academyNormalized || "";
    ky.hasMath = !(aca === "medicine" || aca === "arts");
  }
  ky.stage = ky.stage || "prep";
}

function kyEff(x) {
  const v = Number(x || 0);
  if (v <= 80) return v;
  return 80 + (v - 80) * 0.3;
}

function calcKaoyanPrep(ky) {
  const e = kyEff(ky.english);
  const p = kyEff(ky.politics);
  const m = kyEff(ky.major);
  const ma = kyEff(ky.math);
  if (ky.hasMath) {
    return 0.28 * ma + 0.26 * m + 0.24 * e + 0.22 * p;
  }
  return 0.38 * m + 0.32 * e + 0.30 * p;
}

function calcKaoyanPrepEff(ky) {
  const prep = calcKaoyanPrep(ky);
  return prep + 0.12 * ky.stability - 0.18 * Number(state.stress || 0);
}

function calcKaoyanLuck() {
  const base = 1 + 4 * (Number(state.social || 0) / 100);
  const rand = (Math.random() * 3) - 1.5;
  return clamp(base + rand, 0, 6);
}

function getKaoyanTier(ky) {
  const u = getPgUnivById(ky.univId);
  return u?.tier || 3;
}

function getKaoyanLineTh(ky) {
  const tier = getKaoyanTier(ky);
  const base = getPgTierThreshold("campOfferBase", tier, 70);
  return base + 8;
}

function getKaoyanRetestTh(ky) {
  const tier = getKaoyanTier(ky);
  return getPgTierThreshold("campOfferBase", tier, 70);
}

function openKaoyanUnivSelect(ky) {
  const nameMap = new Map();
  const names = getPgUnivPool().map(u => {
    const label = `${u.name}（T${u.tier}）`;
    nameMap.set(label, u.id);
    return label;
  });
  openCompanyPickModal({
    suggested: names,
    maxPick: 1,
    title: "选择报考院校",
    unit: "所",
    confirmText: "确认",
    onConfirm: (pickedNames) => {
      if (!pickedNames || pickedNames.length === 0) return;
      const id = nameMap.get(pickedNames[0]) || pickedNames[0];
      ky.univId = id;
      ky.flags.univLocked = true;
      logLine(`【考研】报考院校已选择：${getPgUnivById(id)?.name || id}`);
      closeKaoyanCenterModal();
      openKaoyanCenterModal();
      render();
    }
  });
}

function openKaoyanGiveUpModal() {
  openEventModal({
    id: "KY_GIVEUP",
    title: "放弃考研",
    text: "你决定放弃考研，转向其他路线。",
    options: [
      { text: "转就业", onSelect() { setRouteChoice("qiuzhao"); } },
      { text: "转出国", onSelect() { setRouteChoice("abroad"); } },
      { text: "转考公考编", onSelect() { setRouteChoice("gongkao"); } },
      { text: "取消", onSelect() {} }
    ]
  });
}

function ensureKaoyanEnabledIfNeeded() {
  if (getActiveRoute() !== "kaoyan") return;
  state.branches = state.branches || {};
  const ky = state.branches.kaoyan || (state.branches.kaoyan = { enabled: false, queue: [], inbox: [], flags: {} });
  initKaoyanState(ky);
  if (!ky.enabled && isKaoyanCenterTime()) {
    ky.enabled = true;
    ky.inbox.push("考研中心开启：从第7学期第1周起可行动。");
  }
  if (ky.enabled && !isKaoyanCenterTime()) ky.enabled = false;
}

function tickKaoyan() {
  if (getActiveRoute() !== "kaoyan") return;
  ensureKaoyanEnabledIfNeeded();
  const ky = state.branches?.kaoyan;
  if (!ky) return;

  const termIdx = getCurrentTermIndex();
  if (!ky.enabled && !(termIdx === 8 && state.week <= 9)) return;
  ky.burnout = Number(state.stress || 0);
  const now = absWeekIndex();

  // mock queue
  const nextQueue = [];
  for (const item of ky.queue) {
    if (item.dueWeek > now) { nextQueue.push(item); continue; }
    if (item.type === "ky_mock") {
      const base = calcKaoyanPrepEff(ky);
      const score = base + calcKaoyanLuck() + randi(-4, 4);
      const lineTh = getKaoyanLineTh(ky);
      const msg = `【考研】真题/套卷反馈：${Math.round(score)}（线 ${lineTh}）`;
      ky.inbox.push(msg);
      if (score >= lineTh) ky.stability = clamp(ky.stability + 2, 0, 100);
      else ky.stability = clamp(ky.stability - 2, 0, 100);
    } else {
      nextQueue.push(item);
    }
  }
  ky.queue = nextQueue;

  // term7 exam week prompt (week15)
  if (termIdx === 7 && state.week === 15 && !ky.flags.examPrompted) {
    ky.flags.examPrompted = true;
    ky.flags.examLocked = true;
    openEventModal({
      id: "KY_EXAM_WEEK",
      title: "考研初试周",
      text: "本周为考研初试考试周，是否参加考试？",
      options: [
        { text: "参加考试", onSelect() { ky.flags.examTaken = true; } },
        {
          text: "不参加（转路线）",
          onSelect() {
            ky.flags.examAbsent = true;
            ky.stage = "fail";
            openEventModal({
              id: "KY_EXAM_ABSENT_ROUTE",
              title: "放弃考研",
              text: "你放弃了考研初试，是否转向其他路线？",
              options: [
                { text: "转就业", onSelect() { setRouteChoice("qiuzhao"); } },
                { text: "转出国", onSelect() { setRouteChoice("abroad"); } },
                { text: "转考公考编", onSelect() { setRouteChoice("gongkao"); } }
              ]
            });
          }
        }
      ]
    });
  }

  // term8 week1 score release
  if (termIdx === 8 && state.week === 1 && !ky.flags.scoreReleased) {
    ky.flags.scoreReleased = true;
    const univName = getPgUnivById(ky.univId)?.name || "未选择院校";
    if (ky.flags.examAbsent) {
      ky.stage = "fail";
      openEventModal({
        id: "KY_EXAM_ABSENT_FAIL",
        title: "初试未参加",
        text: "你未参加初试，考研失败。",
        options: [
          { text: "转就业", onSelect() { setRouteChoice("qiuzhao"); } },
          { text: "转出国", onSelect() { setRouteChoice("abroad"); } },
          { text: "转考公考编", onSelect() { setRouteChoice("gongkao"); } }
        ]
      });
    } else {
      const prepEff = calcKaoyanPrepEff(ky);
      const lineTh = getKaoyanLineTh(ky);
      const score = prepEff + calcKaoyanLuck() + randi(-8, 8);
      const pass = score >= lineTh;
      ky.stage = pass ? "retest" : "fail";
      ky.inbox.push(`【考研】初试成绩公布：${Math.round(score)}；${univName} 复试线：${lineTh} → ${pass ? "通过" : "未通过"}`);
      openEventModal({
        id: "KY_SCORE_RELEASE",
        title: "初试成绩公布",
        text: `成绩：${Math.round(score)}；复试线：${lineTh} → ${pass ? "通过" : "未通过"}`,
        options: pass ? [{ text: "进入复试", onSelect() {} }] : [
          { text: "转就业", onSelect() { setRouteChoice("qiuzhao"); } },
          { text: "转出国", onSelect() { setRouteChoice("abroad"); } },
          { text: "转考公考编", onSelect() { setRouteChoice("gongkao"); } }
        ]
      });
    }
  }

  // retest reminders
  if (termIdx === 8 && ky.stage === "retest") {
    ky.flags.retestNoted = ky.flags.retestNoted || {};
    if (!ky.flags.retestNoted[state.week]) {
      const tips = {
        1: "进入复试准备：重点面试/英语/专业。",
        4: "复试中期：本周建议至少做一次面试训练。",
        8: "复试结算周：注意心态与稳定性。"
      };
      if (tips[state.week]) ky.inbox.push(`【考研】${tips[state.week]}`);
      ky.flags.retestNoted[state.week] = true;
    }
  }

  // term8 week8 retest result
  if (termIdx === 8 && state.week === 8 && ky.stage === "retest" && !ky.flags.retestDone) {
    ky.flags.retestDone = true;
    const luck = calcKaoyanLuck() + randi(-6, 6);
    const score = 0.40 * ky.interview + 0.30 * kyEff(ky.major) + 0.20 * kyEff(ky.english) + 0.10 * ky.stability + luck;
    const th = getKaoyanRetestTh(ky);
    ky.result = score >= th ? "pass" : "fail";
    ky.inbox.push(`【考研】复试结算：${Math.round(score)}（线 ${th}）→ ${ky.result === "pass" ? "通过" : "未通过"}`);
  }

  // term8 week9 final result
  if (termIdx === 8 && state.week === 9 && ky.flags.retestDone && !ky.flags.finalAnnounced) {
    ky.flags.finalAnnounced = true;
    const univName = getPgUnivById(ky.univId)?.name || "目标院校";
    if (ky.result === "pass") {
      openEventModal({
        id: "KY_PASS",
        title: "拟录取",
        text: `【拟录取】${univName} 复试通过 → Offer 到手`,
        options: [{ text: "太棒了！", onSelect() {} }]
      });
      applyEffects({ mood: +10, stress: -8 });
      addOffer({ kind: "postgrad", status: "admit", name: univName, source: "kaoyan" });
      state.outcomes = state.outcomes || {};
      state.outcomes.postgrad = "pass";
    } else {
      openEventModal({
        id: "KY_FAIL_FINAL",
        title: "复试未通过",
        text: "是否转向其他路线？",
        options: [
          { text: "转就业", onSelect() { setRouteChoice("qiuzhao"); } },
          { text: "转出国", onSelect() { setRouteChoice("abroad"); } },
          { text: "转考公考编", onSelect() { setRouteChoice("gongkao"); } }
        ]
      });
      state.outcomes = state.outcomes || {};
      state.outcomes.postgrad = "fail";
    }
  }
}

function kaoyanCenterAvailable() {
  ensureKaoyanEnabledIfNeeded();
  const ky = state.branches?.kaoyan;
  return !!(ky && ky.enabled && getActiveRoute() === "kaoyan" && isKaoyanCenterTime());
}

function getKaoyanActions() {
  const list = [];
  const ky = state.branches?.kaoyan;
  if (!ky) return list;
  const termIdx = getCurrentTermIndex();
  const inRetest = (termIdx === 8 && ky.stage === "retest");
  if (!inRetest) {
    list.push({ id: "ky_eng", name: "刷英语" });
    list.push({ id: "ky_pol", name: "刷政治" });
    list.push({ id: "ky_major", name: "刷专业课" });
    if (ky.hasMath) list.push({ id: "ky_math", name: "刷数学" });
    list.push({ id: "ky_mock", name: "真题/套卷" });
    list.push({ id: "ky_adjust", name: "调整状态" });
  } else {
    list.push({ id: "ky_re_eng", name: "英语复试训练" });
    list.push({ id: "ky_re_interview", name: "面试训练" });
    list.push({ id: "ky_re_major", name: "专业课深挖" });
    list.push({ id: "ky_re_contact", name: "材料整理/联系导师" });
    list.push({ id: "ky_adjust", name: "调整状态" });
  }
  return list.slice(0, 4);
}

function ensureKaoyanCenterButton() {
  const host = ui.actionPanel?.parentElement || document.body;
  let btn = document.getElementById("btnKaoyanCenter");
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "btnKaoyanCenter";
    btn.className = "btn";
    btn.style.marginLeft = "8px";
    btn.textContent = "考研中心";
    btn.addEventListener("click", openKaoyanCenterModal);
    if (host && host.insertBefore) host.insertBefore(btn, host.firstChild);
    else document.body.appendChild(btn);
  }
  const show = kaoyanCenterAvailable();
  btn.style.display = show ? "inline-block" : "none";
  btn.disabled = state.actionsLeft <= 0;
}

function openKaoyanCenterModal() {
  ensureKaoyanEnabledIfNeeded();
  const ky = state.branches?.kaoyan;
  if (!ky || !ky.enabled) return;
  let modal = document.getElementById("kaoyanCenterModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "kaoyanCenterModal";
    Object.assign(modal.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(0,0,0,0.45)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: "9999"
    });
    modal.addEventListener("click", (e) => { if (e.target === modal) closeKaoyanCenterModal(); });
    document.body.appendChild(modal);
  }

  const panel = document.createElement("div");
  Object.assign(panel.style, {
    background: "#111827",
    color: "#e5e7eb",
    minWidth: "360px",
    maxWidth: "520px",
    padding: "18px",
    borderRadius: "10px",
    boxShadow: "0 10px 30px rgba(0,0,0,0.35)"
  });

  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.justifyContent = "space-between";
  header.style.alignItems = "center";
  header.innerHTML = `<div style="font-size:18px;font-weight:700;">考研中心</div><button class="btn" id="kyClose">关闭</button>`;
  panel.appendChild(header);

  const univ = ky.univId ? getPgUnivById(ky.univId) : null;
  const tier = univ?.tier || "-";
  const stageLabel = (getCurrentTermIndex() === 8 && ky.stage === "retest") ? "复试模式" : "初试模式";
  const info = document.createElement("div");
  info.className = "muted";
  info.style.marginTop = "6px";
  info.textContent = `目标院校：${univ?.name || "未选择"}（T${tier}） · ${stageLabel}`;
  panel.appendChild(info);

  if (!ky.univId) {
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.style.marginTop = "8px";
    btn.textContent = "选择报考院校";
    btn.addEventListener("click", () => openKaoyanUnivSelect(ky));
    panel.appendChild(btn);
  }

  const inboxBox = document.createElement("div");
  inboxBox.style.marginTop = "10px";
  inboxBox.innerHTML = `<div style="font-weight:600;">本周通知</div>`;
  const msgs = ky.inbox && ky.inbox.length ? ky.inbox.slice() : ["暂无新通知"];
  msgs.forEach(m => {
    const div = document.createElement("div");
    div.className = "muted";
    div.textContent = m;
    inboxBox.appendChild(div);
  });
  panel.appendChild(inboxBox);
  ky.inbox = [];

  const actions = getKaoyanActions();
  const actWrap = document.createElement("div");
  actWrap.style.marginTop = "12px";
  actWrap.innerHTML = `<div style="margin-bottom:6px;font-weight:600;">本周可做的考研动作（消耗行动次数）</div>`;
  const examWeek = (getCurrentTermIndex() === 7 && state.week === 15);
  if (examWeek && ky.flags?.examLocked) {
    const tip = document.createElement("div");
    tip.className = "muted";
    tip.textContent = "本周为初试周，考研行动已锁定。";
    actWrap.appendChild(tip);
  } else {
    actions.forEach(a => {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.style.display = "block";
      btn.style.width = "100%";
      btn.style.marginBottom = "8px";
      btn.textContent = a.name || a.id;
      const noEnergyExceptRest = state.energy <= 0;
      btn.disabled = state.actionsLeft <= 0 || !ky.univId || noEnergyExceptRest;
      if (noEnergyExceptRest) btn.title = "精力值为0，只能选择休息";
      btn.addEventListener("click", () => {
        if (state.actionsLeft <= 0) { logLine("本周行动已用完"); return; }
        if (state.energy <= 0) { logLine("精力值为0，只能选择休息"); return; }
        handleKaoyanAction(a);
        closeKaoyanCenterModal();
        if (state.actionsLeft <= 0 && !state.eventPending) nextWeek();
        else render();
      });
      actWrap.appendChild(btn);
    });
  }
  panel.appendChild(actWrap);

  const status = document.createElement("div");
  status.style.marginTop = "12px";
  const termIdx = getCurrentTermIndex();
  if (termIdx === 8 && ky.stage === "retest") {
    status.innerHTML = `
      <div style="margin-bottom:6px;font-weight:600;">进度</div>
      <div class="muted">英语：${ky.english} / 专业：${ky.major} / 面试：${ky.interview}</div>
      <div class="muted">稳定性：${ky.stability} / 压力：${Number(state.stress || 0)}</div>
    `;
  } else {
    const mathLine = ky.hasMath ? ` / 数学：${ky.math}` : "";
    status.innerHTML = `
      <div style="margin-bottom:6px;font-weight:600;">进度</div>
      <div class="muted">英语：${ky.english} / 政治：${ky.politics} / 专业：${ky.major}${mathLine}</div>
      <div class="muted">稳定性：${ky.stability} / 压力：${Number(state.stress || 0)}</div>
    `;
  }
  panel.appendChild(status);

  const giveUpBtn = document.createElement("button");
  giveUpBtn.className = "btn";
  giveUpBtn.style.marginTop = "10px";
  giveUpBtn.textContent = "放弃考研";
  giveUpBtn.addEventListener("click", openKaoyanGiveUpModal);
  panel.appendChild(giveUpBtn);

  modal.innerHTML = "";
  modal.appendChild(panel);
  modal.style.display = "flex";

  const closeBtn = panel.querySelector("#kyClose");
  if (closeBtn) closeBtn.addEventListener("click", closeKaoyanCenterModal);
}

function closeKaoyanCenterModal() {
  const modal = document.getElementById("kaoyanCenterModal");
  if (modal) modal.style.display = "none";
}

function handleKaoyanAction(action) {
  ensureKaoyanEnabledIfNeeded();
  const ky = state.branches.kaoyan;
  if (!ky) return;
  if (!ky.univId) { logLine("【考研】请先选择报考院校。"); return; }
  if (state.actionsLeft <= 0) { logLine("本周行动已用完"); return; }
  const termIdx = getCurrentTermIndex();
  const examWeek = (termIdx === 7 && state.week === 15);
  if (examWeek && ky.flags?.examLocked) {
    logLine("【考研】本周为初试周，已结束本周考研行动。");
    return;
  }
  const mult = 1.0;

  if (action.id === "ky_eng") {
    state.actionsLeft -= 1;
    ky.english = clamp(ky.english + Math.round(randi(8, 12) * mult), 0, 100);
    applyEffects({ stress: +5, energy: -6 });
    logLine("【考研】英语提升。");
  } else if (action.id === "ky_pol") {
    state.actionsLeft -= 1;
    ky.politics = clamp(ky.politics + Math.round(randi(8, 12) * mult), 0, 100);
    applyEffects({ stress: +5, energy: -6 });
    logLine("【考研】政治提升。");
  } else if (action.id === "ky_major") {
    state.actionsLeft -= 1;
    ky.major = clamp(ky.major + Math.round(randi(9, 13) * mult), 0, 100);
    applyEffects({ stress: +6, energy: -6 });
    logLine("【考研】专业课提升。");
  } else if (action.id === "ky_math") {
    state.actionsLeft -= 1;
    ky.math = clamp(ky.math + Math.round(randi(9, 13) * mult), 0, 100);
    applyEffects({ stress: +6, energy: -6 });
    logLine("【考研】数学提升。");
  } else if (action.id === "ky_mock") {
    state.actionsLeft -= 1;
    ky.stability = clamp(ky.stability + 6, 0, 100);
    applyEffects({ stress: +4, energy: -4 });
    ky.queue.push({ type: "ky_mock", dueWeek: absWeekIndex() + 1 });
    logLine("【考研】真题/套卷完成，下周出反馈。");
  } else if (action.id === "ky_adjust") {
    state.actionsLeft -= 1;
    applyEffects({ stress: -6, mood: +4 });
    logLine("【考研】调整状态，压力下降。");
  } else if (action.id === "ky_re_eng") {
    state.actionsLeft -= 1;
    ky.english = clamp(ky.english + randi(6, 10), 0, 100);
    ky.stability = clamp(ky.stability + 2, 0, 100);
    applyEffects({ stress: +4, energy: -6 });
    logLine("【考研】英语复试训练。");
  } else if (action.id === "ky_re_interview") {
    state.actionsLeft -= 1;
    ky.interview = clamp(ky.interview + randi(8, 12), 0, 100);
    ky.stability = clamp(ky.stability + 4, 0, 100);
    applyEffects({ stress: +5, energy: -6 });
    logLine("【考研】面试训练。");
  } else if (action.id === "ky_re_major") {
    state.actionsLeft -= 1;
    ky.major = clamp(ky.major + randi(7, 11), 0, 100);
    applyEffects({ stress: +5, energy: -6 });
    logLine("【考研】专业课深挖。");
  } else if (action.id === "ky_re_contact") {
    state.actionsLeft -= 1;
    ky.stability = clamp(ky.stability + 6, 0, 100);
    applyEffects({ stress: +2, energy: -3 });
    if (Math.random() < 0.2) {
      ky.stability = clamp(ky.stability + 3, 0, 100);
      ky.inbox.push("【考研】导师印象加成。");
    }
    logLine("【考研】材料整理/联系导师。");
  }
}

/* ========== 出国中心（超级版） ========== */
const ABROAD_MAX_TARGETS = 5;
const ABROAD_TARGET_FEE = 200;

function isAbroadCenterTime() {
  const termIdx = getCurrentTermIndex();
  if (termIdx < 7) return false;
  if (termIdx === 7) return true;
  if (termIdx === 8) return state.week <= 9;
  return false;
}

function getAbroadPool() {
  if (typeof UNIV_ABROAD_60 !== "undefined" && Array.isArray(UNIV_ABROAD_60) && UNIV_ABROAD_60.length) return UNIV_ABROAD_60;
  if (typeof UNIV_38 !== "undefined" && Array.isArray(UNIV_38) && UNIV_38.length) return UNIV_38;
  return [];
}

function getAbroadUnivById(id) {
  return getAbroadPool().find(u => u.id === id);
}

function getAbroadStatusText(status) {
  const map = {
    planned: "已选",
    submitted: "已投递",
    invite: "面试邀请",
    offer: "录取",
    reject: "拒信"
  };
  return map[status] || "未投";
}

function initAbroadState(ab) {
  if (!ab) return;
  ab.targets = ab.targets || [];
  ab.app = ab.app || {};
  ab.material = ab.material ?? ab.materials ?? 0;
  ab.materials = ab.material;
  ab.language = ab.language ?? 0;
  ab.research = ab.research ?? 0;
  ab.contact = ab.contact ?? 0;
  ab.interview = ab.interview ?? 0;
  ab.submittedCount = ab.submittedCount || 0;
  ab.inbox = ab.inbox || [];
  ab.flags = ab.flags || {};
  ab.offers = ab.offers || [];
}

function calcAbroadGpaBonus() {
  const gpa = calcCumulativeGPA();
  if (gpa >= 4.5) return 20;
  if (gpa >= 4.0) return 10;
  if (gpa >= 3.9) return 8;
  if (gpa >= 3.8) return 7;
  return 0;
}

function calcAbroadEngBonus() {
  const cet6 = Number(state.certs?.cet6?.score || 0);
  if (cet6 >= 700) return 20;
  if (cet6 >= 600) return 10;
  if (cet6 >= 550) return 5;
  if (cet6 >= 500) return 3;
  return 0;
}

function calcAbroadSciBonus() {
  const sciCount = Number(state.milestones?.sci || 0);
  return Math.min(15, sciCount * 5);
}

function calcAbroadProfileBonus() {
  const gpaBonus = calcAbroadGpaBonus();
  const engBonus = calcAbroadEngBonus();
  const sciBonus = calcAbroadSciBonus();
  return 0.45 * gpaBonus + 0.35 * engBonus + 0.20 * sciBonus;
}

function calcAbroadStressPenalty() {
  const stress = Number(state.stress || 0);
  if (stress >= 70) return 6;
  if (stress >= 50) return 3;
  return 0;
}

function calcAbroadSpreadPenalty(ab) {
  const k = (ab.targets || []).length;
  return Math.max(0, (k - 1) * 1.5);
}

function calcAbroadLuck() {
  const base = 1 + 4 * (Number(state.social || 0) / 100);
  const rand = (Math.random() * 3) - 1.5;
  return clamp(base + rand, 0, 6);
}

function ensureAbroadEnabledIfNeeded() {
  if (getActiveRoute() !== "abroad") return;
  state.branches = state.branches || {};
  const ab = state.branches.abroad || (state.branches.abroad = { enabled: false });
  initAbroadState(ab);
  if (!ab.enabled && isAbroadCenterTime()) {
    ab.enabled = true;
    ab.inbox.push("出国中心开启：最多选5个目标，每选一所扣200。");
  }
  if (ab.enabled && !isAbroadCenterTime()) ab.enabled = false;
}

function runAbroadInviteRound(ab, label) {
  const profileBonus = calcAbroadProfileBonus();
  const stressPenalty = calcAbroadStressPenalty();
  const spreadPenalty = calcAbroadSpreadPenalty(ab);
  for (const id of (ab.targets || [])) {
    const app = ab.app[id] || (ab.app[id] = { status: "planned" });
    if (app.status !== "submitted") continue;
    const univ = getAbroadUnivById(id);
    const tier = univ?.tier || 3;
    const inviteTh = getPgTierThreshold("campInvite", tier, 70);
    const score = 0.30 * ab.material + 0.20 * ab.language + 0.25 * ab.research + 0.15 * ab.contact + 0.10 * profileBonus
      + calcAbroadLuck() + randi(-6, 6) - stressPenalty - spreadPenalty;
    if (score >= inviteTh) {
      app.status = "invite";
      ab.inbox.push(`【出国】${label}：${univ?.name || id} 获得面试邀请。`);
    }
  }
}

function runAbroadFinalReview(ab) {
  const profileBonus = calcAbroadProfileBonus();
  const stressPenalty = calcAbroadStressPenalty();
  const spreadPenalty = calcAbroadSpreadPenalty(ab);
  for (const id of (ab.targets || [])) {
    const app = ab.app[id] || (ab.app[id] = { status: "planned" });
    const univ = getAbroadUnivById(id);
    const tier = univ?.tier || 3;
    const offerTh = getPgTierThreshold("campOfferBase", tier, 70) + 6;
    if (app.status === "invite") {
      const score = 0.18 * ab.material + 0.18 * ab.language + 0.20 * ab.research + 0.12 * ab.contact + 0.20 * ab.interview + 0.12 * profileBonus
        + calcAbroadLuck() + randi(-6, 6) - stressPenalty - spreadPenalty;
      if (score >= offerTh) {
        app.status = "offer";
        const offerName = univ?.name || id;
        ab.offers.push({ name: offerName, tier: `T${tier}` });
        addOffer({ kind: "overseas", status: "admit", tier: `T${tier}`, name: offerName, source: "abroad" });
      } else {
        app.status = "reject";
      }
    } else if (app.status === "submitted") {
      app.status = "reject";
    }
  }
}

function tickAbroad() {
  if (getActiveRoute() !== "abroad") return;
  ensureAbroadEnabledIfNeeded();
  const ab = state.branches?.abroad;
  if (!ab || (!ab.enabled && !isAbroadCenterTime())) return;
  const termIdx = getCurrentTermIndex();
  const week = state.week;

  ab.flags.notedWeeks = ab.flags.notedWeeks || {};
  const note = (w, text) => {
    if (ab.flags.notedWeeks[w]) return;
    ab.flags.notedWeeks[w] = true;
    ab.inbox.push(text);
  };

  if (termIdx === 7) {
    if (week === 1) note("t7w1", "【出国】开启：最多选5个目标，每个-200。");
    if (week === 6) note("t7w6", "【出国】推荐信/套磁关键期。");
    if (week === 10) note("t7w10", "【出国】材料成稿提醒（建议材料≥70）。");
  }

  if (termIdx === 8) {
    if (week === 1 && !ab.flags.submitSeason) {
      ab.flags.submitSeason = true;
      ab.inbox.push("【出国】进入投递季：请在出国中心选择并投递目标。");
    }
    if (week === 2 && !ab.flags.inviteRound1) {
      ab.flags.inviteRound1 = true;
      runAbroadInviteRound(ab, "第一轮邀请");
      ab.inbox.push("【出国】第一轮面试邀请判定完成。");
    }
    if (week === 4 && !ab.flags.inviteRound2) {
      ab.flags.inviteRound2 = true;
      runAbroadInviteRound(ab, "第二轮邀请");
      ab.inbox.push("【出国】第二轮面试邀请判定完成。");
    }
    if (week === 9 && !ab.flags.finalReviewed) {
      ab.flags.finalReviewed = true;
      runAbroadFinalReview(ab);
      ab.inbox.push("【出国】最终评审完成。");
    }
    if (week === 10 && !ab.flags.resultAnnounced) {
      ab.flags.resultAnnounced = true;
      const offers = (ab.offers || []);
      if (offers.length > 0) {
        const offerNames = offers.map(o => o.name);
        const confirmOffer = (chosen) => {
          if (chosen) chooseOverseasOffer(chosen);
          openEventModal({
            id: "AB_RESULT",
            title: "出国结果",
            text: `获得录取：${chosen || offerNames.join(" / ")}`,
            options: [{ text: "知道了", onSelect() {} }]
          });
        };
        if (offerNames.length >= 2) {
          openCompanyPickModal({
            suggested: offerNames,
            maxPick: 1,
            title: "请选择最终去向",
            unit: "所",
            confirmText: "确认去向",
            onConfirm: (picked) => {
              const name = (picked && picked[0]) ? picked[0] : offerNames[0];
              confirmOffer(name);
            }
          });
        } else {
          confirmOffer(offerNames[0]);
        }
        state.outcomes = state.outcomes || {};
        state.outcomes.overseas = "admit";
      } else {
        openEventModal({
          id: "AB_FAIL",
          title: "出国失败",
          text: "未获得录取，是否转向其他路线？",
          options: [
            { text: "转就业", onSelect() { setRouteChoice("qiuzhao"); } },
            { text: "转考公考编", onSelect() { setRouteChoice("gongkao"); } },
            { text: "转考研", onSelect() { setRouteChoice("kaoyan"); } }
          ]
        });
        state.outcomes = state.outcomes || {};
        state.outcomes.overseas = "fail";
      }
    }
  }
}

function abroadCenterAvailable() {
  ensureAbroadEnabledIfNeeded();
  const ab = state.branches?.abroad;
  return !!(ab && ab.enabled && getActiveRoute() === "abroad" && isAbroadCenterTime());
}

function ensureAbroadCenterButton() {
  const host = ui.actionPanel?.parentElement || document.body;
  let btn = document.getElementById("btnAbroadCenter");
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "btnAbroadCenter";
    btn.className = "btn";
    btn.style.marginLeft = "8px";
    btn.textContent = "出国中心";
    btn.addEventListener("click", openAbroadCenterModal);
    if (host && host.insertBefore) host.insertBefore(btn, host.firstChild);
    else document.body.appendChild(btn);
  }
  const show = abroadCenterAvailable();
  btn.style.display = show ? "inline-block" : "none";
  const noEnergy = state.energy <= 0;
  btn.disabled = state.actionsLeft <= 0 || noEnergy;
  btn.title = state.actionsLeft <= 0 ? "本周行动已用完" : (noEnergy ? "精力值为0，只能选择休息" : "");
}

function openAbroadCenterModal() {
  ensureAbroadEnabledIfNeeded();
  const ab = state.branches?.abroad;
  if (!ab || !ab.enabled) return;
  let modal = document.getElementById("abroadCenterModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "abroadCenterModal";
    Object.assign(modal.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(0,0,0,0.45)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: "9999"
    });
    modal.addEventListener("click", (e) => { if (e.target === modal) closeAbroadCenterModal(); });
    document.body.appendChild(modal);
  }

  const panel = document.createElement("div");
  Object.assign(panel.style, {
    background: "#111827",
    color: "#e5e7eb",
    minWidth: "360px",
    maxWidth: "520px",
    padding: "18px",
    borderRadius: "10px",
    boxShadow: "0 10px 30px rgba(0,0,0,0.35)"
  });

  const header = document.createElement("div");
  header.style.fontSize = "18px";
  header.style.fontWeight = "700";
  header.textContent = "出国中心";
  panel.appendChild(header);

  const hint = document.createElement("div");
  hint.className = "muted";
  hint.style.marginTop = "6px";
  const stressPenalty = calcAbroadStressPenalty();
  hint.textContent = `压力过高会影响面试/邀请（惩罚-${stressPenalty}）。`;
  panel.appendChild(hint);

  const inbox = document.createElement("div");
  inbox.style.marginTop = "10px";
  inbox.innerHTML = `<div style="font-weight:600;">本周通知</div>`;
  const msgs = ab.inbox && ab.inbox.length ? ab.inbox.slice() : ["暂无新通知"];
  msgs.forEach(m => {
    const div = document.createElement("div");
    div.className = "muted";
    div.textContent = m;
    inbox.appendChild(div);
  });
  panel.appendChild(inbox);
  ab.inbox = [];

  const termIdx = getCurrentTermIndex();
  const targetLine = document.createElement("div");
  targetLine.className = "muted";
  targetLine.style.marginTop = "8px";
  const targetNames = (ab.targets || []).map(id => {
    const u = getAbroadUnivById(id);
    const status = getAbroadStatusText(ab.app[id]?.status);
    return `${u?.name || id}·${status}`;
  });
  if (termIdx === 7) {
    targetLine.textContent = "目标（投递季选择）：未选择";
  } else {
    targetLine.textContent = `目标（${(ab.targets || []).length}/${ABROAD_MAX_TARGETS}）：${targetNames.join(" / ") || "未选择"}`;
  }
  panel.appendChild(targetLine);

  const actions = [];
  if (termIdx === 7) {
    actions.push({ id: "ab_material", name: "打磨材料" });
    actions.push({ id: "ab_language", name: "刷语言" });
    actions.push({ id: "ab_research", name: "科研推进" });
    actions.push({ id: "ab_contact", name: "套磁/推荐信" });
  } else {
    actions.push({ id: "ab_submit", name: "投递目标" });
    actions.push({ id: "ab_interview", name: "面试训练" });
    actions.push({ id: "ab_language", name: "口语表达/写作" });
    actions.push({ id: "ab_material", name: "材料升级" });
    actions.push({ id: "ab_research", name: "科研补强" });
    actions.push({ id: "ab_contact", name: "套磁跟进" });
  }
  const actWrap = document.createElement("div");
  actWrap.style.marginTop = "12px";
  actWrap.innerHTML = `<div style="margin-bottom:6px;font-weight:600;">本周可做的出国动作（消耗行动次数）</div>`;
  actions.forEach(a => {
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.style.display = "block";
    btn.style.width = "100%";
    btn.style.marginBottom = "8px";
    btn.textContent = a.name;
    const noEnergyExceptRest = state.energy <= 0;
    btn.disabled = state.actionsLeft <= 0 || noEnergyExceptRest;
    if (noEnergyExceptRest) btn.title = "精力值为0，只能选择休息";
    btn.addEventListener("click", () => {
      if (state.actionsLeft <= 0) { logLine("本周行动已用完"); return; }
      if (state.energy <= 0) { logLine("精力值为0，只能选择休息"); return; }
      handleAbroadAction(a);
      closeAbroadCenterModal();
      if (state.actionsLeft <= 0 && !state.eventPending) nextWeek();
      else render();
    });
    actWrap.appendChild(btn);
  });
  panel.appendChild(actWrap);

  const status = document.createElement("div");
  status.style.marginTop = "12px";
  status.innerHTML = `
    <div style="margin-bottom:6px;font-weight:600;">进度</div>
    <div class="muted">材料：${ab.material} / 语言：${ab.language} / 科研：${ab.research} / 套磁：${ab.contact} / 面试：${ab.interview}</div>
    <div class="muted">Offer：${(ab.offers || []).map(o => o.name).join("、") || "暂无"}</div>
  `;
  panel.appendChild(status);

  const closeBtn = document.createElement("button");
  closeBtn.className = "btn";
  closeBtn.style.marginTop = "10px";
  closeBtn.textContent = "关闭";
  closeBtn.addEventListener("click", closeAbroadCenterModal);
  panel.appendChild(closeBtn);

  modal.innerHTML = "";
  modal.appendChild(panel);
  modal.style.display = "flex";
}

function closeAbroadCenterModal() {
  const modal = document.getElementById("abroadCenterModal");
  if (modal) modal.style.display = "none";
}

function chooseOverseasOffer(name) {
  if (!name) return;
  state.flags = state.flags || {};
  state.flags.abroadChosenOffer = name;
  for (const o of (state.offers || [])) {
    if (o.kind !== "overseas") continue;
    if (o.name === name) {
      o.status = "direct";
      o.chosen = true;
    } else if (o.status !== "revoked") {
      o.status = "revoked";
    }
  }
  logLine(`【出国】最终去向确认：${name}`);
}

function handleAbroadAction(action) {
  ensureAbroadEnabledIfNeeded();
  const ab = state.branches.abroad;
  if (!ab) return;
  if (state.actionsLeft <= 0) { logLine("本周行动已用完"); return; }
  if (action.id === "ab_material") {
    state.actionsLeft -= 1;
    ab.material = clamp(ab.material + randi(8, 12), 0, 100);
    ab.materials = ab.material;
    applyEffects({ stress: +5, energy: -6 });
    logLine("【出国】材料完善。");
  } else if (action.id === "ab_language") {
    state.actionsLeft -= 1;
    if (getCurrentTermIndex() === 7) {
      ab.language = clamp(ab.language + randi(7, 11), 0, 100);
    } else {
      ab.interview = clamp(ab.interview + randi(7, 11), 0, 100);
    }
    applyEffects({ stress: +5, energy: -6 });
    logLine(getCurrentTermIndex() === 7 ? "【出国】语言提升。" : "【出国】口语表达/写作提升。");
  } else if (action.id === "ab_research") {
    state.actionsLeft -= 1;
    ab.research = clamp(ab.research + randi(6, 10), 0, 100);
    applyEffects({ stress: +6, energy: -6 });
    logLine("【出国】科研推进。");
  } else if (action.id === "ab_contact") {
    state.actionsLeft -= 1;
    ab.contact = clamp(ab.contact + randi(7, 11), 0, 100);
    applyEffects({ stress: +5, energy: -6 });
    logLine("【出国】套磁/推荐信推进。");
  } else if (action.id === "ab_submit") {
    if (getCurrentTermIndex() !== 8) {
      logLine("【出国】投递季在第8学期开启。");
      return;
    }
    const remaining = ABROAD_MAX_TARGETS - (ab.targets || []).length;
    if (remaining <= 0) { logLine("【出国】目标已满5所。"); return; }
    const pool = getAbroadPool();
    const idMap = {};
    const suggested = pool
      .filter(u => !(ab.targets || []).includes(u.id))
      .map(u => {
        const label = `${u.name}（T${u.tier}）`;
        idMap[label] = u.id;
        return label;
      });
    if (!suggested.length) { logLine("【出国】暂无可投递的新目标。"); return; }
    openCompanyPickModal({
      suggested,
      maxPick: remaining,
      title: "选择要投递的学校",
      unit: "所",
      confirmText: "确认投递",
      onConfirm: (picked) => {
        if (!picked || !picked.length) return;
        const cost = picked.length * ABROAD_TARGET_FEE;
        if (Number(state.money || 0) < cost) {
          logLine("【出国】余额不足，无法完成本次投递。");
          return;
        }
        state.actionsLeft -= 1;
        state.money -= cost;
        picked.forEach(label => {
          const id = idMap[label] || label;
          const univ = getAbroadUnivById(id);
          if (!(ab.targets || []).includes(id)) ab.targets.push(id);
          ab.app[id] = ab.app[id] || {};
          ab.app[id].status = "submitted";
          ab.submittedCount += 1;
          logLine(`【出国】已投递：${univ?.name || id}（-200）`);
        });
        if (state.actionsLeft <= 0 && !state.eventPending) nextWeek();
        else render();
      }
    });
  } else if (action.id === "ab_interview") {
    state.actionsLeft -= 1;
    ab.interview = clamp(ab.interview + randi(8, 12), 0, 100);
    applyEffects({ stress: +6, energy: -6 });
    logLine("【出国】面试训练。");
  }
}

/* ========== 体制内中心 ========== */
const GONGKAO_WRITTEN_TH = { 1: 78, 2: 74, 3: 70, 4: 65, 5: 60 };

function getCivilJobSpecByName(name) {
  if (typeof CIVIL_JOB_SPEC !== "undefined" && CIVIL_JOB_SPEC && CIVIL_JOB_SPEC[name]) return CIVIL_JOB_SPEC[name];
  return { tier: 3, track: "general" };
}

function getCivilJobTier(name) {
  return (getCivilJobSpecByName(name).tier || 3);
}

function getCivilJobTrack(name) {
  return (getCivilJobSpecByName(name).track || "general");
}

function calcGongkaoStressPenalty() {
  const s = Number(state.stress || 0);
  if (s >= 70) return 6;
  if (s >= 50) return 3;
  return 0;
}

function calcGongkaoLuck() {
  const base = 1 + 4 * (Number(state.social || 0) / 100);
  const rand = (Math.random() * 3) - 1.5;
  return clamp(base + rand, 0, 6);
}

function calcGongkaoWrittenBase(track, gk) {
  if (track === "propaganda") return 0.45 * gk.ability + 0.55 * gk.essay;
  if (track === "law" || track === "judicial") return 0.45 * gk.ability + 0.35 * gk.essay + 0.20 * gk.special;
  if (track === "finance" || track === "finreg" || track === "stats" || track === "inst_research") {
    return 0.45 * gk.ability + 0.30 * gk.essay + 0.25 * gk.special;
  }
  if (track === "police") return 0.60 * gk.ability + 0.30 * gk.essay + 0.10 * gk.special;
  return 0.55 * gk.ability + 0.45 * gk.essay;
}

function getGongkaoStageLabel(stage) {
  const map = {
    prep: "备考",
    exam_week: "考试周",
    waiting_score: "等待出分（冻结）",
    interview_prep: "面试准备",
    done: "已结束"
  };
  return map[stage] || "备考";
}

function getGongkaoJobStatusText(status) {
  const map = {
    planned: "已报名",
    written_done: "笔试完成",
    invite: "进面",
    reject_written: "笔试未进面",
    offer: "录用",
    reject: "面试未通过",
    fail_review: "体检/政审未通过"
  };
  return map[status] || "未报名";
}

function openGongkaoJobPick(gk, opts = {}) {
  const pool = (typeof CIVIL_JOB_30 !== "undefined" && Array.isArray(CIVIL_JOB_30)) ? CIVIL_JOB_30 : [];
  const labelMap = {};
  const suggested = pool.map(name => {
    const tier = getCivilJobTier(name);
    const label = `${name}（T${tier}）`;
    labelMap[label] = name;
    return label;
  });
  openCompanyPickModal({
    suggested,
    maxPick: 3,
    title: opts.title || "选择报考岗位",
    unit: "个",
    confirmText: opts.confirmText || "确认报名",
    onConfirm: (picked) => {
      if (!picked || !picked.length) return;
      gk.jobsSelected = picked.map(p => labelMap[p] || p).slice(0, 3);
      gk.jobsSelected.forEach(j => { if (!gk.jobStatus[j]) gk.jobStatus[j] = "planned"; });
      for (const k of Object.keys(gk.jobStatus)) {
        if (!gk.jobsSelected.includes(k)) delete gk.jobStatus[k];
      }
      logLine(`【体制内】已报名岗位：${gk.jobsSelected.join(" / ")}`);
      if (typeof opts.onPicked === "function") opts.onPicked();
    }
  });
}

function initGongkaoState(gk) {
  if (!gk) return;
  gk.jobsSelected = gk.jobsSelected || [];
  gk.jobStatus = gk.jobStatus || {};
  gk.writtenScores = gk.writtenScores || {};
  gk.ability = gk.ability ?? gk.aptitude ?? 0;
  gk.essay = gk.essay ?? 0;
  gk.special = gk.special ?? 0;
  gk.interview = gk.interview ?? gk.stability ?? 0;
  gk.material = gk.material ?? 0;
  gk.mockCount = gk.mockCount || 0;
  gk.inbox = gk.inbox || [];
  gk.flags = gk.flags || {};
  if (!gk.stage) gk.stage = "prep";
}

function isGongkaoCenterTime() {
  const termIdx = getCurrentTermIndex();
  if (termIdx < 7) return false;
  if (termIdx === 7) return true;
  if (termIdx === 8) return state.week <= 7;
  return false;
}

function ensureGongkaoEnabledIfNeeded() {
  if (getActiveRoute() !== "gongkao") return;
  state.branches = state.branches || {};
  const gk = state.branches.gongkao || (state.branches.gongkao = { enabled: false });
  initGongkaoState(gk);
  const shouldEnable = isGongkaoCenterTime() && !(gk.flags && gk.flags.done);
  if (!gk.enabled && shouldEnable) {
    gk.enabled = true;
    gk.inbox.push("体制内中心开启：开始备考/选岗。");
  }
  if (gk.enabled && !shouldEnable) gk.enabled = false;
}

function updateGongkaoStage(gk) {
  const termIdx = getCurrentTermIndex();
  const week = state.week;
  if (gk.flags.done) { gk.stage = "done"; return; }
  if (termIdx === 7) {
    if (week <= 11) gk.stage = "prep";
    else if (week === 12) gk.stage = "exam_week";
    else gk.stage = "waiting_score";
    return;
  }
  if (termIdx === 8) {
    if (week <= 3) gk.stage = "interview_prep";
    else if (week <= 6) gk.stage = "waiting_score";
    if (week >= 7) gk.stage = "done";
  }
}

function computeGongkaoWrittenScores(gk) {
  const stressPenalty = calcGongkaoStressPenalty();
  const mockBonus = Math.min(4, (gk.mockCount || 0) * 2);
  const luck = calcGongkaoLuck();
  for (const job of (gk.jobsSelected || [])) {
    const track = getCivilJobTrack(job);
    const base = calcGongkaoWrittenBase(track, gk);
    const score = base + mockBonus + luck + randi(-4, 4) - stressPenalty;
    gk.writtenScores[job] = score;
    const tier = getCivilJobTier(job);
    const th = GONGKAO_WRITTEN_TH[tier] || 76;
    if (score >= th) {
      gk.jobStatus[job] = "invite";
    } else {
      gk.jobStatus[job] = "reject_written";
    }
  }
}

function computeGongkaoInterview(gk) {
  const stressPenalty = calcGongkaoStressPenalty();
  const luck = calcGongkaoLuck();
  for (const job of (gk.jobsSelected || [])) {
    if (gk.jobStatus[job] !== "invite") continue;
    const writtenScore = gk.writtenScores[job] || 0;
    const prepBoost = (gk.interviewTrainCount || 0) >= 2 ? 4 : 0;
    const finalScore = 0.60 * gk.interview + 0.25 * writtenScore + 0.10 * gk.material + 0.05 * gk.essay
      + prepBoost + luck + randi(-3, 3) - stressPenalty;
    const tier = getCivilJobTier(job);
    const th = (GONGKAO_WRITTEN_TH[tier] || 76);
    gk.jobStatus[job] = finalScore >= th ? "offer" : "reject";
  }
}

function computeGongkaoReview(gk) {
  const stress = Number(state.stress || 0);
  for (const job of (gk.jobsSelected || [])) {
    if (gk.jobStatus[job] !== "offer") continue;
    if (gk.material < 35 && Math.random() < 0.2) {
      gk.jobStatus[job] = "fail_review";
    } else if (stress >= 85 && Math.random() < 0.15) {
      gk.jobStatus[job] = "fail_review";
    }
  }
}

function tickGongkao() {
  if (getActiveRoute() !== "gongkao") return;
  ensureGongkaoEnabledIfNeeded();
  const gk = state.branches?.gongkao;
  if (!gk || !gk.enabled) return;
  initGongkaoState(gk);
  updateGongkaoStage(gk);
  const termIdx = getCurrentTermIndex();
  const week = state.week;

  if (termIdx === 7 && week === 12 && !gk.flags.examPrompted) {
    gk.flags.examPrompted = true;
    gk.inbox.push("【体制内】本周笔试考试，结束后进入等待出分阶段。");
  }
  if (termIdx === 7 && week === 11 && (gk.jobsSelected || []).length === 0 && !gk.flags.forceApplyShown) {
    gk.flags.forceApplyShown = true;
    gk.inbox.push("【体制内】考试前必须完成选岗报名。");
    openGongkaoJobPick(gk, { title: "考试前强制选岗", confirmText: "确认报名" });
  }
  if (termIdx === 7 && week === 12 && (gk.jobsSelected || []).length === 0 && !gk.flags.forceApplyFinal) {
    gk.flags.forceApplyFinal = true;
    gk.inbox.push("【体制内】尚未选岗，已强制弹出报名。");
    openGongkaoJobPick(gk, { title: "请选择报考岗位", confirmText: "确认报名" });
  }
  if (termIdx === 7 && week >= 13 && !gk.flags.examTaken) {
    gk.flags.examTaken = true;
    gk.inbox.push("【体制内】笔试已自动完成，等待出分。");
    gk.stage = "waiting_score";
  }

  if (termIdx === 8 && week === 1 && !gk.flags.writtenScored) {
    gk.flags.writtenScored = true;
    if (!gk.flags.examTaken) {
      gk.inbox.push("【体制内】未参加笔试，无法进入面试。");
      for (const job of (gk.jobsSelected || [])) gk.jobStatus[job] = "reject_written";
    } else {
      computeGongkaoWrittenScores(gk);
      gk.inbox.push("【体制内】笔试出分完成。");
      const lines = (gk.jobsSelected || []).map(job => {
        const score = gk.writtenScores[job] || 0;
        const tier = getCivilJobTier(job);
        const th = GONGKAO_WRITTEN_TH[tier] || 76;
        const status = gk.jobStatus[job] === "invite" ? "进面" : "未进面";
        return `${job}（T${tier}）：${Math.round(score)} / 线${th} → ${status}`;
      });
      openEventModal({
        id: "GK_WRITTEN_RESULT",
        title: "笔试结果",
        text: lines.length ? lines.join("；") : "暂无报考岗位。",
        options: [{ text: "知道了", onSelect() {} }]
      });
    }
    const invites = (gk.jobsSelected || []).filter(j => gk.jobStatus[j] === "invite");
    if (invites.length === 0) {
      openEventModal({
        id: "GK_WRITTEN_FAIL",
        title: "笔试未进面",
        text: "未进入面试，考公失败，是否转向其他路线？",
        options: [
          { text: "转就业", onSelect() { setRouteChoice("qiuzhao"); } },
          { text: "转考研", onSelect() { setRouteChoice("kaoyan"); } },
          { text: "转出国", onSelect() { setRouteChoice("abroad"); } }
        ]
      });
      state.outcomes = state.outcomes || {};
      state.outcomes.civil = "fail";
      gk.flags.done = true;
      gk.stage = "done";
      gk.enabled = false;
      return;
    }
    gk.stage = "interview_prep";
  }

  if (termIdx === 8 && week === 4 && !gk.flags.interviewDone) {
    gk.flags.interviewDone = true;
    computeGongkaoInterview(gk);
    gk.inbox.push("【体制内】面试结算完成。");
    const lines = (gk.jobsSelected || []).map(job => {
      const st = gk.jobStatus[job] === "offer" ? "通过" : "未通过";
      return `${job}：${st}`;
    });
    openEventModal({
      id: "GK_INTERVIEW_RESULT",
      title: "面试结果",
      text: lines.length ? lines.join("；") : "暂无进面岗位。",
      options: [{ text: "知道了", onSelect() {} }]
    });
  }

  if (termIdx === 8 && week === 5 && !gk.flags.reviewDone) {
    gk.flags.reviewDone = true;
    computeGongkaoReview(gk);
    gk.inbox.push("【体制内】体检/政审完成。");
    const lines = (gk.jobsSelected || []).map(job => {
      if (gk.jobStatus[job] === "fail_review") return `${job}：体检/政审未通过`;
      if (gk.jobStatus[job] === "offer") return `${job}：录用保持`;
      return `${job}：无录用`;
    });
    openEventModal({
      id: "GK_REVIEW_RESULT",
      title: "体检/政审结果",
      text: lines.length ? lines.join("；") : "暂无录用结果。",
      options: [{ text: "知道了", onSelect() {} }]
    });
  }

  if (termIdx === 8 && week === 7 && !gk.flags.done) {
    gk.flags.done = true;
    const offers = (gk.jobsSelected || []).filter(j => gk.jobStatus[j] === "offer");
    if (offers.length) {
      const finalizeOffer = (chosen) => {
        const name = chosen || offers[0];
        gk.flags.chosenJob = name;
        (gk.jobsSelected || []).forEach(j => {
          if (j === name) gk.jobStatus[j] = "offer";
          else if (gk.jobStatus[j] === "offer") gk.jobStatus[j] = "reject";
        });
        addOffer({ kind: "civil", status: "admit", name, source: "gongkao" });
        openEventModal({
          id: "GK_RESULT",
          title: "体制内结果",
          text: `录用：${name}`,
          options: [{ text: "知道了", onSelect() {} }]
        });
      };
      if (offers.length >= 2) {
        openCompanyPickModal({
          suggested: offers,
          maxPick: 1,
          title: "请选择最终去向",
          unit: "个",
          confirmText: "确认去向",
          onConfirm: (picked) => {
            const name = (picked && picked[0]) ? picked[0] : offers[0];
            finalizeOffer(name);
          }
        });
      } else {
        finalizeOffer(offers[0]);
      }
      state.outcomes = state.outcomes || {};
      state.outcomes.civil = "pass";
    } else {
      openEventModal({
        id: "GK_FAIL",
        title: "体制内结果",
        text: "未获得录用，是否转向其他路线？",
        options: [
          { text: "转就业", onSelect() { setRouteChoice("qiuzhao"); } },
          { text: "转考研", onSelect() { setRouteChoice("kaoyan"); } },
          { text: "转出国", onSelect() { setRouteChoice("abroad"); } }
        ]
      });
      state.outcomes = state.outcomes || {};
      state.outcomes.civil = "fail";
    }
    gk.stage = "done";
  }
}

function gongkaoCenterAvailable() {
  ensureGongkaoEnabledIfNeeded();
  const gk = state.branches?.gongkao;
  return !!(gk && gk.enabled && getActiveRoute() === "gongkao");
}

function ensureGongkaoCenterButton() {
  const host = ui.actionPanel?.parentElement || document.body;
  let btn = document.getElementById("btnGongkaoCenter");
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "btnGongkaoCenter";
    btn.className = "btn";
    btn.style.marginLeft = "8px";
    btn.textContent = "体制内中心";
    btn.addEventListener("click", openGongkaoCenterModal);
    if (host && host.insertBefore) host.insertBefore(btn, host.firstChild);
    else document.body.appendChild(btn);
  }
  const show = gongkaoCenterAvailable();
  btn.style.display = show ? "inline-block" : "none";
  const noEnergy = state.energy <= 0;
  btn.disabled = state.actionsLeft <= 0 || noEnergy;
  btn.title = state.actionsLeft <= 0 ? "本周行动已用完" : (noEnergy ? "精力值为0，只能选择休息" : "");
}

function openGongkaoCenterModal() {
  ensureGongkaoEnabledIfNeeded();
  const gk = state.branches?.gongkao;
  if (!gk || !gk.enabled) return;
  initGongkaoState(gk);
  updateGongkaoStage(gk);
  let modal = document.getElementById("gongkaoCenterModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "gongkaoCenterModal";
    Object.assign(modal.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(0,0,0,0.45)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: "9999"
    });
    modal.addEventListener("click", (e) => { if (e.target === modal) closeGongkaoCenterModal(); });
    document.body.appendChild(modal);
  }

  const panel = document.createElement("div");
  Object.assign(panel.style, {
    background: "#111827",
    color: "#e5e7eb",
    minWidth: "360px",
    maxWidth: "520px",
    padding: "18px",
    borderRadius: "10px",
    boxShadow: "0 10px 30px rgba(0,0,0,0.35)"
  });

  const stageLabel = getGongkaoStageLabel(gk.stage);
  panel.innerHTML = `<div style="font-size:18px;font-weight:700;">体制内中心</div><div class="muted" style="margin-top:4px;">当前阶段：${stageLabel}</div>`;
  const stressPenalty = calcGongkaoStressPenalty();
  const stressTip = document.createElement("div");
  stressTip.className = "muted";
  stressTip.style.marginTop = "6px";
  stressTip.textContent = `压力过高会影响发挥（惩罚-${stressPenalty}）。`;
  panel.appendChild(stressTip);

  const inbox = document.createElement("div");
  inbox.style.marginTop = "10px";
  inbox.innerHTML = `<div style="font-weight:600;">本周通知</div>`;
  const msgs = gk.inbox && gk.inbox.length ? gk.inbox.slice() : ["暂无新通知"];
  msgs.forEach(m => {
    const div = document.createElement("div");
    div.className = "muted";
    div.textContent = m;
    inbox.appendChild(div);
  });
  panel.appendChild(inbox);
  gk.inbox = [];

  const jobsLine = document.createElement("div");
  jobsLine.className = "muted";
  const selectedJobs = gk.jobsSelected || [];
  const statusText = selectedJobs.map(j => {
    const tier = getCivilJobTier(j);
    const st = getGongkaoJobStatusText(gk.jobStatus[j] || "planned");
    return `${j}(T${tier})·${st}`;
  });
  jobsLine.textContent = selectedJobs.length ? `已报岗位（${selectedJobs.length}/3）：${statusText.join(" / ")}` : "已报岗位：未选择";
  panel.appendChild(jobsLine);

  const actions = [];
  if (gk.stage === "prep") {
    actions.push({ id: "gk_apt", name: "行测刷题" });
    actions.push({ id: "gk_essay", name: "申论训练" });
    actions.push({ id: "gk_special", name: "专业训练" });
    actions.push({ id: "gk_mock", name: "模考/套卷" });
    actions.push({ id: "gk_apply", name: "选岗&报名" });
  } else if (gk.stage === "exam_week") {
    actions.push({ id: "gk_exam", name: "去考试" });
  } else if (gk.stage === "interview_prep") {
    actions.push({ id: "gk_interview", name: "面试训练" });
    actions.push({ id: "gk_hot", name: "热点/写作复盘" });
    actions.push({ id: "gk_special_q", name: "专业问答" });
    actions.push({ id: "gk_material", name: "材料/政审准备" });
  }
  const actWrap = document.createElement("div");
  actWrap.style.marginTop = "12px";
  actWrap.innerHTML = `<div style="margin-bottom:6px;font-weight:600;">本周可做的体制内动作（消耗行动次数）</div>`;
  actions.forEach(a => {
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.style.display = "block";
    btn.style.width = "100%";
    btn.style.marginBottom = "8px";
    btn.textContent = a.name;
    const noEnergyExceptRest = state.energy <= 0;
    btn.disabled = state.actionsLeft <= 0 || gk.stage === "waiting_score" || gk.stage === "done" || noEnergyExceptRest;
    if (noEnergyExceptRest) btn.title = "精力值为0，只能选择休息";
    btn.addEventListener("click", () => {
      if (state.actionsLeft <= 0) { logLine("本周行动已用完"); return; }
      if (state.energy <= 0) { logLine("精力值为0，只能选择休息"); return; }
      handleGongkaoAction(a);
      closeGongkaoCenterModal();
      if (state.actionsLeft <= 0 && !state.eventPending) nextWeek();
      else render();
    });
    actWrap.appendChild(btn);
  });
  panel.appendChild(actWrap);

  const status = document.createElement("div");
  status.style.marginTop = "12px";
  status.innerHTML = `
    <div style="margin-bottom:6px;font-weight:600;">进度</div>
    <div class="muted">行测：${gk.ability} / 申论：${gk.essay} / 专业：${gk.special} / 面试：${gk.interview} / 材料：${gk.material} / 模考：${gk.mockCount}</div>
  `;
  panel.appendChild(status);

  const giveUpBtn = document.createElement("button");
  giveUpBtn.className = "btn";
  giveUpBtn.style.marginTop = "10px";
  giveUpBtn.textContent = "放弃考公（转路线）";
  giveUpBtn.addEventListener("click", () => {
    closeGongkaoCenterModal();
    openEventModal({
      id: "GK_GIVEUP",
      title: "放弃考公",
      text: "你决定放弃考公，转向其他路线。",
      options: [
        { text: "转就业", onSelect() { setRouteChoice("qiuzhao"); } },
        { text: "转考研", onSelect() { setRouteChoice("kaoyan"); } },
        { text: "转出国", onSelect() { setRouteChoice("abroad"); } }
      ]
    });
  });
  panel.appendChild(giveUpBtn);

  const closeBtn = document.createElement("button");
  closeBtn.className = "btn";
  closeBtn.style.marginTop = "10px";
  closeBtn.textContent = "关闭";
  closeBtn.addEventListener("click", closeGongkaoCenterModal);
  panel.appendChild(closeBtn);

  modal.innerHTML = "";
  modal.appendChild(panel);
  modal.style.display = "flex";
}

function closeGongkaoCenterModal() {
  const modal = document.getElementById("gongkaoCenterModal");
  if (modal) modal.style.display = "none";
}

function handleGongkaoAction(action) {
  ensureGongkaoEnabledIfNeeded();
  const gk = state.branches.gongkao;
  if (!gk) return;
  if (state.actionsLeft <= 0) { logLine("本周行动已用完"); return; }
  initGongkaoState(gk);
  updateGongkaoStage(gk);
  if (gk.stage === "waiting_score" || gk.stage === "done") {
    logLine("【体制内】当前阶段不可行动。");
    return;
  }
  if (action.id === "gk_apt") {
    state.actionsLeft -= 1;
    gk.ability = clamp(gk.ability + randi(9, 13), 0, 100);
    applyEffects({ stress: +6, energy: -10 });
    logLine("【体制内】行测刷题提升。");
  } else if (action.id === "gk_essay") {
    state.actionsLeft -= 1;
    gk.essay = clamp(gk.essay + randi(8, 12), 0, 100);
    applyEffects({ stress: +6, energy: -10 });
    logLine("【体制内】申论训练提升。");
  } else if (action.id === "gk_special") {
    state.actionsLeft -= 1;
    gk.special = clamp(gk.special + randi(8, 12), 0, 100);
    applyEffects({ stress: +6, energy: -10 });
    logLine("【体制内】专业能力提升。");
  } else if (action.id === "gk_mock") {
    state.actionsLeft -= 1;
    gk.mockCount = Math.min(3, (gk.mockCount || 0) + 1);
    gk.ability = clamp(gk.ability + 3, 0, 100);
    gk.essay = clamp(gk.essay + 3, 0, 100);
    applyEffects({ stress: +6, energy: -10 });
    logLine("【体制内】模考完成，熟悉度提升。");
  } else if (action.id === "gk_material") {
    state.actionsLeft -= 1;
    const delta = (gk.stage === "prep") ? randi(8, 12) : randi(6, 10);
    gk.material = clamp(gk.material + delta, 0, 100);
    applyEffects({ stress: +4, energy: -8 });
    logLine("【体制内】材料准备推进。");
  } else if (action.id === "gk_apply") {
    openGongkaoJobPick(gk, {
      title: "选择报考岗位",
      confirmText: "确认报名",
      onPicked: () => {
        state.actionsLeft -= 1;
        if (state.actionsLeft <= 0 && !state.eventPending) nextWeek();
        else render();
      }
    });
  } else if (action.id === "gk_interview") {
    state.actionsLeft -= 1;
    gk.interview = clamp(gk.interview + randi(12, 16), 0, 100);
    gk.interviewTrainCount = (gk.interviewTrainCount || 0) + 1;
    applyEffects({ stress: +4, energy: -10 });
    logLine("【体制内】面试训练。");
  } else if (action.id === "gk_hot") {
    state.actionsLeft -= 1;
    gk.essay = clamp(gk.essay + randi(8, 12), 0, 100);
    applyEffects({ stress: +3, energy: -8 });
    logLine("【体制内】热点写作复盘。");
  } else if (action.id === "gk_special_q") {
    state.actionsLeft -= 1;
    gk.special = clamp(gk.special + randi(8, 12), 0, 100);
    applyEffects({ stress: +3, energy: -8 });
    logLine("【体制内】专业问答强化。");
  } else if (action.id === "gk_exam") {
    if ((gk.jobsSelected || []).length === 0) {
      logLine("【体制内】请先完成选岗报名。");
      openGongkaoJobPick(gk, { title: "请选择报考岗位", confirmText: "确认报名" });
      return;
    }
    if (state.actionsLeft <= 0) { logLine("本周行动已用完"); return; }
    state.actionsLeft -= 1;
    gk.flags.examTaken = true;
    gk.stage = "waiting_score";
    logLine("【体制内】已完成笔试，等待出分。");
  }
}

/* ========== 保研：学校池/阈值/评分工具 ========== */
const PG_STATUS_RANK = {
  idle: 0,
  rejected: 1,
  prepush_fail: 1,
  waitlist: 2,
  prepush_wait: 2,
  invited: 3,
  prepush_pass: 4,
  excellent: 5,
  offer_direct: 6
};
const PG_SCORE_BASE_BONUS = 10;

function getPgUnivPool() {
  if (typeof UNIV_38 !== "undefined" && Array.isArray(UNIV_38) && UNIV_38.length) return UNIV_38;
  return [];
}

function getPgUnivById(id) {
  return getPgUnivPool().find(u => u.id === id);
}

function getPgTierThreshold(key, tier, fallback) {
  try {
    const table = (typeof TIER_THRESHOLDS !== "undefined") ? TIER_THRESHOLDS : null;
    const v = table && table[key] && table[key][tier];
    if (v != null) return Number(v);
  } catch (e) { /* ignore */ }
  return Number(fallback || 0);
}

function calcPgBaseProfile() {
  const gpa = calcCumulativeGPA();
  let gpaBonus = 0;
  if (gpa >= 4.5) gpaBonus = 20;
  else if (gpa >= 4.0) gpaBonus = 10;
  else if (gpa >= 3.9) gpaBonus = 8;
  else if (gpa >= 3.8) gpaBonus = 7;

  const cet6 = Number(state.certs?.cet6?.score || 0);
  let engBonus = 0;
  if (cet6 >= 700) engBonus = 20;
  else if (cet6 >= 600) engBonus = 10;
  else if (cet6 >= 550) engBonus = 5;
  else if (cet6 >= 500) engBonus = 3;

  const sciCount = Number(state.milestones?.sci || 0);
  const sciBonus = Math.min(15, sciCount * 5);

  return gpaBonus + engBonus + sciBonus;
}

function calcPgLuckBonus() {
  const s = clamp((Number(state.social || 0)) / 100, 0, 1);
  const mu = 2 + 6 * s;
  const rand = randi(-2, 2);
  return clamp(mu + rand, 0, 10);
}

function calcPgStressPenalty() {
  const stress = Number(state.stress || 0);
  return stress > 70 ? (stress - 70) * 0.3 : 0;
}

function calcPgSwing() {
  return calcPgLuckBonus() + randi(-6, 6) - calcPgStressPenalty();
}

function applyPgScoreWithReroll(pg, base, threshold, label) {
  let score = base + calcPgSwing();
  if (score < threshold && pg && (pg.safetyToken || 0) > 0) {
    pg.safetyToken = Math.max(0, (pg.safetyToken || 0) - 1);
    const reroll = base + calcPgSwing();
    score = Math.max(score, reroll);
    if (pg.inbox) pg.inbox.push(`【${label}】保底票触发重掷。`);
  }
  return score;
}

function initPgUnivState(pg) {
  if (!pg) return;
  if (!pg.selectedUnivs) pg.selectedUnivs = [];
  if (!pg.univApps) pg.univApps = {};
  if (pg.baseProfile == null) pg.baseProfile = calcPgBaseProfile();
  if (!pg.activeUnivId && pg.selectedUnivs.length) pg.activeUnivId = pg.selectedUnivs[0];
}

function ensurePgUnivApp(pg, univId) {
  if (!pg || !univId) return null;
  pg.univApps = pg.univApps || {};
  if (!pg.univApps[univId]) pg.univApps[univId] = { status: "idle" };
  return pg.univApps[univId];
}

function setPgUnivStatus(pg, univId, status) {
  if (!pg || !univId) return;
  const app = ensurePgUnivApp(pg, univId);
  const prev = app.status || "idle";
  if ((PG_STATUS_RANK[status] || 0) >= (PG_STATUS_RANK[prev] || 0)) {
    app.status = status;
  }
}

function getPgUnivStatus(pg, univId) {
  const app = pg && pg.univApps ? pg.univApps[univId] : null;
  return app && app.status ? app.status : "idle";
}

function getPgUnivStatusText(status) {
  const map = {
    idle: "未投",
    invited: "入营",
    waitlist: "候补",
    rejected: "未入营",
    excellent: "优秀营员/预录取",
    offer_direct: "直发Offer",
    prepush_pass: "预推免通过",
    prepush_wait: "预推免候补",
    prepush_fail: "预推免未通过"
  };
  return map[status] || "未投";
}

function addPushmianSchoolOffer(univId, status, source) {
  if (!univId) return null;
  const univ = getPgUnivById(univId);
  const name = univ?.name || univId;
  const exists = (state.offers || []).some(o => o.kind === "pushmian" && o.name === name && o.status !== "revoked");
  if (exists) return null;
  return addOffer({
    kind: "pushmian",
    status: status || "intent",
    source: source || "pg",
    name,
    tier: univ?.tier ? `T${univ.tier}` : undefined
  });
}

function choosePushmianOffer(univId) {
  if (!univId) return;
  const univ = getPgUnivById(univId);
  const name = univ?.name || univId;
  state.flags = state.flags || {};
  state.flags.pushmianChosenUnivId = univId;
  for (const o of (state.offers || [])) {
    if (o.kind !== "pushmian") continue;
    if (o.name === name) {
      o.status = "direct";
      o.chosen = true;
    } else if (o.status !== "revoked") {
      o.status = "revoked";
    }
  }
  logLine(`【保研】最终去向确认：${name}`);
}

function getPgSuccessUnivs(pg) {
  if (!pg || !pg.univApps) return [];
  const out = [];
  for (const id of Object.keys(pg.univApps)) {
    const s = pg.univApps[id]?.status || "idle";
    if (s === "offer_direct" || s === "excellent" || s === "prepush_pass") out.push(id);
  }
  return out;
}

function openPgResultModal(title, lines, options) {
  const text = (lines && lines.length) ? lines.join("；") : "";
  openEventModal({
    id: `PG_RESULT_${absWeekIndex()}`,
    title,
    text,
    options: options && options.length ? options : [{ text: "知道了", onSelect() {} }]
  });
}

function getPgBestStatus(pg) {
  if (!pg || !pg.univApps) return "idle";
  let best = "idle";
  for (const app of Object.values(pg.univApps)) {
    const s = app && app.status ? app.status : "idle";
    if ((PG_STATUS_RANK[s] || 0) > (PG_STATUS_RANK[best] || 0)) best = s;
  }
  return best;
}

function getPgBestStatusText(pg) {
  return getPgUnivStatusText(getPgBestStatus(pg));
}

function getPgActiveUnivId(pg) {
  if (!pg) return null;
  if (!pg.activeUnivId && (pg.selectedUnivs || []).length) pg.activeUnivId = pg.selectedUnivs[0];
  return pg.activeUnivId || null;
}

function togglePgUnivSelection(pg, univId) {
  if (!pg || !univId) return;
  pg.selectedUnivs = pg.selectedUnivs || [];
  const idx = pg.selectedUnivs.indexOf(univId);
  if (idx >= 0) {
    pg.selectedUnivs.splice(idx, 1);
    if (pg.activeUnivId === univId) pg.activeUnivId = pg.selectedUnivs[0] || null;
  } else if (pg.selectedUnivs.length < 3) {
    pg.selectedUnivs.push(univId);
    if (!pg.activeUnivId) pg.activeUnivId = univId;
  }
}

function isPgCenterTime() {
  const termIdx = getCurrentTermIndex();
  return termIdx === 7 && state.week >= 1 && state.week <= 4;
}

function buildPgUnivSelector(pg, opts = {}) {
  initPgUnivState(pg);
  const onChange = typeof opts.onChange === "function" ? opts.onChange : null;
  const wrap = document.createElement("div");
  wrap.style.marginTop = "8px";

  const selected = pg.selectedUnivs || [];
  const activeId = getPgActiveUnivId(pg);

  const selLine = document.createElement("div");
  selLine.className = "muted";
  selLine.style.marginBottom = "6px";
  if (selected.length === 0) {
    selLine.textContent = "目标学校：未选择（最多3所）";
  } else {
    const names = selected.map(id => {
      const u = getPgUnivById(id);
      const label = u ? u.name : id;
      const status = getPgUnivStatusText(getPgUnivStatus(pg, id));
      return `${label}${id === activeId ? "（当前）" : ""}·${status}`;
    });
    selLine.textContent = `目标学校（${selected.length}/3）：${names.join(" / ")}`;
  }
  wrap.appendChild(selLine);

  const list = document.createElement("div");
  list.style.maxHeight = "210px";
  list.style.overflowY = "auto";
  list.style.border = "1px solid rgba(255,255,255,0.08)";
  list.style.borderRadius = "8px";
  list.style.padding = "6px";

  getPgUnivPool().forEach(u => {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.justifyContent = "space-between";
    row.style.padding = "6px 8px";
    row.style.borderRadius = "6px";
    row.style.cursor = "pointer";
    if (u.id === activeId) row.style.background = "rgba(59,130,246,0.15)";

    const left = document.createElement("div");
    left.innerHTML = `<div>${u.name}（T${u.tier}）</div><div class="muted" style="font-size:12px;">${getPgUnivStatusText(getPgUnivStatus(pg, u.id))}</div>`;
    row.appendChild(left);

    const btn = document.createElement("button");
    btn.className = "btn";
    const selectedNow = selected.includes(u.id);
    btn.textContent = selectedNow ? "取消" : "选择";
    if (!selectedNow && selected.length >= 3) {
      btn.disabled = true;
      btn.title = "已满3所，先取消一个";
    }
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePgUnivSelection(pg, u.id);
      if (onChange) onChange();
    });
    row.addEventListener("click", () => {
      if (selected.includes(u.id)) {
        pg.activeUnivId = u.id;
        if (onChange) onChange();
      }
    });
    row.appendChild(btn);
    list.appendChild(row);
  });

  wrap.appendChild(list);
  return wrap;
}

/* ========== 保研中心（含夏令营） ========== */
function ensurePgEnabledIfNeeded() {
  if (getActiveRoute() !== "pg") return;
  state.branches = state.branches || {};
  const pg = state.branches.pg || (state.branches.pg = { enabled: false, resume: 0, contact: 0, interview: 0, quota: 0, queue: [], inbox: [], summerActionsLeft: 0, summerStep: 0, summerDone: false, flags: {} });
  initPgUnivState(pg);
  if (pg.enabled && !isPgCenterTime()) pg.enabled = false;
  if (!pg.enabled && isPgCenterTime() && pg.summerDone) {
    pg.enabled = true;
    pg.inbox.push("保研中心开启：进入推免系统/预推免阶段。");
  }
}

function processPgSummerQueue(pg) {
  const nextQueue = [];
  for (const item of pg.queue) {
    if (item.dueStep > pg.summerStep) { nextQueue.push(item); continue; }
    if (item.type === "camp_invite") {
      const univId = item.univId || getPgActiveUnivId(pg);
      if (!univId) continue;
      const univ = getPgUnivById(univId);
      const tier = univ?.tier || 3;
      const inviteTh = getPgTierThreshold("campInvite", tier, 70);
      const baseProfile = pg.baseProfile != null ? pg.baseProfile : calcPgBaseProfile();
      const base = baseProfile + 0.5 * pg.resume + 0.3 * pg.contact + PG_SCORE_BASE_BONUS;
      const score = applyPgScoreWithReroll(pg, base, inviteTh, "夏令营入营");
      if (score >= inviteTh) {
        setPgUnivStatus(pg, univId, "invited");
        pg.inbox.push(`【保研-夏令营】${univ?.name || univId}：入营通知。`);
      } else if (score >= inviteTh - 12) {
        setPgUnivStatus(pg, univId, "waitlist");
        pg.inbox.push(`【保研-夏令营】${univ?.name || univId}：候补。`);
      } else {
        setPgUnivStatus(pg, univId, "rejected");
        pg.inbox.push(`【保研-夏令营】${univ?.name || univId}：未入营。`);
      }
    } else if (item.type === "camp_result") {
      const univId = item.univId || getPgActiveUnivId(pg);
      if (!univId) continue;
      const univ = getPgUnivById(univId);
      const tier = univ?.tier || 3;
      const excellentTh = getPgTierThreshold("campOfferBase", tier, 78);
      const directTh = excellentTh + 20;
      const baseProfile = pg.baseProfile != null ? pg.baseProfile : calcPgBaseProfile();
      const base = baseProfile + 0.4 * pg.resume + 0.4 * pg.interview + 0.2 * (pg.quota || 0) + PG_SCORE_BASE_BONUS;
      const score = applyPgScoreWithReroll(pg, base, excellentTh, "夏令营面试");
      if (score >= directTh) {
        setPgUnivStatus(pg, univId, "offer_direct");
        pg.inbox.push(`【保研-夏令营】${univ?.name || univId}：直发 Offer。`);
        createPushmianOffer("direct", "camp", `直发Offer：${univ?.name || univId}`);
        state.track.pushmian.status = "confirmed";
      } else if (score >= excellentTh) {
        setPgUnivStatus(pg, univId, "excellent");
        pg.inbox.push(`【保研-夏令营】${univ?.name || univId}：优秀营员/预录取。`);
        state.track.pushmian.status = "confirmed";
      } else if (score >= excellentTh - 13) {
        setPgUnivStatus(pg, univId, "waitlist");
        pg.inbox.push(`【保研-夏令营】${univ?.name || univId}：候补。`);
      } else {
        setPgUnivStatus(pg, univId, "rejected");
        pg.inbox.push(`【保研-夏令营】${univ?.name || univId}：未通过。`);
      }
    }
  }
  pg.queue = nextQueue;
}

function startPgSummerCamp() {
  state.branches = state.branches || {};
  const pg = state.branches.pg || (state.branches.pg = { enabled: false, resume: 0, contact: 0, interview: 0, quota: 0, queue: [], inbox: [], summerActionsLeft: 0, summerStep: 0, summerDone: false, flags: {} });
  initPgUnivState(pg);
  if (pg.summerDone) return;
  if (!pg.summerActionsLeft) pg.summerActionsLeft = 8;
  if (!pg.quota) pg.quota = randi(0, 20);
  pg.baseProfile = calcPgBaseProfile();
  openPgSummerModal();
}

function openPgSummerModal() {
  const pg = state.branches?.pg;
  if (!pg) return;
  initPgUnivState(pg);
  let modal = document.getElementById("pgSummerModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "pgSummerModal";
    Object.assign(modal.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(0,0,0,0.45)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: "10000"
    });
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.style.display = "none"; });
    document.body.appendChild(modal);
  }

  const panel = document.createElement("div");
  Object.assign(panel.style, {
    background: "#111827",
    color: "#e5e7eb",
    minWidth: "360px",
    maxWidth: "520px",
    padding: "18px",
    borderRadius: "10px",
    boxShadow: "0 10px 30px rgba(0,0,0,0.35)"
  });

  panel.innerHTML = `<div style="font-size:18px;font-weight:700;">暑假夏令营</div>`;

  const info = document.createElement("div");
  info.className = "muted";
  info.style.marginTop = "6px";
  info.textContent = `剩余行动：${pg.summerActionsLeft}`;
  panel.appendChild(info);
  const pickedSummary = document.createElement("div");
  pickedSummary.className = "muted";
  pickedSummary.style.marginTop = "6px";
  if ((pg.selectedUnivs || []).length) {
    const names = pg.selectedUnivs.map(id => getPgUnivById(id)?.name || id);
    pickedSummary.textContent = `目标学校：${names.join(" / ")}`;
  } else {
    pickedSummary.textContent = "目标学校：未选择（参加夏令营时再选择）";
  }
  panel.appendChild(pickedSummary);

  if (pg.summerActionsLeft === 1 && !(pg.flags && pg.flags.campSubmitted)) {
    pg.flags = pg.flags || {};
    if (pg.flags.campAutoPromptedStep !== pg.summerStep) {
      pg.flags.campAutoPromptedStep = pg.summerStep;
      setTimeout(() => { openPgCampSelect(pg); }, 0);
    }
  }

  const actions = [
    { id: "pg_material", name: "完善材料" },
    { id: "pg_contact", name: "联系导师/学长" },
    { id: "pg_interview", name: "准备面试" },
    { id: "pg_camp", name: "参加夏令营" }
  ];
  const forceCamp = pg.summerActionsLeft === 1 && !(pg.flags && pg.flags.campSubmitted);
  actions.forEach(a => {
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.style.display = "block";
    btn.style.width = "100%";
    btn.style.marginTop = "8px";
    btn.textContent = a.name;
    const isCamp = a.id === "pg_camp";
    btn.disabled = pg.summerActionsLeft <= 0 || (isCamp && pg.summerActionsLeft !== 1);
    if (isCamp && pg.summerActionsLeft !== 1) btn.title = "仅暑假最后一次行动可投递";
    if (forceCamp && a.id !== "pg_camp") {
      btn.disabled = true;
      btn.title = "最后一次行动需投递夏令营";
    }
    btn.addEventListener("click", () => {
      handlePgSummerAction(a);
      modal.style.display = "none";
      if (pg.summerActionsLeft > 0) openPgSummerModal();
    });
    panel.appendChild(btn);
  });

  const giveUpBtn = document.createElement("button");
  giveUpBtn.className = "btn";
  giveUpBtn.style.display = "block";
  giveUpBtn.style.width = "100%";
  giveUpBtn.style.marginTop = "10px";
  giveUpBtn.textContent = "放弃保研（转路线）";
  giveUpBtn.addEventListener("click", () => {
    modal.style.display = "none";
    openEventModal({
      id: "PG_GIVEUP",
      title: "放弃保研",
      text: "你决定放弃保研，转向其他路线。",
      options: [
        { text: "转考研", onSelect() { setRouteChoice("kaoyan"); } },
        { text: "转出国", onSelect() { setRouteChoice("abroad"); } },
        { text: "转就业", onSelect() { setRouteChoice("qiuzhao"); } },
        { text: "转考公考编", onSelect() { setRouteChoice("gongkao"); } },
        { text: "取消", onSelect() {} }
      ]
    });
  });
  panel.appendChild(giveUpBtn);

  modal.innerHTML = "";
  modal.appendChild(panel);
  modal.style.display = "flex";
}

function openPgCampSelect(pg) {
  if (!pg) return false;
  pg.flags = pg.flags || {};
  if (pg.flags.campSubmitted) return false;
  if (pg.summerActionsLeft !== 1) return false;
  const modal = document.getElementById("jobCompanyModal");
  if (modal && modal.style.display === "flex") return true;
  const nameMap = new Map();
  const names = getPgUnivPool().map(u => {
    const label = `${u.name}（T${u.tier}）`;
    nameMap.set(label, u.id);
    return label;
  });
  openCompanyPickModal({
    suggested: names,
    maxPick: Math.min(3, names.length),
    title: "选择参加夏令营的学校",
    unit: "所",
    confirmText: "确认提交",
    onConfirm: (pickedNames) => {
      if (!pickedNames || pickedNames.length === 0) return;
      pg.flags.campSubmitted = true;
      const pickedIds = pickedNames.map(n => nameMap.get(n) || n);
      pg.selectedUnivs = pickedIds.slice();
      pg.activeUnivId = pickedIds[0] || null;
      pg.summerActionsLeft -= 1;
      pg.summerStep += 1;
      const baseProfile = pg.baseProfile != null ? pg.baseProfile : calcPgBaseProfile();
      pickedIds.forEach(id => {
        const univ = getPgUnivById(id);
        const tier = univ?.tier || 3;
        const inviteTh = getPgTierThreshold("campInvite", tier, 70);
        const excellentTh = getPgTierThreshold("campOfferBase", tier, 78);
        const directTh = excellentTh + 20;
        const baseInvite = baseProfile + 0.5 * pg.resume + 0.3 * pg.contact + PG_SCORE_BASE_BONUS;
        const scoreInvite = applyPgScoreWithReroll(pg, baseInvite, inviteTh, "夏令营入营");
        if (scoreInvite >= inviteTh) {
          const baseInterview = baseProfile + 0.4 * pg.resume + 0.4 * pg.interview + 0.2 * (pg.quota || 0) + PG_SCORE_BASE_BONUS;
          const scoreInterview = applyPgScoreWithReroll(pg, baseInterview, excellentTh, "夏令营面试");
          if (scoreInterview >= directTh) {
            setPgUnivStatus(pg, id, "offer_direct");
            pg.inbox.push(`【保研-夏令营】${univ?.name || id}：直发 Offer。`);
            addPushmianSchoolOffer(id, "direct", "camp");
            state.track.pushmian.status = "confirmed";
          } else if (scoreInterview >= excellentTh) {
            setPgUnivStatus(pg, id, "excellent");
            pg.inbox.push(`【保研-夏令营】${univ?.name || id}：优秀营员/预录取。`);
            addPushmianSchoolOffer(id, "intent", "camp");
            state.track.pushmian.status = "confirmed";
          } else if (scoreInterview >= excellentTh - 13) {
            setPgUnivStatus(pg, id, "waitlist");
            pg.inbox.push(`【保研-夏令营】${univ?.name || id}：候补。`);
          } else {
            setPgUnivStatus(pg, id, "rejected");
            pg.inbox.push(`【保研-夏令营】${univ?.name || id}：未通过。`);
          }
        } else if (scoreInvite >= inviteTh - 12) {
          setPgUnivStatus(pg, id, "waitlist");
          pg.inbox.push(`【保研-夏令营】${univ?.name || id}：候补。`);
        } else {
          setPgUnivStatus(pg, id, "rejected");
          pg.inbox.push(`【保研-夏令营】${univ?.name || id}：未入营。`);
        }
      });
      addSafetyProgress(pg);
      const resultLines = pickedIds.map(id => {
        const univ = getPgUnivById(id);
        const status = getPgUnivStatusText(getPgUnivStatus(pg, id));
        return `${univ?.name || id}：${status}`;
      });
      openPgResultModal("夏令营结果", resultLines);
      if (pg.summerActionsLeft <= 0) {
        pg.summerDone = true;
        pg.inbox.push("【夏令营】暑假结束，进入第7学期保研中心。");
        if ((pg.selectedUnivs || []).length >= 3) {
          const allRejected = pg.selectedUnivs.every(id => getPgUnivStatus(pg, id) === "rejected");
          if (allRejected) {
            openEventModal({
              id: "PG_SUMMER_FAIL_SWITCH",
              title: "保研形势不佳",
              text: "暑假阶段三所目标均未入营，是否放弃保研转向其他路线？",
              options: [
                { text: "转考研", onSelect() { setRouteChoice("kaoyan"); } },
                { text: "转出国", onSelect() { setRouteChoice("abroad"); } },
                { text: "转就业", onSelect() { setRouteChoice("qiuzhao"); } },
                { text: "转考公考编", onSelect() { setRouteChoice("gongkao"); } },
                { text: "继续保研", onSelect() {} }
              ]
            });
          }
        }
      }
      render();
    }
  });
  return true;
}

function openPgPrepushSelect(pg) {
  if (!pg) return false;
  if (state.week !== 4) return false;
  pg.flags = pg.flags || {};
  if (pg.flags.prepushSubmitted) return false;
  const modal = document.getElementById("jobCompanyModal");
  if (modal && modal.style.display === "flex") return true;
  const nameMap = new Map();
  const names = getPgUnivPool().map(u => {
    const label = `${u.name}（T${u.tier}）`;
    nameMap.set(label, u.id);
    return label;
  });
  openCompanyPickModal({
    suggested: names,
    maxPick: Math.min(3, names.length),
    title: "选择预推免/补录学校",
    unit: "所",
    confirmText: "确认提交",
    onConfirm: (pickedNames) => {
      if (!pickedNames || pickedNames.length === 0) return;
      state.actionsLeft -= 1;
      const pickedIds = pickedNames.map(n => nameMap.get(n) || n);
      pg.selectedUnivs = pickedIds.slice();
      pg.activeUnivId = pickedIds[0] || null;
      pg.flags.prepushSubmitted = true;
      pickedIds.forEach(id => {
        pg.queue.push({ type: "pg_prepush", dueWeek: absWeekIndex() + 1, univId: id });
      });
      logLine(`【保研】已提交预推免/补录：${pickedIds.map(id => getPgUnivById(id)?.name || id).join(" / ")}`);
      addSafetyProgress(pg);
      render();
    }
  });
  return true;
}

function handlePgSummerAction(action) {
  const pg = state.branches.pg;
  if (!pg || pg.summerActionsLeft <= 0) return;
  if (action.id === "pg_camp") {
    openPgCampSelect(pg);
    return;
  }
  pg.summerActionsLeft -= 1;
  pg.summerStep += 1;
  if (action.id === "pg_material") pg.resume = clamp(pg.resume + 6, 0, 100);
  else if (action.id === "pg_contact") {
    pg.contact = clamp(pg.contact + 6, 0, 100);
    addSafetyProgress(pg);
  } else if (action.id === "pg_interview") {
    pg.interview = clamp(pg.interview + 6, 0, 100);
    applyEffects({ stress: +4 });
  }
  if (pg.summerActionsLeft <= 0) {
    pg.summerDone = true;
    pg.inbox.push("【夏令营】暑假结束，进入第7学期保研中心。");
    if ((pg.selectedUnivs || []).length >= 3) {
      const allRejected = pg.selectedUnivs.every(id => getPgUnivStatus(pg, id) === "rejected");
      if (allRejected) {
        openEventModal({
          id: "PG_SUMMER_FAIL_SWITCH",
          title: "保研形势不佳",
          text: "暑假阶段三所目标均未入营，是否放弃保研转向其他路线？",
          options: [
            { text: "转考研", onSelect() { setRouteChoice("kaoyan"); } },
            { text: "转出国", onSelect() { setRouteChoice("abroad"); } },
            { text: "转就业", onSelect() { setRouteChoice("qiuzhao"); } },
            { text: "转考公考编", onSelect() { setRouteChoice("gongkao"); } },
            { text: "继续保研", onSelect() {} }
          ]
        });
      }
    }
  }
}

function pgCenterAvailable() {
  ensurePgEnabledIfNeeded();
  const pg = state.branches?.pg;
  return !!(pg && pg.enabled && getActiveRoute() === "pg" && isPgCenterTime());
}

function ensurePgCenterButton() {
  const host = ui.actionPanel?.parentElement || document.body;
  let btn = document.getElementById("btnPgCenter");
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "btnPgCenter";
    btn.className = "btn";
    btn.style.marginLeft = "8px";
    btn.textContent = "保研中心";
    btn.addEventListener("click", openPgCenterModal);
    if (host && host.insertBefore) host.insertBefore(btn, host.firstChild);
    else document.body.appendChild(btn);
  }
  const show = pgCenterAvailable();
  btn.style.display = show ? "inline-block" : "none";
  const noEnergy = state.energy <= 0;
  btn.disabled = state.actionsLeft <= 0 || noEnergy;
  btn.title = state.actionsLeft <= 0 ? "本周行动已用完" : (noEnergy ? "精力值为0，只能选择休息" : "");
}

function openPgCenterModal() {
  ensurePgEnabledIfNeeded();
  const pg = state.branches?.pg;
  if (!pg || !pg.enabled) return;
  if (!isPgCenterTime()) return;
  initPgUnivState(pg);
  pg.baseProfile = calcPgBaseProfile();
  let modal = document.getElementById("pgCenterModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "pgCenterModal";
    Object.assign(modal.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(0,0,0,0.45)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: "9999"
    });
    modal.addEventListener("click", (e) => { if (e.target === modal) closePgCenterModal(); });
    document.body.appendChild(modal);
  }

  const panel = document.createElement("div");
  Object.assign(panel.style, {
    background: "#111827",
    color: "#e5e7eb",
    minWidth: "360px",
    maxWidth: "520px",
    padding: "18px",
    borderRadius: "10px",
    boxShadow: "0 10px 30px rgba(0,0,0,0.35)"
  });

  panel.innerHTML = `<div style="font-size:18px;font-weight:700;">保研中心</div>`;

  const windowInfo = document.createElement("div");
  windowInfo.className = "muted";
  windowInfo.style.marginTop = "6px";
  const remain = Math.max(0, 5 - state.week);
  windowInfo.textContent = `窗口剩余：${remain} 周 · 当前最好结果：${getPgBestStatusText(pg)}`;
  panel.appendChild(windowInfo);

  const inbox = document.createElement("div");
  inbox.style.marginTop = "10px";
  inbox.innerHTML = `<div style="font-weight:600;">本周通知</div>`;
  const msgs = pg.inbox && pg.inbox.length ? pg.inbox.slice() : ["暂无新通知"];
  msgs.forEach(m => {
    const div = document.createElement("div");
    div.className = "muted";
    div.textContent = m;
    inbox.appendChild(div);
  });
  panel.appendChild(inbox);
  pg.inbox = [];

  const pickedLine = document.createElement("div");
  pickedLine.className = "muted";
  pickedLine.style.marginTop = "8px";
  if ((pg.selectedUnivs || []).length) {
    const names = pg.selectedUnivs.map(id => `${getPgUnivById(id)?.name || id}·${getPgUnivStatusText(getPgUnivStatus(pg, id))}`);
    pickedLine.textContent = `目标学校（${pg.selectedUnivs.length}/3）：${names.join(" / ")}`;
  } else {
    pickedLine.textContent = "目标学校：未选择（预推免时再选择）";
  }
  panel.appendChild(pickedLine);

  const actions = [
    { id: "pg_resume", name: "完善材料" },
    { id: "pg_contact2", name: "联系导师" },
    { id: "pg_interview2", name: "准备面试" },
    { id: "pg_submit", name: "预推免/补录" }
  ];
  const forcePrepush = state.week === 4 && state.actionsLeft === 1 && !(pg.flags && pg.flags.prepushSubmitted);
  actions.forEach(a => {
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.style.display = "block";
    btn.style.width = "100%";
    btn.style.marginTop = "8px";
    btn.textContent = a.name;
    const isSubmit = a.id === "pg_submit";
    const noEnergyExceptRest = state.energy <= 0;
    btn.disabled = state.actionsLeft <= 0 || (isSubmit && (state.week !== 4 || pg.flags?.prepushSubmitted)) || noEnergyExceptRest;
    if (isSubmit && state.week !== 4) btn.title = "仅第4周可提交预推免/补录";
    if (isSubmit && pg.flags?.prepushSubmitted) btn.title = "本周已提交";
    if (noEnergyExceptRest) btn.title = "精力值为0，只能选择休息";
    if (forcePrepush && !isSubmit) {
      btn.disabled = true;
      btn.title = "最后一次行动需提交预推免/补录";
    }
    btn.addEventListener("click", () => {
      if (state.energy <= 0) { logLine("精力值为0，只能选择休息"); return; }
      handlePgAction(a);
      closePgCenterModal();
      if (state.actionsLeft <= 0 && !state.eventPending) nextWeek();
      else render();
    });
    panel.appendChild(btn);
  });

  const giveUpBtn = document.createElement("button");
  giveUpBtn.className = "btn";
  giveUpBtn.style.display = "block";
  giveUpBtn.style.width = "100%";
  giveUpBtn.style.marginTop = "8px";
  giveUpBtn.textContent = "放弃保研（转路线）";
  giveUpBtn.addEventListener("click", () => {
    closePgCenterModal();
    openEventModal({
      id: "PG_GIVEUP_T7",
      title: "放弃保研",
      text: "你决定放弃保研，转向其他路线。",
      options: [
        { text: "转考研", onSelect() { setRouteChoice("kaoyan"); } },
        { text: "转出国", onSelect() { setRouteChoice("abroad"); } },
        { text: "转就业", onSelect() { setRouteChoice("qiuzhao"); } },
        { text: "转考公考编", onSelect() { setRouteChoice("gongkao"); } },
        { text: "取消", onSelect() {} }
      ]
    });
  });
  panel.appendChild(giveUpBtn);

  const status = document.createElement("div");
  status.style.marginTop = "12px";
  const gpa = calcCumulativeGPA();
  const allRequiredFlag = state.flags?.allRequiredReachedB;
  const allRequiredB = (allRequiredFlag === undefined || allRequiredFlag === null) ? (gpa >= 3.7) : !!allRequiredFlag;
  const noFail = !state.failedCourseIds || state.failedCourseIds.size === 0;
  const noDiscipline = !state.disciplineFlag;
  const eligible = allRequiredB && noFail && noDiscipline;
  const reasons = [];
  if (!allRequiredB) reasons.push("必修未达B");
  if (!noFail) reasons.push("存在挂科");
  if (!noDiscipline) reasons.push("存在违纪");
  const eligibilityText = eligible ? "✅ 已满足" : `❌ ${reasons.join(" / ") || "未满足"}`;
  status.innerHTML = `
    <div style="margin-bottom:6px;font-weight:600;">进度</div>
    <div class="muted">材料：${pg.resume} / 联系度：${pg.contact} / 面试：${pg.interview}</div>
    <div class="muted">GPA：${gpa.toFixed(2)} / 保研资格：${eligibilityText}</div>
  `;
  panel.appendChild(status);

  const closeBtn = document.createElement("button");
  closeBtn.className = "btn";
  closeBtn.style.marginTop = "10px";
  closeBtn.textContent = "关闭";
  closeBtn.addEventListener("click", closePgCenterModal);
  panel.appendChild(closeBtn);

  modal.innerHTML = "";
  modal.appendChild(panel);
  modal.style.display = "flex";
}

function closePgCenterModal() {
  const modal = document.getElementById("pgCenterModal");
  if (modal) modal.style.display = "none";
}

function resolvePgPrepush(pg, univId) {
  if (!pg || !univId) return;
  const univ = getPgUnivById(univId);
  const tier = univ?.tier || 3;
  const passTh = getPgTierThreshold("campOfferBase", tier, 78);
  const baseProfile = pg.baseProfile != null ? pg.baseProfile : calcPgBaseProfile();
  let base = baseProfile + 0.4 * pg.resume + 0.3 * pg.contact + 0.3 * pg.interview + PG_SCORE_BASE_BONUS;
  const prev = getPgUnivStatus(pg, univId);
  if (prev === "waitlist" || prev === "invited") base += 5;
  const score = applyPgScoreWithReroll(pg, base, passTh, "保研补录");
  if (score >= passTh) {
    setPgUnivStatus(pg, univId, "prepush_pass");
    pg.inbox.push(`【保研-预推免】${univ?.name || univId}：通过。`);
    addPushmianSchoolOffer(univId, "intent", "prepush");
    state.track.pushmian.status = "confirmed";
  } else if (score >= passTh - 13) {
    setPgUnivStatus(pg, univId, "prepush_wait");
    pg.inbox.push(`【保研-预推免】${univ?.name || univId}：候补。`);
  } else {
    setPgUnivStatus(pg, univId, "prepush_fail");
    pg.inbox.push(`【保研-预推免】${univ?.name || univId}：未通过。`);
  }
}

function finalizePgTerm7(pg) {
  if (!pg || (pg.flags && pg.flags.term7Finalized)) return;
  pg.flags = pg.flags || {};
  pg.flags.term7Finalized = true;
  pg.enabled = false;
  const successIds = getPgSuccessUnivs(pg);
  if (successIds.length > 0) {
    const lines = successIds.map(id => {
      const univ = getPgUnivById(id);
      const status = getPgUnivStatusText(getPgUnivStatus(pg, id));
      return `${univ?.name || id}：${status}`;
    });
    const options = successIds.map(id => {
      const univ = getPgUnivById(id);
      return {
        text: `选择 ${univ?.name || id}`,
        onSelect() { choosePushmianOffer(id); }
      };
    });
    openPgResultModal(successIds.length > 1 ? "保研录取结果（请选择去向）" : "保研录取结果", lines, options);
    state.track.pushmian.status = "confirmed";
    return;
  }
  openEventModal({
    id: "PG_TERM7_END",
    title: "保研窗口结束",
    text: "未获得录取结果，是否转向其他路线？",
    options: [
      { text: "转考研", onSelect() { setRouteChoice("kaoyan"); } },
      { text: "转出国", onSelect() { setRouteChoice("abroad"); } },
      { text: "转就业", onSelect() { setRouteChoice("qiuzhao"); } },
      { text: "转考公考编", onSelect() { setRouteChoice("gongkao"); } }
    ]
  });
}

function handlePgAction(action) {
  ensurePgEnabledIfNeeded();
  const pg = state.branches.pg;
  if (!pg) return;
  if (!isPgCenterTime()) { logLine("【保研】当前不在保研窗口期。"); return; }
  if (state.actionsLeft <= 0) { logLine("本周行动已用完"); return; }
  const now = absWeekIndex();
  if (action.id === "pg_resume") {
    state.actionsLeft -= 1;
    pg.resume = clamp(pg.resume + 4, 0, 100);
    logLine("【保研】材料完善。");
  } else if (action.id === "pg_contact2") {
    state.actionsLeft -= 1;
    pg.contact = clamp(pg.contact + 4, 0, 100);
    logLine("【保研】导师联系度提升。");
  } else if (action.id === "pg_interview2") {
    state.actionsLeft -= 1;
    pg.interview = clamp(pg.interview + 4, 0, 100);
    applyEffects({ stress: +3 });
    logLine("【保研】面试准备提升。");
  } else if (action.id === "pg_submit") {
    if (!openPgPrepushSelect(pg)) {
      logLine("【保研】仅第4周可提交预推免/补录。");
    }
  }
}

function tickPg() {
  if (getActiveRoute() !== "pg") return;
  ensurePgEnabledIfNeeded();
  const pg = state.branches?.pg;
  if (!pg) return;
  const termIdx = getCurrentTermIndex();
  const forceFinalize = termIdx === 7 && state.week === 5;
  if (!pg.enabled && !forceFinalize) return;
  pg.flags = pg.flags || {};
  pg.baseProfile = calcPgBaseProfile();
  if (termIdx === 7 && isPgCenterTime()) {
    pg.flags.pgWeekNoted = pg.flags.pgWeekNoted || {};
    if (!pg.flags.pgWeekNoted[state.week]) {
      const tips = {
        1: "第1周：窗口开启（剩余4周），建议至少提交1次预推免/补录。",
        2: "第2周：结果开始回流，候补可通过联系导师/准备面试逆转。",
        3: "第3周：最后冲刺周，未提交/无候补风险极高。",
        4: "第4周：最后一周，周末强制结算。"
      };
      if (tips[state.week]) pg.inbox.push(`【保研】${tips[state.week]}`);
      pg.flags.pgWeekNoted[state.week] = true;
    }
  }
  const now = absWeekIndex();
  const nextQueue = [];
  for (const item of pg.queue) {
    if (!forceFinalize && item.dueWeek > now) { nextQueue.push(item); continue; }
    if (item.type === "pg_prepush" || item.type === "pg_result") {
      resolvePgPrepush(pg, item.univId || getPgActiveUnivId(pg));
    } else {
      nextQueue.push(item);
    }
  }
  pg.queue = nextQueue;
  if (forceFinalize) finalizePgTerm7(pg);
}

function updateRouteCenterButtons() {
  ensureJobCenterButton();
  ensureKaoyanCenterButton();
  ensureAbroadCenterButton();
  ensureGongkaoCenterButton();
  ensurePgCenterButton();
}

function renderActions() {
  clear(ui.actionPanel);

  if (!state.started) {
    ui.actionPanel.innerHTML = `<div class="hint">请先在“概览”完成选择并点击“开始”。</div>`;
    setText(ui.txtActionsLeft, "");
    return;
  }

  if (isSuspendedActive()) {
    const actions = [
      { id: "leave_consult", name: "心理咨询/治疗", effects: { stress: -12, mood: +2 } },
      { id: "leave_routine", name: "规律作息/运动", effects: { stress: -10, energy: +6 } },
      { id: "leave_social", name: "社交支持", effects: { stress: -8, social: +4, mood: +2 } },
      { id: "leave_hobby", name: "兴趣恢复", effects: { stress: -9, mood: +4 } },
      { id: "leave_work", name: "轻量兼职", effects: { money: randi(200, 400), stress: +2 } }
    ];
    if (state.actionsLeft <= 0) state.actionsLeft = 2;
    ui.actionPanel.innerHTML = "";
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = "休学中：本周可进行康复行动（每周2次）。";
    ui.actionPanel.appendChild(hint);
    const wrap = document.createElement("div");
    wrap.className = "btnRow";
    actions.forEach(a => {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = a.name;
      btn.disabled = state.actionsLeft <= 0;
      btn.addEventListener("click", () => {
        if (state.actionsLeft <= 0) return;
        const before = snapshotMainStats();
        state.actionsLeft -= 1;
        applyEffects(a.effects);
        const d = formatDeltaLine(before, snapshotMainStats());
        if (d) logLine(d);
        if (state.actionsLeft <= 0 && !state.eventPending) nextWeek();
        else render();
      });
      wrap.appendChild(btn);
    });
    ui.actionPanel.appendChild(wrap);
    setText(ui.txtActionsLeft, `本周剩余行动：${state.actionsLeft}/2`);
    return;
  }

  // 若事件还没处理，不允许行动
  if (state.eventPending) {
    ui.actionPanel.innerHTML = `<div class="hint">本周有事件待处理：请先做出选择。</div>`;
    setText(ui.txtActionsLeft, "");
    return;
  }

  const broke = Number(state.money || 0) <= 0;
  const forcedWork = state.flags && state.flags.forcedWorkThisWeek && (((state.weekActionCounts && state.weekActionCounts.work) || 0) === 0);
  if (broke) {
    ui.actionPanel.innerHTML = `<div class="hint">资金见底：本周只能选择【兼职】或【向家里要钱】。</div>`;
  }

  const actions = [
    {
      id: "study",
      name: "学习（推进4门+成绩预测）",
      do() {
        doStudyAction();
      }
    },
    {
      id: "research",
      name: "科研（+SCI概率）",
      do() {
        const before = snapshotMainStats();
        state.actionsLeft--;
        state.termResearch++;
        applyActionEffects("research");

        if (state.year < 2) {
          logLine("科研推进中：大一通常还出不了论文。");
          const d = formatDeltaLine(before, snapshotMainStats());
          if (d) logLine(d);
          return;
        }

        const luckEff = calcLuckEffective();
        // 调整科研权重，让社交影响更明显
        const p = clamp(
          0.005 + state.hiddenProfile.academicPower * 0.015 + luckEff * 0.006 + state.social * 0.0003 + state.termResearch * 0.002,
          0,
          0.08
        );

        if (Math.random() < p) {
          state.milestones.sci++;
          const authorRoll = Math.random();
          const author = authorRoll < 0.25 ? "一作" : (authorRoll < 0.7 ? "二作" : "三作");

          // 触发科研突破弹窗
          triggerSCIBreakthroughModal(author);

          if (author === "一作") {
            const noFail = !state.failedCourseIds || state.failedCourseIds.size === 0;
            // 【重要】保研资格判断，必须所有必修课都>=B 且无挂科/违纪
            const allRequiredB = state.flags?.allRequiredReachedB ?? false;
            const isGoodStanding = noFail && !state.disciplineFlag;

            if (allRequiredB && isGoodStanding && !state.flags.gotRecommendation) {
              state.flags.gotRecommendation = true;
              logLine("一作 SCI 且所有必修课≥B、无挂科/违纪：获得保研资格。");
            } else if (!allRequiredB) {
              logLine("一作 SCI，但仍有必修课未达 B：暂不具备保研资格。");
            } else if (!isGoodStanding) {
              logLine("一作 SCI，但存在挂科或违纪：暂不具备保研资格。");
            }
          }
        } else {
          logLine("你做了些科研推进：慢，但在动。");
        }

        const d = formatDeltaLine(before, snapshotMainStats());
        if (d) logLine(d);
      }
    },
    {
      id: "work",
      name: "兼职（+钱）",
      do() {
        const before = snapshotMainStats();
        state.actionsLeft--;
        const reward = Math.round(WORK_REWARD * (typeof getEffMult === 'function' ? getEffMult() : 1.0));
        applyActionEffects("work", { money: +reward, social: +1 });
        if (state.flags && state.flags.forcedWorkThisWeek && ((state.weekActionCounts && state.weekActionCounts.work) || 0) > 0) {
          state.flags.forcedWorkThisWeek = false;
          logLine("[断供] 本周已完成强制兼职。");
        }
        logLine(`兼职完成：获得 ${reward}（已按健康修正）。`);

        const d = formatDeltaLine(before, snapshotMainStats());
        if (d) logLine(d);
      }
    },
    {
      id: "party",
      name: "社交/聚会（+社交）",
      do() {
        const before = snapshotMainStats();
        state.actionsLeft--;
        applyActionEffects("party");
        logLine("你去社交了一波，认识了几个人。社交=概率论的样本量。");

        const d = formatDeltaLine(before, snapshotMainStats());
        if (d) logLine(d);
      }
    },
    {
      id: "rest",
      name: "休息（回血）",
      do() {
        const before = snapshotMainStats();
        state.actionsLeft--;
        applyActionEffects("rest", { note: "睡了一觉，世界看起来没那么糟（回血更明显）。" });
        logLine("你休息了一会儿。");

        const d = formatDeltaLine(before, snapshotMainStats());
        if (d) logLine(d);
      }
    },
    {
      id: "workout",
      name: "健身/运动（健康+）",
      do() {
        const before = snapshotMainStats();
        state.actionsLeft--;
        applyActionEffects("workout");
        logLine("你做了一次运动，身体更清爽了。");

        const d = formatDeltaLine(before, snapshotMainStats());
        if (d) logLine(d);
      }
    },

    {
      id: "askParents",
      name: "向家里要点钱",
      do() {
        const before = snapshotMainStats();
        const curMonth = absMonthIndex();
        if (state.parentsAskedAbsMonth === curMonth) {
          logLine("这个月你已经问过爸妈一次了（一个月只能要一次）。");
          return;
        }
        state.actionsLeft--;
        state.parentsAskedAbsMonth = curMonth;
        const amount = ASK_PARENTS_AMOUNT[state.family] || 0;
        if (amount <= 0) {
          applyEffects({ mood: -2, social: -1, note: "你想了想，还是算了。" });
        } else {
          applyEffects({ money: +amount, mood: +1, social: -1, note: `家里转来 ${amount} 元（也有点小愧疚）。` });
        }
        logLine("你联系了家里。");

        const d = formatDeltaLine(before, snapshotMainStats());
        if (d) logLine(d);
      }
    }
  ];

  for (const a of actions) {
    if (broke && a.id !== "work" && a.id !== "askParents") continue;
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = a.name;
    const askedThisMonth = (a.id === "askParents" && state.parentsAskedAbsMonth === absMonthIndex());
    const noEnergyExceptRest = state.energy <= 0 && a.id !== "rest";
    btn.disabled = state.actionsLeft <= 0 || askedThisMonth || noEnergyExceptRest;
    if (forcedWork && a.id !== "work") {
      btn.disabled = true;
      btn.title = "Forced work this week: do one work action first.";
    }
    if (askedThisMonth) btn.title = "本月已问过一次";
    if (noEnergyExceptRest) btn.title = "精力值为0，只能选择休息";
    btn.addEventListener("click", () => {
      if (state.actionsLeft <= 0) return;
      if (state.energy <= 0 && a.id !== "rest") {
        logLine("精力值为0，只能选择休息");
        return;
      }
      a.do();

      // 一周 3 次行动用完后自动进入下一周
      if (state.actionsLeft <= 0 && !state.eventPending) {
        logLine("本周 3 次行动已用完：自动进入下一周。");
        nextWeek();
        return;
      }

      render();
    });
    ui.actionPanel.appendChild(btn);
  }

  setText(ui.txtActionsLeft, `本周剩余行动：${state.actionsLeft}/${ACTIONS_PER_WEEK}`);
  updateRouteCenterButtons();

  if (getActiveRoute() === "pg") {
    const pg = state.branches?.pg;
    if (pg && isPgCenterTime() && state.week === 4 && state.actionsLeft === 1 && !(pg.flags && pg.flags.prepushSubmitted)) {
      pg.flags = pg.flags || {};
      if (pg.flags.prepushAutoPromptedWeek !== state.week) {
        pg.flags.prepushAutoPromptedWeek = state.week;
        setTimeout(() => { openPgPrepushSelect(pg); }, 0);
      }
    }
  }
}


const ENDING_CATALOG = [
  { id: "pushmian_success", title: "保研上岸", hint: "保研路线：最终资格通过并确认去向", priority: 10 },
  { id: "pushmian_setback", title: "保研受挫", hint: "保研路线：最终资格未通过或offer撤回", priority: 10 },
  { id: "pushmian_phd", title: "直博邀请", hint: "保研路线：获得「直博邀请」徽章", priority: 100 },
  { id: "job_offer", title: "就业上岸", hint: "就业路线：结算非fail", priority: 10 },
  { id: "job_struggle", title: "就业艰难", hint: "就业路线：结算为fail", priority: 10 },
  { id: "job_spp", title: "大厂SPP", hint: "就业路线：终局阶段获得「大厂SPP」徽章", priority: 90 },
  { id: "job_founder", title: "合伙创业", hint: "就业路线：终局阶段获得「合伙邀约」徽章", priority: 80 },
  { id: "overseas_admit", title: "出国录取", hint: "出国路线：结算非fail", priority: 10 },
  { id: "overseas_setback", title: "出国受挫", hint: "出国路线：结算为fail", priority: 10 },
  { id: "overseas_ra", title: "奖学金/RA", hint: "出国路线：录取阶段获得「奖学金」徽章", priority: 70 },
  { id: "overseas_toplab", title: "顶级实验室", hint: "出国路线：终局阶段获得「顶级实验室」徽章", priority: 80 },
  { id: "postgrad_pass", title: "考研上岸", hint: "考研路线：结算pass", priority: 10 },
  { id: "postgrad_fail", title: "考研失利", hint: "考研路线：结算fail", priority: 10 },
  { id: "postgrad_985", title: "一战上岸", hint: "考研路线：初次上岸获得「一战上岸」徽章", priority: 70 },
  { id: "postgrad_second", title: "二战逆袭", hint: "考研路线：复盘后逆袭获得「二战逆袭」徽章", priority: 60 },
  { id: "civil_pass", title: "考公上岸", hint: "考公路线：结算pass", priority: 10 },
  { id: "civil_fail", title: "考公失利", hint: "考公路线：结算fail", priority: 10 },
  { id: "civil_provincial", title: "省考上岸", hint: "考公路线：省考节点获得「省考上岸」徽章", priority: 60 },
  { id: "civil_stable", title: "稳定之选", hint: "考公路线：终局阶段获得「稳定之选」徽章", priority: 50 }
];

function renderSeasonPanel() {
  if (!ui.seasonSummary) return;
  ensureSeasonState();
  const activeRoute = getActiveRoute();
  const routeName = ROUTE_NAMES[activeRoute] || "未选择";
  const abs = absWeekIndex();
  setText(ui.seasonSummary, `当前路线：${routeName}；当前周：${abs}`);

  const seasonLines = [];
  for (const route of ["pushmian", "job", "overseas", "postgrad", "civil"]) {
    const s = getSeason(route);
    const status = s.unlocked ? "已解锁" : "未解锁";
    seasonLines.push(`${ROUTE_NAMES[route]}：${status} / 阶段${s.stage} / 资源${s.tokens}`);
  }
  ui.seasonList.innerHTML = seasonLines.length ? seasonLines.join("<br>") : "暂无赛季信息。";

  const badgeLines = [];
  for (const route of ["pushmian", "job", "overseas", "postgrad", "civil"]) {
    const s = getSeason(route);
    if (s.badges && s.badges.length) {
      badgeLines.push(`${ROUTE_NAMES[route]}：${s.badges.join("、")}`);
    }
  }
  ui.seasonBadges.innerHTML = badgeLines.length ? badgeLines.join("<br>") : "暂无徽章。";

  const offerLines = (state.offers || []).map(o => {
    const routeName = ROUTE_NAMES[o.kind] || o.kind || "offer";
    const company = o.company || o.name || "";
    const tier = o.tier ? ` / ${o.tier}` : "";
    const status = o.status || "unknown";
    return company ? `${company} / ${routeName}${tier} / ${status}` : `${routeName}${tier} / ${status}`;
  });
  ui.seasonOffers.innerHTML = offerLines.length ? offerLines.join("<br>") : "暂无offer。";

  if (ui.seasonTodo && ui.btnRouteTodo) {
    const ready = !!(state.flags && state.flags.routeChoiceReady);
    if (!state.route && ready) {
      setText(ui.seasonTodo, "待办：请尽快选择毕业去向路线（成绩已出）。");
      ui.btnRouteTodo.style.display = "";
    } else if (state.route) {
      setText(ui.seasonTodo, `已选择路线：${ROUTE_NAMES[state.route] || state.route}`);
      ui.btnRouteTodo.style.display = "none";
    } else {
      setText(ui.seasonTodo, "");
      ui.btnRouteTodo.style.display = "none";
    }
  }

  const endingLines = ENDING_CATALOG.map(e => {
    const unlocked = state.endingUnlocked && state.endingUnlocked[e.id];
    return unlocked ? `[x] ${e.title}` : `[ ] ${e.title}（提示：${e.hint}）`;
  });
  ui.endingList.innerHTML = endingLines.join("<br>");
}

function render() {
  renderMeta();
  renderBars();
  renderCourseList();
  // 确保结束本周按钮状态与当前行动/事件状态同步
  if (ui.btnNextWeek) {
    ui.btnNextWeek.disabled = state.actionsLeft > 0 || !!state.eventPending || !!state.cetExamPending;
    ui.btnNextWeek.title = state.actionsLeft > 0 ? `本周还有 ${state.actionsLeft} 次行动，无法结束本周` : "结束本周";
  }
  renderCerts();
  renderActions();
  renderGradeList();
  renderSeasonPanel();
}

/* ========== 事件系统（弹窗） ========== */
function absWeekIndex() {
  // 绝对周：用于 cooldown
  return (state.year - 1) * TERMS_PER_YEAR * TERM_WEEKS + (state.term - 1) * TERM_WEEKS + state.week;
}

function getAbsWeek() {
  return absWeekIndex();
}

function isSuspendedActive() {
  const until = state.status && state.status.suspendedUntilAbsWeek;
  if (!until) return false;
  return absWeekIndex() <= until;
}

function setSuspensionWeeks(weeks, reason) {
  const w = Math.max(0, Number(weeks) || 0);
  if (!w) return;
  const abs = absWeekIndex();
  state.status = state.status || {};
  state.flags = state.flags || {};
  state.flags.suspendedEver = true;
  state.status.leaveCount = (state.status.leaveCount || 0) + 1;
  state.status.suspendedUntilAbsWeek = abs + w - 1;
  state.actionsLeft = 0;
  logLine(`【休学】已进入休学期（${w}周）${reason ? "：" + reason : ""}`);
}

function handleLeaveRecoveryIfNeeded() {
  const until = state.status && state.status.suspendedUntilAbsWeek;
  if (!until) return;
  const abs = absWeekIndex();
  if (abs !== until + 1) return;
  if (state.status && state.status.leaveRecoveredAtAbsWeek === abs) return;
  state.status.leaveRecoveredAtAbsWeek = abs;
  if (Number(state.stress || 0) > 60) {
    setSuspensionWeeks(TERM_WEEKS, "恢复未达安全线，延长休学");
    logLine("【心理健康】恢复未达安全线（≤60），休学延长一学期。");
    state.actionsLeft = 2;
    return true;
  }
  applyEffects({ stress: -10, mood: +3 });
  state.status.postLeaveBuffWeeks = 14;
  logLine("【心理健康】复学缓冲：压力-10，心情+3（14周内压力增长-1）。");
  return false;
}

function logStressWarningsIfNeeded() {
  const stress = Number(state.stress || 0);
  const abs = absWeekIndex();
  state.flags = state.flags || {};
  if (state.flags.lastStressWarnAbsWeek === abs) return;
  let msg = "";
  if (stress >= 88) {
    msg = `【严重预警】距离自动休学仅剩 ${Math.max(0, 90 - stress)} 点压力。建议立刻休息或降低高压行动。`;
  } else if (stress >= 85) {
    msg = "【预警】压力接近休学阈值（90）。若继续升高，将自动进入休学康复期。";
  } else if (stress >= 80) {
    msg = "【预警】压力已偏高（80+），建议本周至少安排一次休息/低压活动。";
  }
  if (msg) {
    state.flags.lastStressWarnAbsWeek = abs;
    logLine(msg);
  }
}

function isStressRiskActive() {
  const until = state.status && state.status.stressRiskUntilAbsWeek;
  if (!until) return false;
  return absWeekIndex() <= until;
}

function setStressRiskWeeks(weeks) {
  const w = Math.max(0, Number(weeks) || 0);
  if (!w) return;
  const abs = absWeekIndex();
  state.status = state.status || {};
  state.status.stressRiskUntilAbsWeek = abs + w - 1;
}

function pickWeeklyEvent() {
  if (!window.EVENTS || !window.eventMatchesState) return null;
  ensureSeasonState();

  const absWeek = absWeekIndex();

  // 过滤 gate + cooldown
  const candidates = [];
  for (const ev of window.EVENTS) {
    if (!window.eventMatchesState(ev, state)) continue;

    const until = state.eventCooldownUntilAbsWeek[ev.id] || 0;
    if (absWeek <= until) continue;

    candidates.push(ev);
  }
  if (!candidates.length) return null;

  // 权重：社交高时，breakthrough 权重提高
  const social = Number(state.social || 50);
  const luckEff = calcLuckEffective();

  const weighted = candidates.map(ev => {
    let w = Number(ev.weight || 1);

    const tags = ev.tags || [];
    if (tags.includes("breakthrough")) {
      // 社交越高，越容易触发好事（你要的）
      if (social >= 60) w *= 1 + (social - 60) * 0.02; // 90 -> *1.6
    }

    if (isStressRiskActive()) {
      const riskTags = ["stress", "mood", "money"];
      if (riskTags.some(t => tags.includes(t))) {
        w *= PARAMS.severe.stress.riskWeightMult || 1.0;
      }
    }

    if (state.routeChoice && tags.includes(state.routeChoice)) {
      w *= PARAMS_V2.routeEventWeightMult[state.routeChoice] || 1.0;
    }

    // 运气也轻微影响（但别让它变成玄学作弊器）
    w *= 1 + clamp(luckEff, -2, 3) * 0.05;

    // 避免刚触发过的事件立刻再来
    if (state.recentEventIds.includes(ev.id)) w *= 0.25;

    return { ev, w: Math.max(0.01, w) };
  });

  const sum = weighted.reduce((s, x) => s + x.w, 0);
  let r = Math.random() * sum;
  for (const x of weighted) {
    r -= x.w;
    if (r <= 0) return x.ev;
  }
  return weighted[weighted.length - 1].ev;
}

function applySeasonOption(ev, opt) {
  if (!opt) return;
  const seasonCfg = opt.season || {};
  const route = seasonCfg.route || opt.route || ev.route || (ev.tags || []).find(t => state.seasons && state.seasons[t]);
  if (!route) return;
  ensureSeasonState();
  if (seasonCfg.unlock) unlockSeason(route, seasonCfg.stage || 1, seasonCfg.tokens || 0);
  if (seasonCfg.stage) setSeasonStage(route, seasonCfg.stage);
  if (typeof seasonCfg.tokens === "number") addSeasonTokens(route, seasonCfg.tokens);
  if (seasonCfg.badge) awardBadge(route, seasonCfg.badge);
  if (Array.isArray(seasonCfg.badges)) {
    seasonCfg.badges.forEach(name => awardBadge(route, name));
  }
  if (seasonCfg.deadlineAbsWeek) {
    const s = getSeason(route);
    s.deadlineAbsWeek = seasonCfg.deadlineAbsWeek;
  }
}

function applyOfferOption(opt) {
  if (!opt || !opt.offer) return;
  const offer = opt.offer;
  if (offer.kind === "pushmian" && (offer.status === "intent" || offer.status === "conditional") && offer.autoTier) {
    createPushmianOffer(offer.status, offer.source, offer.note);
    return;
  }
  addOffer(offer);
}

function expireOffers(filter) {
  const cfg = filter || {};
  const kind = cfg.kind || null;
  const statusIn = cfg.statusIn || null;
  let changed = 0;
  for (const o of (state.offers || [])) {
    if (kind && o.kind !== kind) continue;
    if (statusIn && !statusIn.includes(o.status)) continue;
    o.status = "expired";
    changed += 1;
  }
  if (changed > 0) {
    logLine(`[OFFER] expire kind=${kind || "any"} count=${changed}`);
  }
}

function openEventModal(ev) {
  state.eventPending = true;
  state.pendingEvent = ev;

  setText(ui.evTitle, ev.title || "事件");
  setText(ui.evText, ev.text || "");
  clear(ui.evOptions);
  setText(ui.evHint, "请选择一个选项。");

  (ev.options || []).forEach((optRaw) => {
    // 支持动态选项：{ build: () => ({ text, effects }) }
    const opt = (optRaw && typeof optRaw.build === "function") ? optRaw.build() : optRaw;
    if (!opt) return;

    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = opt.text;
    if (opt.disabled) {
      btn.disabled = true;
      if (opt.disabledHint) btn.title = opt.disabledHint;
      ui.evOptions.appendChild(btn);
      return;
    }
    btn.addEventListener("click", () => {
      const before = snapshotMainStats();

      // 先记日志，再改数值（读起来更顺）
      logLine(`【事件】你选择了：${opt.text}`);

      // 应用 effects
      applyEffects(opt.effects);
      if (opt.evidence) {
        addEvidence(opt.evidence);
      }
      applySeasonOption(ev, opt);
      applyOfferOption(opt);
      if (opt.expireOffers) expireOffers(opt.expireOffers);
      if (typeof opt.onSelect === "function") {
        opt.onSelect();
      }

      // cooldown
      const cd = Number(ev.cooldownWeeks || 0);
      if (cd > 0) state.eventCooldownUntilAbsWeek[ev.id] = absWeekIndex() + cd;

      // recent
      state.recentEventIds.push(ev.id);
      if (state.recentEventIds.length > 10) state.recentEventIds.shift();

      // close
      state.eventPending = false;
      state.pendingEvent = null;
      ui.modalEvent.classList.add("hidden");

      const d = formatDeltaLine(before, snapshotMainStats());
      if (d) logLine(d);
      render();
    });
    ui.evOptions.appendChild(btn);
  });

  ui.modalEvent.classList.remove("hidden");
}

function openGradeReminderModal() {
  if (!state.lastTermReport) return;

  state.eventPending = true;
  state.pendingEvent = { id: "GRADE_REMINDER" };

  setText(ui.evTitle, "期末成绩提醒");
  ui.evText.innerHTML = `${state.lastTermReport.header}<br>${state.lastTermReport.summary}<br>成绩表已更新，可在“课程/成绩”里查看。`;
  clear(ui.evOptions);
  setText(ui.evHint, "点击确认继续本周行动。");

  const btn = document.createElement("button");
  btn.className = "btn primary";
  btn.textContent = "知道了";
  btn.addEventListener("click", () => {
    state.eventPending = false;
    state.pendingEvent = null;
    ui.modalEvent.classList.add("hidden");
    if (shouldOpenRouteChoice()) {
      openRouteChoiceModal();
      return;
    }
    render();
  });
  ui.evOptions.appendChild(btn);

  ui.modalEvent.classList.remove("hidden");
}

function ensureWeeklyEvent() {
  if (!state.started) return;
  if (state.eventPending) return;

  const ev = pickWeeklyEvent();
  if (!ev) return;

  openEventModal(ev);
}

/* ========== 选课：自动培养方案 ========== */
function autoPlanThisTerm() {
  if (!state.curriculumPlan) return;

  const termIndex = getCurrentTermIndex();
  const ids = state.curriculumPlan.planByTerm[termIndex] || [];
  const pool = state.allCoursesPool || state.curriculumPlan.coursePool || [];
  const planIdSet = new Set(ids);

  // 强制课由 ensureMandatoryCoursesForTerm 负责加入
  ensureMandatoryCoursesForTerm(termIndex);

  const recommendedCurrent = [];
  const recommendedRetake = [];
  const recommendedOverdue = [];
  const usedIds = new Set((state.termSelectedCourses || []).map(c => c.id));
  const seen = new Set();

  const sortRecommended = (list) => list
    .sort((a, b) => {
      const ta = Number(a.suggestedTerm || a.term || 0);
      const tb = Number(b.suggestedTerm || b.term || 0);
      if (ta != tb) return ta - tb;
      const da = Number(a.difficulty ?? 3);
      const db = Number(b.difficulty ?? 3);
      if (da != db) return da - db;
      return String(a.name).localeCompare(String(b.name));
    });

  const pushRec = (list, course, group) => {
    if (!course || seen.has(course.id)) return;
    computeDifficulty(course);
    list.push({ ...course, _recGroup: group });
    seen.add(course.id);
  };

  // 先把需要重修的课程加入推荐（重修优先），前提是本学期允许重修
  const failingIds = state.failedCourseIds ? Array.from(state.failedCourseIds) : [];
  for (const id of failingIds) {
    if (!isRetakeTerm(id)) continue;
    if (usedIds.has(id)) continue;
    const course = pool.find(x => x.id === id);
    if (!course) continue;
    const check = canSelectCourse(course);
    if (!check.allowed) continue;
    pushRec(recommendedRetake, { ...course, _retake: true }, "retake");
  }

  // 将培养方案中本学期的课程加入推荐候选（跳过已选与锁定课程）
  for (const id of ids) {
    if (usedIds.has(id)) continue;
    const course = pool.find(x => x.id === id);
    if (!course) continue;
    if (isLockedCourseThisTerm(id)) continue;
    const check = canSelectCourse(course);
    if (!check.allowed) continue;
    pushRec(recommendedCurrent, course, "current");
  }

  // 将“推荐学期 = 本学期”的课程加入推荐，保证本学期推荐完整
  for (const course of pool) {
    if (!course) continue;
    if (usedIds.has(course.id)) continue;
    if (isLockedCourseThisTerm(course.id)) continue;
    const suggestedTerm = Number(course.suggestedTerm || course.term || 0);
    if (suggestedTerm !== termIndex) continue;
    const check = canSelectCourse(course);
    if (!check.allowed) continue;
    pushRec(recommendedCurrent, course, "current");
  }

  // 逾期补修：推荐学期早于本学期且未完成/未挂科重修的课程
  for (const course of pool) {
    if (!course) continue;
    if (usedIds.has(course.id)) continue;
    if (isLockedCourseThisTerm(course.id)) continue;
    if (state.failedCourseIds && state.failedCourseIds.has(course.id)) continue;
    const suggestedTerm = Number(course.suggestedTerm || course.term || 0);
    if (!suggestedTerm || suggestedTerm >= termIndex) continue;
    const check = canSelectCourse(course);
    if (!check.allowed) continue;
    pushRec(recommendedOverdue, course, "overdue");
  }

  const currentSorted = sortRecommended(recommendedCurrent);
  const retakeSorted = sortRecommended(recommendedRetake);
  const overdueSorted = sortRecommended(recommendedOverdue);

  state.recommendedCoursesThisTerm = {
    current: currentSorted,
    retake: retakeSorted,
    overdue: overdueSorted
  };

  const total = currentSorted.length + retakeSorted.length + overdueSorted.length;
  if (total) {
    logLine(`已生成本学期推荐（term=${termIndex}）：${total} 门`);
  }

  rebuildStudyQueue();
  render();
}

function onAutoPlanClick() {
  if (!state.academy || !state.family) {
    logLine("请先选择学院与家境，然后重试。正在切换到概览页。");
    setTab("tabOverview");
    return;
  }
  if (!state.curriculumPlan || !state.curriculumPlan.planByTerm) {
    logLine("未生成培养方案：无法自动选课，请先生成培养方案。");
    return;
  }

  const termIndex = getCurrentTermIndex();
  const target = state.curriculumPlan.termTargetCredits?.[termIndex] || 20;
  const ids = state.curriculumPlan.planByTerm?.[termIndex] || [];
  const pool = state.allCoursesPool || state.curriculumPlan.coursePool || [];

  // 若自动加入时出现冲突，会记录冲突数并在日志中提示
  ensureMandatoryCoursesForTerm(termIndex);

  const existingIds = new Set((state.termSelectedCourses || []).map(c => c.id));
  const usedSlots = new Set();
  for (const c of state.termSelectedCourses || []) {
    if (!c.timeslots || c.timeslots.length === 0) {
      assignRandomSlot(c, usedSlots, true);
    } else {
      c.timeslots.forEach(slot => usedSlots.add(slot));
    }
  }

  let addedCount = 0;
  let conflictCount = 0;
  const addedIds = [];

  const candidates = [];
  const candidateIds = new Set();
  const failingIds = state.failedCourseIds ? Array.from(state.failedCourseIds) : [];
  for (const id of failingIds) {
    if (!isRetakeTerm(id)) continue;
    const course = pool.find(x => x.id === id);
    if (!course) continue;
    const check = canSelectCourse(course);
    if (check.allowed && !candidateIds.has(course.id)) {
      candidates.push(course);
      candidateIds.add(course.id);
    }
  }

  for (const id of ids) {
    const course = pool.find(x => x.id === id);
    if (!course) continue;
    if (isLockedCourseThisTerm(id)) continue;
    const check = canSelectCourse(course);
    if (check.allowed && !candidateIds.has(course.id)) {
      candidates.push(course);
      candidateIds.add(course.id);
    }
  }

  // 本学期推荐（推荐学期=本学期）+ 逾期补修（推荐学期 < 本学期）
  for (const course of pool) {
    if (!course) continue;
    const suggestedTerm = Number(course.suggestedTerm || course.term || 0);
    if (!suggestedTerm) continue;
    if (suggestedTerm > termIndex) continue;
    if (isLockedCourseThisTerm(course.id)) continue;
    if (state.failedCourseIds && state.failedCourseIds.has(course.id)) continue;
    const check = canSelectCourse(course);
    if (check.allowed && !candidateIds.has(course.id)) {
      candidates.push(course);
      candidateIds.add(course.id);
    }
  }

  for (const course of candidates) {
    if (existingIds.has(course.id)) continue;
    const slotRes = assignRandomSlot(course, usedSlots, false);
    if (!slotRes.assigned) {
      conflictCount += 1;
      continue;
    }
    state.termSelectedCourses.push(course);
    existingIds.add(course.id);
    addedCount += 1;
    addedIds.push(course.id);
  }

  const currentCredits = (state.termSelectedCourses || []).reduce((s, c) => s + (Number(c.credits) || 0), 0);
  logLine(`自动选课结果（term=${termIndex}）：新增 ${addedCount} 门，冲突 ${conflictCount} 门，当前学分 ${currentCredits}/${target}`);

  if (conflictCount > 0) {
    logLine(`检测到 ${conflictCount} 个冲突，部分课程未能自动排入时刻表。`);
  }

  rebuildStudyQueue();
  render();
}

function openAddDropModal() {
  if (!state.curriculumPlan) return;

  state.addDropShownThisTerm = true;

  const pool = state.allCoursesPool;
  const failingIds = state.failedCourseIds ? Array.from(state.failedCourseIds) : [];

  function renderModal() {
    clear(ui.adCurrent);
    clear(ui.adPool);

    const picked = state.termSelectedCourses.slice();
    const pickedIds = new Set(picked.map(c => c.id));

    // 当前已选
    for (const c of picked) {
      const row = document.createElement("div");
      row.className = "line";

      const locked = isLockedCourseThisTerm(c.id);
      const retake = failingIds.includes(c.id) && isRetakeTerm(c.id); // 检查是否是重修课
      const slot = (c.timeslots || []).join(", ");
      const suggested = (c.suggestedTerm != null) ? `推荐第${c.suggestedTerm}学期` : "推荐学期未知";

      row.innerHTML = `
        <div class="courseInfo">
          <div class="courseTitle"><b>${c.name}</b>
            ${retake ? `<span class="badge lock">重修</span>` : ""}
            ${locked ? `<span class="badge lock">强制</span>` : ""}
          </div>
          <div class="courseMeta">${c.credits}学分 · 上课：${slot} · <span class="termTag">${suggested}</span></div>
        </div>`;

      const btn = document.createElement("button");
      btn.className = "btn adBtn";
      btn.textContent = locked ? "不可退" : "退课";
      btn.disabled = locked;
      btn.addEventListener("click", () => {
        if (locked) return;
        state.termSelectedCourses = state.termSelectedCourses.filter(x => x.id !== c.id);
        rebuildStudyQueue();
        renderModal();
        render();
      });

      row.appendChild(document.createElement("span")).className = "sep";
      row.appendChild(btn);
      ui.adCurrent.appendChild(row);
    }

    // 可选课程池（本学期）：按硬规则过滤
    const candidates = pool
      .filter(c => {
        const check = canSelectCourse(c);
        return check.allowed;
      })
      .sort((a, b) => (a.suggestedTerm - b.suggestedTerm) || (a.difficulty - b.difficulty));

    for (const c of candidates) {
      const row = document.createElement("div");
      row.className = "line";

      const retake = failingIds.includes(c.id) && isRetakeTerm(c.id);
      const slot = (c.timeslots || []).join(", ");
      const suggested = (c.suggestedTerm != null) ? `推荐第${c.suggestedTerm}学期` : "推荐学期未知";

      row.innerHTML = `
        <div class="courseInfo">
          <div class="courseTitle"><b>${c.name}</b>
            ${retake ? `<span class="badge lock">重修</span>` : ""}
          </div>
          <div class="courseMeta">${c.credits}学分 · 难度${c.difficulty} · 上课：${slot} · <span class="termTag">${suggested}</span></div>
        </div>`;

      const addBtn = document.createElement("button");
      addBtn.className = "btn primary adBtn";
      addBtn.textContent = "加课";

      // 检测冲突：与当前已选任意课冲突则禁用
      const wouldConflict = state.termSelectedCourses.some(x => courseConflicts(x, c));
      if (wouldConflict) {
        addBtn.disabled = true;
        addBtn.textContent = "冲突";
      }

      addBtn.addEventListener("click", () => {
        if (wouldConflict) return;
        // 再次检查硬规则（以防状态变化）
        const check = canSelectCourse(c);
        if (!check.allowed) {
          logLine(`⚠️ 无法添加课程 ${c.name}：${check.reason}`);
          renderModal(); // 重新渲染以更新状态
          return;
        }
        state.termSelectedCourses.push(c);
        rebuildStudyQueue();
        renderModal();
        render();
      });

      row.appendChild(document.createElement("span")).className = "sep";
      row.appendChild(addBtn);
      ui.adPool.appendChild(row);
    }

    const credits = state.termSelectedCourses.reduce((s, c) => s + (Number(c.credits) || 0), 0);
    const conflict = anyConflict(state.termSelectedCourses);

    const tip = [
      `本学期已选 ${state.termSelectedCourses.length} 门课，总学分 ${credits}（目标 ${state.curriculumPlan.termTargetCredits[getCurrentTermIndex()]}）。`,
      conflict ? "⚠️ 当前存在时间冲突：点击右上角【自动排冲突】。" : "✅ 当前无时间冲突。"
    ].join("\n");

    setText(ui.adHint, tip);
  }

  // 自动排冲突：从“非强制课”里删到不冲突
  ui.btnResolveConflicts.onclick = () => {
    let safety = 0;
    while (anyConflict(state.termSelectedCourses) && safety < 50) {
      safety++;

      let removed = false;
      for (let i = 0; i < state.termSelectedCourses.length; i++) {
        for (let j = i + 1; j < state.termSelectedCourses.length; j++) {
          const a = state.termSelectedCourses[i];
          const b = state.termSelectedCourses[j];
          if (!courseConflicts(a, b)) continue;

          const aLocked = isLockedCourseThisTerm(a.id);
          const bLocked = isLockedCourseThisTerm(b.id);

          // 都锁：没法自动解决
          if (aLocked && bLocked) {
            logLine("⚠️ 冲突发生在两门强制课之间（理论上不会）：需要检查 course.js 的排课。");
            removed = true;
            break;
          }

          // 选择要删的那个：优先删非强制；两者都非强制时删难度更高的
          let drop = null;
          if (aLocked) drop = b;
          else if (bLocked) drop = a;
          else drop = (a.difficulty >= b.difficulty) ? a : b;

          state.termSelectedCourses = state.termSelectedCourses.filter(x => x.id !== drop.id);
          logLine(`【退补选】为解决冲突，自动退掉：${drop.name}`);
          rebuildStudyQueue();
          removed = true;
          break;
        }
        if (removed) break;
      }
      if (!removed) break;
    }

    renderModal();
    render();
  };

  renderModal();
  ui.modalAddDrop.classList.remove("hidden");
}

/* ========== 期末结算 ========== */
// 期末结算：只结算 termSelectedCourses

function showTermEvidenceSummary(term, year) {
  const entries = (state.evidenceLog || []).filter(e => e.term === term && e.year === year);
  if (!entries.length) return;
  const maxShow = PARAMS_V2.evidence.showPerTerm || 5;
  const negativeTags = new Set(PARAMS_V2.evidence.negativeTags || []);
  const sorted = entries.slice().sort((a, b) => (Number(b.weight || 0) - Number(a.weight || 0)));
  const picks = [];
  const used = new Set();

  const addPick = (e) => {
    if (!e) return;
    const key = `${e.absWeek}|${e.title}`;
    if (used.has(key)) return;
    used.add(key);
    picks.push(e);
  };

  for (const e of sorted) {
    if (picks.length >= 3) break;
    addPick(e);
  }

  const negative = sorted.find(e => (e.tags || []).some(t => negativeTags.has(t)));
  addPick(negative);

  const checkpoint = sorted.find(e => e.type === "checkpoint" || e.type === "milestone" || e.type === "offer" || (e.meta && (e.meta.offerId || e.meta.route)));
  addPick(checkpoint);

  for (const e of sorted) {
    if (picks.length >= maxShow) break;
    addPick(e);
  }

  logLine(`Term summary: year=${year} term=${term}`);
  for (const e of picks.slice(0, maxShow)) {
    const tagText = (e.tags && e.tags.length) ? ` [${e.tags.join("·")}]` : "";
    logLine(`- ${e.title}${tagText}`);
  }
}


function calcCumulativeGPA() {
  if (state.testGPA != null) return Number(state.testGPA) || 0;
  let sumCredits = 0;
  let sumGpaCredits = 0;
  for (const term of (state.gradeHistory || [])) {
    for (const course of (term.courses || [])) {
      const credits = Number(course.credits || 0);
      const gpa = Number(course.gpa || 0);
      sumCredits += credits;
      sumGpaCredits += gpa * credits;
    }
  }
  return sumCredits > 0 ? (sumGpaCredits / sumCredits) : 0;
}

function calcWeightedScore(weights) {
  let score = 0;
  for (const k of Object.keys(weights || {})) {
    const w = Number(weights[k] || 0);
    const v = Number(state.hiddenProfile[k] || 0);
    score += w * v;
  }
  return score;
}

function pickTierByScore(tiers, score, field) {
  const sorted = (tiers || []).slice().sort((a, b) => b.minScore - a.minScore);
  for (const t of sorted) {
    if (score >= t.minScore) return t[field];
  }
  return null;
}

function resolveJobOutcome() {
  const score = calcWeightedScore(PARAMS_V2.job.weights);
  const result = pickTierByScore(PARAMS_V2.job.tiers, score, "result") || "fail";
  state.outcomes.job = result;
  return { result, score };
}

function resolveOverseasOutcome() {
  const cfg = PARAMS_V2.overseas;
  if ((state.hiddenProfile.englishPower || 0) < cfg.hard.englishMin) {
    state.outcomes.overseas = "fail";
    return { result: "fail", score: 0 };
  }
  const score = calcWeightedScore(cfg.weights);
  const result = pickTierByScore(cfg.tiers, score, "result") || "fail";
  state.outcomes.overseas = result;
  return { result, score };
}

function resolvePostgradOutcome() {
  const cfg = PARAMS_V2.postgrad;
  const score = calcWeightedScore(cfg.weights);
  const result = score >= (cfg.passScore || 60) ? "pass" : "fail";
  state.outcomes.postgrad = result;
  return { result, score };
}

function resolveCivilOutcome() {
  const cfg = PARAMS_V2.civil;
  const score = calcWeightedScore(cfg.weights);
  const result = score >= (cfg.passScore || 58) ? "pass" : "fail";
  state.outcomes.civil = result;
  return { result, score };
}

function handleJobOutcomeCheckpoint() {
  const out = resolveJobOutcome();
  const titleMap = {
    SSP_offer: "就业顶级offer。",
    SP_offer: "就业较好offer。",
    P_offer: "就业基础offer。",
    fail: "就业失败。"
  };
  const title = titleMap[out.result] || "就业结果。";
  addEvidence({
    type: "checkpoint",
    title,
    tags: ["job", out.result === "fail" ? "fail" : "offer"],
    deltas: { careerPower: out.result === "fail" ? -0.2 : +0.6, stability: out.result === "fail" ? -0.4 : +0.4 },
    weight: 5,
    meta: { route: "job" }
  });
  state.flags = state.flags || {};
  state.flags.jobFailed = (out.result === "fail");
  return out;
}

function handleOverseasOutcomeCheckpoint() {
  const out = resolveOverseasOutcome();
  const titleMap = {
    Top_overseas: "顶级出国录取。",
    Good_overseas: "较好出国录取。",
    Basic_overseas: "基础出国录取。",
    fail: "出国申请失败。"
  };
  const title = titleMap[out.result] || "出国结果。";
  addEvidence({
    type: "checkpoint",
    title,
    tags: ["overseas", out.result === "fail" ? "fail" : "admit"],
    deltas: { englishPower: out.result === "fail" ? -0.2 : +0.6, stability: out.result === "fail" ? -0.3 : +0.3 },
    weight: 5,
    meta: { route: "overseas" }
  });
  if (out.result !== "fail") {
    createOverseasOffer(out.result, "school");
  }
  state.flags = state.flags || {};
  state.flags.overseasFailed = (out.result === "fail");
  return out;
}

function handlePostgradOutcomeCheckpoint() {
  const out = resolvePostgradOutcome();
  const title = out.result === "pass" ? "考研上岸。" : "考研失利。";
  const tags = ["postgrad", out.result === "pass" ? "pass" : "fail"];
  if (out.result === "pass") {
    const badge = state.flags && state.flags.postgradRetried ? "二战逆袭" : "一战上岸";
    tags.push(badge);
    awardBadge("postgrad", badge);
  }
  addEvidence({
    type: "checkpoint",
    title,
    tags,
    deltas: { academicPower: out.result === "pass" ? +0.6 : -0.2, stability: out.result === "pass" ? +0.4 : -0.4 },
    weight: 5,
    meta: { route: "postgrad" }
  });
  state.flags = state.flags || {};
  state.flags.postgradFailed = (out.result === "fail");
  return out;
}

function handleCivilOutcomeCheckpoint() {
  const out = resolveCivilOutcome();
  const title = out.result === "pass" ? "考公上岸。" : "考公失利。";
  const tags = ["civil", out.result === "pass" ? "pass" : "fail"];
  if (out.result === "pass") {
    let badge = null;
    if (state.flags && state.flags.civilProvincialFocus) badge = "省考上岸";
    if (!badge && state.flags && state.flags.civilStableFocus) badge = "稳定之选";
    if (badge) {
      tags.push(badge);
      awardBadge("civil", badge);
    }
  }
  addEvidence({
    type: "checkpoint",
    title,
    tags,
    deltas: { stability: out.result === "pass" ? +0.6 : -0.2, luck: out.result === "pass" ? +0.2 : -0.2 },
    weight: 5,
    meta: { route: "civil" }
  });
  state.flags = state.flags || {};
  state.flags.civilFailed = (out.result === "fail");
  return out;
}



function addOffer(offer) {
  state.offers = state.offers || [];
  const o = Object.assign({}, offer);
  if (!o.id) o.id = `${o.kind || "offer"}_${absWeekIndex()}_${Math.random().toString(36).slice(2, 6)}`;
  state.offers.push(o);
  state.milestones = state.milestones || {};
  state.milestones.offers = (state.milestones.offers || 0) + 1;
  logLine(`[OFFER] add kind=${o.kind || "unknown"} status=${o.status || "unknown"} tier=${o.tier || "n/a"} id=${o.id}`);
  return o;
}

function createPushmianOffer(status, source, note) {
  const cfg = PARAMS_V2.pushmian;
  logLine(`[OFFER] createPushmianOffer status=${status} source=${source || "camp"}`);
  const pending = (state.offers || []).filter(o => o.kind === "pushmian" && (o.status === "intent" || o.status === "conditional")).length;
  if ((status === "intent" || status === "conditional") && pending >= cfg.maxPendingOffers) {
    logLine("[OFFER] 跳过 类型=pushmian 原因=达到上限");
    return null;
  }
  const score = calcWeightedScore(cfg.offerScoreWeights);
  const tier = pickTierByScore(cfg.tiers, score, "tier") || "rare";
  const offer = addOffer({
    kind: "pushmian",
    tier,
    status,
    source: source || "camp",
    expiresAbsWeek: absWeekIndex() + 8,
    note: note || ""
  });
  return offer;
}

function createOverseasOffer(result, source, note) {
  const tierMap = {
    Top_overseas: "top",
    Good_overseas: "good",
    Basic_overseas: "basic"
  };
  const tier = tierMap[result] || "basic";
  const hasExisting = (state.offers || []).some(o => o.kind === "overseas" && o.tier === tier && o.status === "direct");
  if (hasExisting) return null;
  logLine(`[OFFER] createOverseasOffer tier=${tier} source=${source || "school"}`);
  const offer = addOffer({
    kind: "overseas",
    tier,
    status: "direct",
    source: source || "school",
    expiresAbsWeek: absWeekIndex() + 12,
    note: note || ""
  });
  return offer;
}


function applyPushmianConfirm() {
  let converted = 0;
  for (const o of (state.offers || [])) {
    if (o.kind !== "pushmian") continue;
    if (o.status === "intent" || o.status === "conditional") {
      o.status = "direct";
      converted += 1;
    }
  }
  if (converted > 0) {
    logLine(`[OFFER] confirm kind=pushmian count=${converted}`);
  }
}

function applyPushmianFail() {
  let revoked = 0;
  for (const o of (state.offers || [])) {
    if (o.kind !== "pushmian") continue;
    if (o.status === "intent" || o.status === "conditional") {
      o.status = "revoked";
      revoked += 1;
    }
  }
  if (revoked > 0) {
    logLine(`[OFFER] revoke kind=pushmian count=${revoked}`);
    addEvidence({
      type: "checkpoint",
      title: "保研资格失败，offer被撤回。",
        tags: ["pushmian", "checkpoint", "confirmed"],
      deltas: { stability: -1.0 },
      weight: 5,
      meta: { route: "pushmian" }
    });
  }
}

function handlePushmianTermEnd() {
  const route = getActiveRoute();
  if (route && route !== "pg") return;
  const cfg = PARAMS_V2.pushmian;
  const absTerm = getCurrentTermIndex();
  const gpa = calcCumulativeGPA();
  if (absTerm === cfg.predictAtTermEnd) {
    if (gpa >= cfg.gpaThreshold) {
      state.track.pushmian.status = "predicted";
      state.track.pushmian.predictedAtTerm = absTerm;
      logLine(`[PUSHMIAN] predicted gpa=${gpa.toFixed(2)}`);
      unlockSeason("pushmian", 1, 2);
      addEvidence({
        type: "checkpoint",
        title: "通过保研预估资格判定。",
        tags: ["pushmian", "checkpoint", "pass"],
        deltas: { stability: +0.5, academicPower: +0.5 },
        weight: 4,
        meta: { route: "pushmian" }
      });
    } else {
      logLine(`[PUSHMIAN] predicted_failed gpa=${gpa.toFixed(2)}`);
    }
  }
  if (absTerm === cfg.finalAtTermEnd) {
    if (gpa >= cfg.gpaThreshold) {
      state.track.pushmian.status = "confirmed";
      state.track.pushmian.confirmedAtTerm = absTerm;
      logLine(`[PUSHMIAN] confirmed gpa=${gpa.toFixed(2)}`);
      setSeasonStage("pushmian", 3);
      addEvidence({
        type: "checkpoint",
        title: "通过保研最终资格判定。",
        tags: ["pushmian", "checkpoint", "pass"],
        deltas: { stability: +0.8, academicPower: +0.8 },
        weight: 5,
        meta: { route: "pushmian" }
      });
      applyPushmianConfirm();
    } else {
      state.track.pushmian.status = "failed";
      logLine(`[PUSHMIAN] failed gpa=${gpa.toFixed(2)}`);
      setSeasonStage("pushmian", 3);
      addEvidence({
        type: "checkpoint",
        title: "保研最终资格未通过。",
        tags: ["pushmian", "fail"],
        deltas: { stability: -0.8 },
        weight: 5,
        meta: { route: "pushmian" }
      });
      applyPushmianFail();
    }
  }
}

function buildFinalEvaluationText(summary) {
  const gradNeed = state.curriculumPlan?.graduateCredits || 160;
  const credits = Number(state.creditsEarned || 0);
  const gpa = calcCumulativeGPA();
  const offers = (state.offers || []).filter(o => o.kind === "job").length;
  const suspendedEver = !!(state.flags && state.flags.suspendedEver);
  const delayTerms = Number(state.delayTerms || 0);
  const leaveCount = Number(state.status?.leaveCount || 0);
  const overterm = !!(state.flags && state.flags.forcedOverterm);

  const lines = [];
  if (credits < gradNeed) {
    lines.push(`由于学分未修满（${credits}/${gradNeed}），你进入延毕状态，毕业结算以补修为前提。`);
  } else if (suspendedEver) {
    lines.push("你经历过休学调整，最终能回到轨道已是难得的韧性。");
  } else {
    lines.push(`你以“${summary.title}”结束大学阶段，路线为：${summary.routeName}。`);
  }

  if (overterm) lines.push("已超过最长在读年限，触发超期结算。");
  if (delayTerms > 0) lines.push(`毕业用时：延毕 ${delayTerms} 学期。`);
  if (leaveCount > 0) lines.push(`心理轨迹：休学 ${leaveCount} 次（回归型）。`);

  if (gpa >= 3.7) lines.push("学术表现拔尖，系统性与自律度很强。");
  else if (gpa >= 3.0) lines.push("学术表现稳定，基础能力扎实。");
  else lines.push("学术表现偏弱，但仍积累了关键经验。");

  if (offers >= 3) lines.push("就业收获多份 offer，竞争力与执行力突出。");
  else if (offers >= 1) lines.push("就业拿到 offer，关键节点的准备做得很到位。");
  else lines.push("就业结果有限，说明准备策略仍需优化。");

  return lines.join(" ");
}

function showFinalEvaluationModal(summary) {
  const text = buildFinalEvaluationText(summary);
  let modal = document.getElementById("finalEvalModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "finalEvalModal";
    Object.assign(modal.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(0,0,0,0.45)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: "10001"
    });
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.style.display = "none"; });
    document.body.appendChild(modal);
  }

  const panel = document.createElement("div");
  Object.assign(panel.style, {
    background: "#111827",
    color: "#e5e7eb",
    minWidth: "360px",
    maxWidth: "560px",
    padding: "18px",
    borderRadius: "10px",
    boxShadow: "0 10px 30px rgba(0,0,0,0.35)"
  });

  panel.innerHTML = `
    <div style="font-size:18px;font-weight:700;margin-bottom:8px;">最终评价</div>
    <div class="muted" style="line-height:1.6;margin-bottom:12px;">${text}</div>
    <button class="btn" id="finalEvalClose">关闭</button>
  `;

  modal.innerHTML = "";
  modal.appendChild(panel);
  modal.style.display = "flex";

  const closeBtn = panel.querySelector("#finalEvalClose");
  if (closeBtn) closeBtn.addEventListener("click", () => { modal.style.display = "none"; });
}

function showGraduationVerdict() {
  const entries = state.evidenceLog || [];
  const negativeTags = new Set(PARAMS_V2.evidence.negativeTags || []);
  const route = state.routeChoice || "unknown";
  const routeName = ROUTE_NAMES[route] || "unknown";

  const routeTags = [routeName, route];
  const byWeight = entries.slice().sort((a, b) => (Number(b.weight || 0) - Number(a.weight || 0)));
  const positives = byWeight.filter(e => !(e.tags || []).some(t => negativeTags.has(t)));
  const negatives = byWeight.filter(e => (e.tags || []).some(t => negativeTags.has(t)));
  const checkpoints = byWeight.filter(e => e.type === "checkpoint" || (e.meta && e.meta.route));

  const win = positives.slice(0, 2);
  const loss = negatives[0];
  const turn = checkpoints[0];

  let title = "毕业结算";
  let endingId = "unknown";
  if (route === "pushmian") {
    title = state.track.pushmian.status === "confirmed" ? "保研上岸" : "保研受挫";
    endingId = state.track.pushmian.status === "confirmed" ? "pushmian_success" : "pushmian_setback";
  } else if (route === "job") {
    title = (state.outcomes.job && state.outcomes.job !== "fail") ? "就业上岸" : "就业艰难";
    endingId = (state.outcomes.job && state.outcomes.job !== "fail") ? "job_offer" : "job_struggle";
  } else if (route === "overseas") {
    title = (state.outcomes.overseas && state.outcomes.overseas !== "fail") ? "出国录取" : "出国受挫";
    endingId = (state.outcomes.overseas && state.outcomes.overseas !== "fail") ? "overseas_admit" : "overseas_setback";
  } else if (route === "postgrad") {
    title = state.outcomes.postgrad === "pass" ? "考研上岸" : "考研失利";
    endingId = state.outcomes.postgrad === "pass" ? "postgrad_pass" : "postgrad_fail";
  } else if (route === "civil") {
    title = state.outcomes.civil === "pass" ? "考公上岸" : "考公失利";
    endingId = state.outcomes.civil === "pass" ? "civil_pass" : "civil_fail";
  }

  const endingPriorityById = {};
  for (const e of ENDING_CATALOG) {
    endingPriorityById[e.id] = Number(e.priority || 0);
  }
  const endingBadgeMap = {
    pushmian_phd: { route: "pushmian", badge: "直博邀请", evidenceTags: ["直博邀请", "直博"] },
    job_spp: { route: "job", badge: "大厂SPP", evidenceTags: ["大厂SPP", "SPP"] },
    job_founder: { route: "job", badge: "合伙邀约", evidenceTags: ["合伙邀约", "创业", "合伙"] },
    overseas_ra: { route: "overseas", badge: "奖学金", evidenceTags: ["奖学金", "RA"] },
    overseas_toplab: { route: "overseas", badge: "顶级实验室", evidenceTags: ["顶级实验室", "顶级"] },
    postgrad_985: { route: "postgrad", badge: "一战上岸", evidenceTags: ["一战上岸"] },
    postgrad_second: { route: "postgrad", badge: "二战逆袭", evidenceTags: ["二战逆袭"] },
    civil_provincial: { route: "civil", badge: "省考上岸", evidenceTags: ["省考上岸", "省考"] },
    civil_stable: { route: "civil", badge: "稳定之选", evidenceTags: ["稳定之选", "稳定"] }
  };
  const badgeEndings = Object.keys(endingBadgeMap)
    .filter(id => {
      const cfg = endingBadgeMap[id];
      return route === cfg.route && hasSeasonBadge(cfg.route, cfg.badge);
    })
    .sort((a, b) => (Number(endingPriorityById[b] || 0) - Number(endingPriorityById[a] || 0)));
  if (badgeEndings.length) {
    endingId = badgeEndings[0];
    const titleCfg = ENDING_CATALOG.find(e => e.id === endingId);
    title = titleCfg ? titleCfg.title : title;
  }

  const badgeCfg = endingBadgeMap[endingId];
  let endingBadge = null;
  let endingEvidence = null;
  let endingReason = null;
  if (badgeCfg) {
    endingBadge = badgeCfg.badge;
    endingEvidence = entries.find(e => (e.tags || []).some(t => badgeCfg.evidenceTags.includes(t))) || null;
    if (!endingEvidence) {
      endingEvidence = entries.find(e => (e.title || "").includes(endingBadge)) || null;
    }
    if (!endingEvidence) {
      endingEvidence = entries.find(e => (e.meta && e.meta.route === route)) || entries[0] || null;
    }
    endingReason = `因获得「${endingBadge}」徽章（证据：${endingEvidence ? endingEvidence.title : "未记录"}）`;
  }

  logLine(`【毕业结算】${title}`);
  logLine(`路线：${routeName}`);
  if (endingReason) logLine(`判词：${endingReason}`);

  // 就业徽章：仅在未休学且学分达标的情况下授予
  if (route === "job" && canAwardAutumnBadges()) {
    if (state.flags && state.flags.jobFirstOffer) awardBadge("job", "就业上岸会长");
    if (state.flags && state.flags.jobTopOffer) awardBadge("job", "大厂SSP");
  }

  // Keep detailed verdict in the returned summary; avoid verbose log spam.
  const summary = {
    endingId,
    endingBadge: endingBadge || null,
    endingEvidence: endingEvidence ? endingEvidence.title : null,
    endingReason: endingReason,
    title,
    route,
    routeName,
    win: win.map(e => e.title),
    loss: loss ? loss.title : null,
    turn: turn ? turn.title : null
  };
  state.endingUnlocked = state.endingUnlocked || {};
  state.endingUnlocked[endingId] = true;
  logLine(`[ENDING] ${title} route=${route} badge=${endingBadge || "none"} evidence=${endingEvidence ? endingEvidence.title : "none"}`);
  if (!state.flags) state.flags = {};
  if (!state.flags.finalEvaluationShown) {
    showFinalEvaluationModal(summary);
    state.flags.finalEvaluationShown = true;
  }
  return summary;
}


const ROUTE_NAMES = {
  pg: "保研",
  kaoyan: "考研",
  abroad: "出国",
  gongkao: "考公",
  qiuzhao: "就业",
  pushmian: "保研",
  job: "就业",
  overseas: "出国",
  postgrad: "考研",
  civil: "考公"
};

const ROUTE_MAP = {
  pg: "pushmian",
  kaoyan: "postgrad",
  abroad: "overseas",
  gongkao: "civil",
  qiuzhao: "job"
};
const ROUTE_MAP_REV = {
  pushmian: "pg",
  postgrad: "kaoyan",
  overseas: "abroad",
  civil: "gongkao",
  job: "qiuzhao"
};

function getActiveRoute() {
  if (state.route) return state.route;
  return ROUTE_MAP_REV[state.routeChoice] || null;
}

function setRouteChoice(routeKey) {
  // 允许新旧 key
  const mapped = ROUTE_MAP[routeKey] || routeKey;
  const routeSingle = ROUTE_MAP_REV[mapped] || routeKey;
  state.route = routeSingle;
  state.routeChoice = mapped;
  state.flags = state.flags || {};
  state.flags.routeChoiceReady = false;
  logLine(`[TRACK] routeChoice=${mapped} route=${routeSingle}`);
  if (mapped === "job") state.track.job.status = "active";
  if (mapped === "overseas") state.track.overseas.status = "active";
  if (mapped === "postgrad") state.track.postgrad.status = "prep";
  if (mapped === "civil") state.track.civil.status = "prep";
  if (mapped === "pushmian" || mapped === "job" || mapped === "overseas" || mapped === "postgrad" || mapped === "civil") {
    unlockSeason(mapped, 1, 0);
  }
  logLine(`你决定走${ROUTE_NAMES[routeSingle] || routeSingle}路线。`);
  addEvidence({
    type: "checkpoint",
    title: `你决定走${ROUTE_NAMES[routeSingle] || routeSingle}路线。`,
    tags: ["route", ROUTE_NAMES[routeSingle] || routeSingle],
    deltas: { stability: +0.2 },
    weight: 4,
    meta: { route: routeSingle }
  });

  if (routeSingle === "pg") {
    startPgSummerCamp();
  }
}

function shouldOpenRouteChoice() {
  const ready = !!(state.flags && state.flags.routeChoiceReady);
  if (!ready) return false;
  if (state.route) return false;
  return true;
}

function shouldOpenPushmianOfferGuarantee() {
  const route = getActiveRoute();
  if (route && route !== "pg") return false;
  if (getCurrentTermIndex() !== 7 || state.week !== 4) return false;
  if (state.flags && state.flags.pushmianOfferGuaranteeShown) return false;
  const s = getSeason("pushmian");
  if (!s.unlocked || s.stage < 3) return false;
  const hasOffer = (state.offers || []).some(o =>
    o.kind === "pushmian" && (o.status === "intent" || o.status === "conditional" || o.status === "direct")
  );
  return !hasOffer;
}

function openRouteChoiceModal() {
  openEventModal({
    id: "ROUTE_CHOICE",
    title: "路线选择（term 6 末）",
    text: "大三结束了，你决定把接下来精力押在哪条路？",
    options: [
      { text: "保研（夏令营）", onSelect() { setRouteChoice("pg"); } },
      { text: "考研", onSelect() { setRouteChoice("kaoyan"); } },
      { text: "出国", onSelect() { setRouteChoice("abroad"); } },
      { text: "考公考编", onSelect() { setRouteChoice("gongkao"); } },
      { text: "就业就业", onSelect() { setRouteChoice("qiuzhao"); } }
    ]
  });
}

function finalizeTermGrades() {
  if (!state.termSelectedCourses.length) {
    logLine("本学期未选课。");
    return;
  }

  const rows = [];
  let sumCredits = 0;
  let sumGpaCredits = 0;

  logLine("正在结算本学期成绩。");
  for (const course of state.termSelectedCourses) {
    // 若课程已在学期中被结课并已固化 final 字段，则复用
    if (!course.finalized) {
      // 生成并固化该课程的最终成绩（基于当前 progress.hits）
      try {
        finalizeCourse(course);
      } catch (e) {
        logLine(`结算时生成课程成绩失败：${course.name} -> ${e.toString()}`);
      }
    }

    const percent = course.finalPercent;
    const letter = course.finalLetter;
    const gpa = Number(course.finalGpa || 0);
    const pass = percent >= 60;

    sumCredits += Number(course.credits || 0);
    sumGpaCredits += gpa * Number(course.credits || 0);

    rows.push({
      c: course,
      percent,
      letter,
      gpa,
      pass,
      status: pass ? "已通过" : "未通过"
    });

    // 标准化最终日志格式（便于机器/人工校验）
    logLine(`[Final] ${course.id} ${course.name} hits=${(state.courseProgress[course.id]?.hits||0).toFixed(1)} letter=${letter} percent=${percent} gpa=${gpa.toFixed(1)} passed=${pass}`);
  }

  const termGPA = sumCredits > 0 ? (sumGpaCredits / sumCredits) : 0;

  const header = `第 ${state.year} 学年 · 第 ${state.term} 学期 成绩单`;
  const summary = `学期 GPA ${termGPA.toFixed(2)}；学分累计 ${state.creditsEarned}/${state.curriculumPlan.graduateCredits}`;

  const termRecord = {
    year: state.year,
    term: state.term,
    courses: rows.map(r => ({
      name: r.c.name,
      percent: r.percent,
      letter: r.letter,
      gpa: r.gpa,
      credits: r.c.credits,
      pass: r.pass,
      status: r.status,
    })),
    termGPA: termGPA,
    totalCredits: state.creditsEarned,
  };
  state.gradeHistory.push(termRecord);

  logLine(`学期 GPA ${termGPA.toFixed(2)} 已记录。`);
  state.lastTermReport = { header, summary };
  state.showGradeReminder = true;
  if (getCurrentTermIndex() === PARAMS_V2.routeChoice.term) {
    state.flags = state.flags || {};
    state.flags.routeChoiceReady = true;
  }

  renderGradeList();

  state.termGradeBonus = 0;
  state.termStudy = 0;
  state.termResearch = 0;
  state.totalStudyThisTerm = 0;
  state.finalsStudyWeeksThisTerm = 0;
  state.studyActionsByCourseId = {};
  state.masteredCourseIds = [];
  state.disciplineFlag = false;
  state.conflictsResolved = true;
  state.actionsLeft = ACTIONS_PER_WEEK;
  state.addDropShownThisTerm = false;

  state.studyQueue = [];
  state.studySlots = [null, null, null, null];

  // NOTE: 不再在学期结束时重置 `state.courseProgress` 和 `state.courseDifficulty`。
  // hits 为长期累积属性，只有在课程通过（或手动清理）时才会从 `completedCourseIds`/`failedCourseIds` 等逻辑中被影响。
}

function triggerSCIBreakthroughModal(author) {
  // 创建一个临时事件对象
  const breakthroughEvent = {
    id: "SCI_BREAKTHROUGH",
    title: "科研突破！",
    text: `恭喜你发表 SCI / 取得科研突破！\n\n论文作者位次：${author}（通讯作者：否）`,
    cooldownWeeks: 4, // 防止短期内重复触发
    options: [
      {
        text: "太棒了！",
        effects: {
          mood: +5,
          note: "科研成就让你充满了动力和信心。"
        }
      }
    ]
  };

  // 记录日志
  logLine(`🎉 【科研突破】你发表了 SCI 论文！（作者位次：${author}，通讯作者：否）`);

  // 打开事件弹窗
  openEventModal(breakthroughEvent);
}

/* ========== CET4/6 考试系统 ========== */
/**
 * 计算CET考试成绩
 * @param {string} type - "cet4" 或 "cet6"
 * @returns {object} { score, pass }
 */
function calculateCETScore(type) {
  // 近4周学习次数总和 S（用于分段评分）
  const recent = Array.isArray(state.studyRecent4) ? state.studyRecent4 : [];
  const S = recent.slice(-4).reduce((sum, n) => sum + Number(n || 0), 0);
  const academicPower = Number(state.hiddenProfile.academicPower || 50);

  let band = [300, 424];
  if (S < 2) band = [300, 424];
  else if (S <= 4) band = [425, 500];
  else if (S <= 8) band = [500, 600];
  else if (S <= 12) band = [600, 710];
  else band = [600, 710];

  const bonus = Math.round((academicPower - 50) * 0.6); // 仅段内小幅加成
  let score = randi(band[0], band[1]) + bonus;
  score = clamp(score, band[0], band[1]);
  const pass = score >= 425;
  return { score, pass, S };
}

/**
 * 打开CET考试结果弹窗
 * @param {string} type - "cet4" 或 "cet6"
 * @param {object} result - { score, pass }
 */
function openCETResultModal(type, result) {
  state.cetExamPending = true;
  state.pendingEvent = { id: `CET_${type.toUpperCase()}_RESULT` };
  
  const examName = type === "cet4" ? "CET-4" : "CET-6";
  const passText = result.pass ? "通过" : "未通过";
  const passColor = result.pass ? "green" : "red";
  
  setText(ui.evTitle, `${examName} 考试成绩`);
  ui.evText.innerHTML = `
    <div style="text-align: center; margin: 20px 0;">
      <div style="font-size: 24px; font-weight: bold; color: ${passColor};">
        成绩：${result.score} 分
      </div>
      <div style="font-size: 18px; margin-top: 10px;">
        ${passText}（425分及以上为通过）
      </div>
    </div>
  `;
  clear(ui.evOptions);
  setText(ui.evHint, "点击确认继续。");
  
  const btn = document.createElement("button");
  btn.className = "btn primary";
  btn.textContent = "知道了";
  btn.addEventListener("click", () => {
    state.cetExamPending = false;
    state.pendingEvent = null;
    ui.modalEvent.classList.add("hidden");
    render();
  });
  ui.evOptions.appendChild(btn);
  
  ui.modalEvent.classList.remove("hidden");
}

/**
 * 打开CET报名弹窗
 */
function openCETRegistrationModal() {
  // 判断可以报名的考试类型
  const canTakeCET4 = !state.certs.cet4; // 还没考过CET-4
  const canTakeCET6 = state.certs.cet4?.pass && !state.certs.cet6; // CET-4已通过且还没考过CET-6
  
  if (!canTakeCET4 && !canTakeCET6) {
    // 都已经考过或不符合条件
    return;
  }
  
  state.eventPending = true;
  state.pendingEvent = { id: "CET_REGISTRATION" };
  
  const examOptions = [];
  if (canTakeCET4) {
    examOptions.push({ type: "cet4", name: "CET-4" });
  }
  if (canTakeCET6) {
    examOptions.push({ type: "cet6", name: "CET-6" });
  }
  
  setText(ui.evTitle, "四六级考试报名");
  ui.evText.innerHTML = `
    <div style="margin: 15px 0;">
      第${state.year}学年·第${state.term}学期第14周：四六级考试报名时间到了。
      ${canTakeCET4 && canTakeCET6 ? "你可以选择报名 CET-4 或 CET-6。" : canTakeCET4 ? "你可以报名 CET-4。" : "你可以报名 CET-6。"}
    </div>
  `;
  clear(ui.evOptions);
  setText(ui.evHint, "请选择要报名的考试，或选择不报名。");
  
  // 添加报名选项
  examOptions.forEach(opt => {
    const btn = document.createElement("button");
    btn.className = "btn primary";
    btn.textContent = `报名${opt.name}`;
    btn.addEventListener("click", () => {
      // 计算成绩
      const result = calculateCETScore(opt.type);
      
      // 记录成绩
      state.certs[opt.type] = {
        score: result.score,
        pass: result.pass,
        term: state.term,
        year: state.year,
      };
      
      logLine(`📄 你报名参加了${opt.name}考试。`);
      
      // 关闭报名弹窗
      state.eventPending = false;
      state.pendingEvent = null;
      ui.modalEvent.classList.add("hidden");
      
      // 打开结果弹窗
      openCETResultModal(opt.type, result);
    });
    ui.evOptions.appendChild(btn);
  });
  
  // 添加"不报名"选项
  const btnSkip = document.createElement("button");
  btnSkip.className = "btn";
  btnSkip.textContent = "不报名";
  btnSkip.addEventListener("click", () => {
    logLine("你选择不报名参加四六级考试。");
    state.eventPending = false;
    state.pendingEvent = null;
    ui.modalEvent.classList.add("hidden");
    render();
  });
  ui.evOptions.appendChild(btnSkip);
  
  ui.modalEvent.classList.remove("hidden");
}

/**
 * 检查是否应该显示CET报名弹窗
 * 规则：奇数学期的第14周
 */
function checkCETRegistration() {
  // 必须是奇数学期（1, 3, 5, 7）
  if (state.term % 2 !== 1) return false;
  
  // 必须是第14周
  if (state.week !== 14) return false;
  
  // 本学期已经显示过报名弹窗，不再显示
  if (state.cetRegistrationShownThisTerm) return false;
  
  // 检查是否有可报名的考试
  const canTakeCET4 = !state.certs.cet4;
  const canTakeCET6 = state.certs.cet4?.pass && !state.certs.cet6;
  
  if (!canTakeCET4 && !canTakeCET6) return false;
  
  return true;
}

/* ========== CET4/6（旧版，保留兼容） ========== */
function maybeRunCET() {
  // 旧版逻辑已废弃，现在使用新的报名系统
  // 保留此函数以防其他地方调用
}


/* ========== 周结算 / 进周（v0.4.2：月=4周；进周先发钱再扣钱；每月1次聚餐） ========== */
function weekInMonth() {
  // 1..4
  return ((state.week - 1) % 4) + 1;
}

function monthInTerm() {
  // 1..4（每学期16周）
  return Math.floor((state.week - 1) / 4) + 1;
}

function absMonthIndex() {
  // 绝对月份（用于“本月只能向爸妈要一次钱”等限制）
  // 每年2学期，每学期4个月
  return (state.year - 1) * TERMS_PER_YEAR * 4 + (state.term - 1) * 4 + monthInTerm();
}

function drawMonthlyDinnerWeeks() {
  const picks = [1, 2, 3, 4];
  // Fisher-Yates
  for (let i = picks.length - 1; i > 0; i--) {
    const j = randi(0, i);
    [picks[i], picks[j]] = [picks[j], picks[i]];
  }
  return picks.slice(0, 1).sort((a, b) => a - b);
}

function monthlyIncomeAndCostsIfNeeded() {
  // 每 4 周算一个“月”，每个月第 1 周：发钱 + 扣固定支出 + 抽 1 个聚餐周
  if (weekInMonth() !== 1) return;

  const income = FAMILY_ALLOWANCE_MONTHLY[state.family] || 0;
  state.money += income;

  const essentials = randi(MONTHLY_ESSENTIALS_MIN, MONTHLY_ESSENTIALS_MAX);
  const isExamMonth = (monthInTerm() === 4); // 期末月（第13-16周）
  const fixed = essentials + MONTHLY_PHONE_TOPUP + (isExamMonth ? EXAM_MATERIAL_FEE : 0);
  state.money = Math.max(0, state.money - fixed);

  // 本月聚餐周次（保证 1 次）
  state.monthlyDinnerWeeks = drawMonthlyDinnerWeeks();
  state.monthlyDinnerAbsMonth = absMonthIndex();

  logLine(
    `💰 月初补贴 +${income}；固定支出 -${fixed}（日用品${essentials}+充值${MONTHLY_PHONE_TOPUP}${isExamMonth ? `+资料${EXAM_MATERIAL_FEE}` : ""}）。当前余额 ${state.money}。`
  );
}

function weeklyLivingCostAtWeekStart() {
  // 进第 N 周时扣一次“本周生活开销” = 7天随机开销求和
  const range = DAILY_LIVING_COST_RANGE[state.family] || [20, 49];
  const lo = range[0], hi = range[1];
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += randi(lo, hi);

  state.money = Math.max(0, state.money - sum);
  logLine(`🧾 本周生活开销 -${sum}（7天合计，家境=${state.family}，日均区间${lo}-${hi}）`);
}

function maybeTriggerMonthlyDinner() {
  const absM = absMonthIndex();
  if (state.monthlyDinnerAbsMonth !== absM) {
    // 理论上月初会生成；这里兜底
    state.monthlyDinnerWeeks = drawMonthlyDinnerWeeks();
    state.monthlyDinnerAbsMonth = absM;
  }

  const w = weekInMonth();
  if (!state.monthlyDinnerWeeks.includes(w)) return false;

  // 聚餐事件（保证本月 1 次；当周视为“本周事件”，不再额外抽随机事件）
  const fam = state.family;
  const dinnerRange = fam === 'poor' ? [30, 80] : fam === 'ok' ? [80, 180] : [150, 400];
  const costAA = randi(dinnerRange[0], dinnerRange[1]);
  const costTreat = randi(Math.floor(dinnerRange[1] * 1.2), Math.floor(dinnerRange[1] * 1.8));

  openEventModal({
    id: `MONTHLY_DINNER_${absM}_${w}`,
    title: '聚餐/局（保底事件）',
    text: `这个月第${monthInTerm()}个月，本月第${w}周：同学/社团突然约饭。你感觉钱包在蒸发，但社交也在充电。`,
    cooldownWeeks: 0,
    tags: ['dinner'],
    options: [
      { text: `去（AA，-${costAA}）`, effects: { money: -costAA, mood: +3, stress: -3, social: +3, hidden: { stability: +0.3 }, note: '吃了，聊了，钱包轻了。' } },
      { text: `我请客（-${costTreat}）`, effects: { money: -costTreat, mood: +4, stress: -4, social: +5, hidden: { luck: +0.5 }, note: '豪气+，人脉+，钱包-。' } },
      { text: '不去（回宿舍躺平）', effects: { mood: -1, energy: +8, stress: -6, social: -1, hidden: { stability: +0.2 }, note: '躲过一局，但也少了一点存在感。' } },
    ],
  });

  return true;
}

function enterWeek({ skipRandomEvent = false } = {}) {
  ensureSeasonState();
  // 进周：先“月初结算（如适用）”再扣“本周生活开销”
  monthlyIncomeAndCostsIfNeeded();
  weeklyLivingCostAtWeekStart();

  if (!skipRandomEvent && isSuspendedActive()) {
    logLine("【休学】本周休学中，课程与事件暂停。");
    state.actionsLeft = 2;
    render();
    return;
  }

  ensurePushmianPrepSeason();
  updateSeasonProgressByTime();
  const extended = handleLeaveRecoveryIfNeeded();
  if (extended) {
    render();
    return;
  }

  // 新学期第1周：先弹出上学期期末成绩提醒
  if (!skipRandomEvent && state.week === 1 && state.showGradeReminder) {
    state.showGradeReminder = false;
    openGradeReminderModal();
    return;
  }

  if (!skipRandomEvent && shouldOpenPushmianOfferGuarantee()) {
    state.flags = state.flags || {};
    state.flags.pushmianOfferGuaranteeShown = true;
    const ev = (window.EVENTS || []).find(e => e.id === "PM_S3_STRATEGY");
    if (ev) openEventModal(Object.assign({}, ev));
    else {
      openEventModal({
        id: "PUSHMIAN_OFFER_GUARANTEE",
        title: "保研意向 Offer 到手",
        text: "你在预推免考核中表现合格，拿到了一个意向 offer（仍需后续确认）。",
        options: [
          {
            text: "确认意向",
            effects: { mood: +2, stress: +1 },
            evidence: { title: "你拿到了保研意向 offer", tags: ["保研", "offer"], deltas: { stability: +0.4, luck: +0.2 }, weight: 4, meta: { route: "pushmian" } },
            onSelect: () => { createPushmianOffer("intent", "system", "guaranteed intent offer"); }
          }
        ]
      });
    }
    return;
  }

  if (!skipRandomEvent) logStressWarningsIfNeeded();

  if (!skipRandomEvent && checkStressSevereEvent()) return;
  if (!skipRandomEvent && checkMoodSevereEvent()) return;
  if (!skipRandomEvent && checkMoneySevereEvent()) return;

  // 新周健康阈值检查（仅在 enterWeek 触发）
  if (!skipRandomEvent && checkHealthThresholdEvent()) {
    return;
  }

  if (!skipRandomEvent && shouldOpenRouteChoice()) {
    openRouteChoiceModal();
    return;
  }


  // 第3周自动弹出退补选（如果本学期没打开过）
  if (state.week === 3 && !state.addDropShownThisTerm) {
    openAddDropModal();
  }

  // 奇数学期第14周：四六级考试报名
  if (!skipRandomEvent && checkCETRegistration()) {
    state.cetRegistrationShownThisTerm = true;
    openCETRegistrationModal();
    return; // 报名弹窗打开时，不再触发其他事件
  }

  // 健康阈值检查（只在进周触发事件弹窗）
  if (!skipRandomEvent) {
    try { checkHealthThresholdEvent(); } catch (e) { /* noop */ }
  }

  // 每月一次聚餐（保底弹窗）。聚餐当周不再额外抽随机事件，避免弹窗过载。
  if (!skipRandomEvent && maybeTriggerMonthlyDinner()) return;

  if (!skipRandomEvent) ensureWeeklyEvent();
}

function endOfWeekDrift() {
  if (isSuspendedActive()) {
    state.stress = clamp(state.stress - 6, 20, 100);
    logLine(`【休学】周末恢复：压力-6（最低20，当前${state.stress}）`);
    return;
  }
  // 周末漂移：压力自然上浮，心情受到压力影响
  const stressDrift = FINALS_WEEKS.includes(state.week) ? 8 : 3;
  state.stress = clamp(state.stress + stressDrift, 0, 100);

  // 心情：压力 > 70 会掉
  if (state.stress > 70) {
    const drop = -randi(2, 5);
    applyMoodDelta(drop);
  }
  // 本周未休息额外扣血
  const noRestCfg = PARAMS.health.weeklyNoRestPenalty;
  if (noRestCfg && noRestCfg.requireActionId) {
    const cnt = (state.weekActionCounts && state.weekActionCounts[noRestCfg.requireActionId]) || 0;
    if (cnt === 0 && typeof noRestCfg.deltaHealth === "number" && noRestCfg.deltaHealth !== 0) {
      const hmin = PARAMS.health.clampMin, hmax = PARAMS.health.clampMax;
      state.health = clamp((state.health || PARAMS.health.initial) + noRestCfg.deltaHealth, hmin, hmax);
      logLine(`周末健康变动：${noRestCfg.deltaHealth}（本周未休息，health=${state.health}）`);
    }
  }
  // 健康漂移：按 PARAMS.health.weeklyDrift 计算四项影响并限制 delta
  try {
    const cfg = PARAMS.health.weeklyDrift;
    let delta = 0;
    // stressPenalty
    for (const r of cfg.stressPenalty) {
      if (state.stress >= r.min && state.stress <= r.max) { delta += r.delta; break; }
    }
    // energyPenalty
    for (const r of cfg.energyPenalty) {
      if (state.energy >= r.min && state.energy <= r.max) { delta += r.delta; break; }
    }
    // moodPenalty
    for (const r of cfg.moodPenalty) {
      if (state.mood >= r.min && state.mood <= r.max) { delta += r.delta; break; }
    }
    // selfHeal (apply first matching)
    for (const s of cfg.selfHeal) {
      if (state.stress <= (s.cond.stressMax || 999) && state.energy >= (s.cond.energyMin || 0)) { delta += s.delta; break; }
    }
    // clamp delta
    const dmin = cfg.deltaClamp?.min ?? -9999;
    const dmax = cfg.deltaClamp?.max ?? 9999;
    delta = Math.max(dmin, Math.min(dmax, delta));
    if (delta !== 0) {
      const hmin = PARAMS.health.clampMin, hmax = PARAMS.health.clampMax;
      state.health = clamp((state.health || PARAMS.health.initial) + delta, hmin, hmax);
      logLine(`周末健康变动：${delta > 0 ? '+' + delta : delta}（health=${state.health}）`);
    }
  } catch (e) { /* noop */ }

  logLine(`📆 周末结算：压力漂移 +${stressDrift}${state.stress > 70 ? '（高压影响心情）' : ''}。`);
}

function nextWeek() {
  if (!state.started) return;
  if (state.flags && state.flags.gameEnded) { logLine("【系统】游戏已结束，可查看最终评价。"); return; }

  // 没处理事件，不能过周
  if (state.eventPending || state.cetExamPending) {
    logLine('⚠️ 本周事件还没处理：先做出选择。');
    return;
  }

  // 记录本周学习次数（用于CET近4周统计）
  state.studyRecent4 = [...(state.studyRecent4 || []), state.studyThisWeek || 0].slice(-4);
  state.studyThisWeek = 0;

  // 结束周
  endOfWeekDrift();
  maybeRunCET();

  // 进下周
  state.week += 1;
  state.weekActionCounts = {};
  if (state.status && state.status.postLeaveBuffWeeks > 0) {
    state.status.postLeaveBuffWeeks = Math.max(0, state.status.postLeaveBuffWeeks - 1);
  }
  // 依据健康惩罚调整每周行动上限（由 PARAMS 驱动）
  let cap = ACTIONS_PER_WEEK;
  const pen = state.status && state.status.healthPenalty;
  if (pen && pen.type && PARAMS.illness.penalty[pen.type]) {
    cap = ACTIONS_PER_WEEK + (PARAMS.illness.penalty[pen.type].actionCapDelta || 0);
  }
  cap = Math.max(0, cap);
  state.actionsLeft = cap;
  if (isSuspendedActive()) state.actionsLeft = 2;

  if (state.week > TERM_WEEKS) {
    // 期末 -> 结算学期 -> 进入新学期
    finalizeTermGrades();
    showTermEvidenceSummary(state.term, state.year);
    handlePushmianTermEnd();
    const curTermIndex = getCurrentTermIndex();
    const maxTermIndex = 12; // 最长6年
    if (curTermIndex >= 8) {
      if (canGraduateNow() && !state.flags.graduated) {
        showGraduationVerdict();
        state.flags.graduated = true;
        state.flags.gameEnded = true;
        return;
      }
      if (curTermIndex >= maxTermIndex && !state.flags.gameEnded) {
        state.flags.forcedOverterm = true;
        showGraduationVerdict();
        state.flags.gameEnded = true;
        return;
      }
      state.delayTerms = (state.delayTerms || 0) + 1;
      alert(`延毕原因：未满足毕业条件，学分不足。延毕 +1 学期（累计 ${state.delayTerms}）。`);
      logLine(`【延毕】未满足毕业条件，延毕 +1 学期（累计 ${state.delayTerms}）。`);
    }

    state.week = 1;
    state.term += 1;

    if (state.term > TERMS_PER_YEAR) {
      state.term = 1;
      state.year += 1;
      logLine(`🎓 进入第 ${state.year} 学年。`);
    }

    logLine(`📚 进入第${state.term}学期：第1周自动锁定强制课（其余给推荐）；第3周退补选。`);
    state.termSelectedCourses = []; // 新学期需要重新选课
    state.recommendedCoursesThisTerm = { current: [], retake: [], overdue: [] };
    state.addDropShownThisTerm = false;
    state.cetRegistrationShownThisTerm = false; // 新学期重置CET报名标记

    // 强制课统一入口
    ensureMandatoryCoursesForTerm(getCurrentTermIndex());
    // 推荐列表/可选课生成
    autoPlanThisTerm();

    // 初始化学习系统
    initStudySystem();
  }

  // 进周扣钱/事件（本周）
  enterWeek();
  tickAutumnRecruit();
  tickKaoyan();
  tickAbroad();
  tickGongkao();
  tickPg();

  render();
}

/* ========== 健康阈值与惩罚（Phase A） ========== */
// 健康/惩罚工具（Phase A）
function expirePenaltyIfNeeded() {
  if (!state.status) return;
  const pen = state.status.healthPenalty;
  if (!pen) return;
  const abs = absWeekIndex();
  if (pen.untilAbsWeek && abs > pen.untilAbsWeek) {
    delete state.status.healthPenalty;
    logLine('[Health] 惩罚期已到，healthPenalty 已清除。');
  }
}

function isPenaltyActive() {
  const pen = state.status && state.status.healthPenalty;
  if (!pen) return false;
  return absWeekIndex() <= (pen.untilAbsWeek || 0);
}

function setPenalty(type) {
  const dur = (PARAMS.illness.penalty[type] && PARAMS.illness.penalty[type].durationWeeks) || 0;
  const abs = absWeekIndex();
  state.status = state.status || {};
  const duration = Math.max(1, dur);
  state.status.healthPenalty = { type: type, untilAbsWeek: abs + duration - 1 };
  const cap = Math.max(0, ACTIONS_PER_WEEK + (PARAMS.illness.penalty[type].actionCapDelta || 0));
  state.actionsLeft = Math.min(state.actionsLeft, cap);
}

function multFromHealth(healthVal) {
  const h = Number(healthVal || PARAMS.health.initial);
  let mult = 1.0;
  const arr = PARAMS.health.efficiencyByHealth.slice().sort((a, b) => b.min - a.min);
  for (const r of arr) { if (h >= r.min) { mult = r.mult; break; } }
  return mult;
}

function multFromPenalty(penalty) {
  if (!penalty || !penalty.type) return 1.0;
  if (!isPenaltyActive()) return 1.0;
  const cfg = PARAMS.illness.penalty[penalty.type];
  return cfg ? (cfg.extraEffMult || 1.0) : 1.0;
}

function getEffMult() {
  const pen = state.status && state.status.healthPenalty;
  let mult = multFromHealth(state.health) * multFromPenalty(pen);
  if (isStressRiskActive()) {
    mult *= (PARAMS.severe.stress.riskEffMult || 1.0);
  }
  return mult;
}

function checkHealthThresholdEvent() {
  expirePenaltyIfNeeded();
  if (isPenaltyActive()) return false;
  const h = Number(state.health || PARAMS.health.initial);
  // major first
  if (h < PARAMS.illness.thresholds.major) {
    setPenalty('major');
    const ev = PARAMS.illness.events.major;
    openEventModal(Object.assign({}, ev, { id: ev.id + '_' + absWeekIndex() }));
    logLine('[Health] 触发大病事件。');
    return true;
  }
  // minor
  if (h < PARAMS.illness.thresholds.minor) {
    setPenalty('minor');
    const ev = PARAMS.illness.events.minor;
    openEventModal(Object.assign({}, ev, { id: ev.id + '_' + absWeekIndex() }));
    logLine('[Health] 触发小病事件。');
    return true;
  }
  // if recovered sufficiently, clear penalty (expirePenaltyIfNeeded handles expiry)
  return false;
}

function checkMoneySevereEvent() {
  const cfg = PARAMS_V2.moneyCutoff;
  if (!cfg) return false;
  if (Number(state.money || 0) >= cfg.severeThreshold) return false;
  const abs = absWeekIndex();
  const until = state.status && state.status.moneySevereUntilAbsWeek;
  if (until && abs <= until) return false;
  state.status = state.status || {};
  state.status.moneySevereUntilAbsWeek = abs + 1 - 1;
  const options = (cfg.options || []).map(o => ({
    text: o.text,
    effects: o.effects || {},
    evidence: o.evidence || null
  }));
  const ev = {
    id: "MONEY_SEVERE",
    title: "资金告急！",
    text: "你身上的钱已经不够维持基本生活开支了，必须尽快想办法。",
    options
  };
  openEventModal(Object.assign({}, ev, { id: ev.id + '_' + abs }));
  logLine('[Money] severe cutoff triggered.');
  return true;
}

function checkMoodSevereEvent() {
  const cfg = PARAMS.severe.mood;
  if (!cfg) return false;
  const abs = absWeekIndex();
  const mood = Number(state.mood || 0);
  state.status = state.status || {};

  if (mood > cfg.threshold) {
    delete state.status.moodSevereSinceAbsWeek;
    return false;
  }

  if (!state.status.moodSevereSinceAbsWeek) {
    state.status.moodSevereSinceAbsWeek = abs;
    return false;
  }

  const weeksDown = abs - state.status.moodSevereSinceAbsWeek;
  if (weeksDown < (cfg.sustainWeeks || 1)) return false;

  const ev = cfg.event;
  openEventModal(Object.assign({}, ev, { id: ev.id + '_' + abs }));
  logLine('[Mood] 触发情绪严重事件。');
  return true;
}

function checkStressSevereEvent() {
  const cfg = PARAMS.severe.stress;
  if (!cfg) return false;
  const stress = Number(state.stress || 0);
  if (stress < cfg.threshold) return false;
  const abs = absWeekIndex();
  const until = state.status && state.status.stressSevereUntilAbsWeek;
  if (until && abs <= until) return false;

  setStressRiskWeeks(cfg.riskDurationWeeks || 0);
  setSuspensionWeeks(cfg.suspendWeeks || 0, "压力过载");
  state.status = state.status || {};
  state.status.stressSevereUntilAbsWeek = abs + (cfg.suspendWeeks || 1) - 1;
  logLine("【心理健康】压力过载，已自动进入休学康复期（预计 1 学年）。");
  return true;
}
/* ========== 开局：选择学院/家境/路线 ========== */
function setAcademy(academyZh) {
  state.academy = academyZh;
  state.academyNormalized =
    academyZh === "理工" ? "stem" :
      academyZh === "商科" ? "biz" :
        academyZh === "医" || academyZh === "医学" ? "medicine" :
          "arts";

  setText(ui.txtAcaHint, `已选择学院：${academyZh}（锁死）`);
  setStartHint();
}

function setFamily(famKey) {
  state.family = famKey;
  setText(ui.txtFamHint, `已选择家境：${famKey}（锁死）`);
  setStartHint();
}

function setRoute(routeKey) {
  state.route = routeKey;
  const zh = 
    routeKey === "abroad" ? "出国" : 
    routeKey === "baoyan" ? "保研" : 
    routeKey === "kaoyan" ? "考研" : 
    routeKey === "gongkao" ? "考公" : 
    routeKey === "qiuzhao" ? "就业" : 
    "未选择";
  setText(ui.txtRouteHint, `已选择路线：${zh}`);
  setStartHint();
}

function startGame() {
  if (state.started) {
    logLine("游戏已经开始，无需重复初始化。");
    setTab("tabCourses");
    setStartHint("✅ 已开始：去“选课&考试”或“本周&日志”。");
    return;
  }
  if (!state.academy || !state.family) {
    logLine("⚠️ 还没选学院/家境。");
    setStartHint("⚠️ 请先选择学院和家境后再开始。");
    return;
  }
  if (!window.COURSE || typeof window.COURSE.generatePlan !== "function") {
    logLine("❌ course.js 未加载：window.COURSE.generatePlan 不存在。");
    setStartHint("❌ course.js 未加载，请检查脚本路径或刷新页面。");
    return;
  }

  state.curriculumPlan = window.COURSE.generatePlan(state.academy);
  state.allCoursesPool = state.curriculumPlan.coursePool.slice();

  ensureSeasonState();
  state.endingUnlocked = state.endingUnlocked || {};

  state.started = true;
  if (ui.btnStart) {
    ui.btnStart.disabled = true;
    ui.btnStart.textContent = "已开始";
  }
  setStartHint("✅ 已开始：去“选课&考试”或“本周&日志”。");
  const routeZh = 
    state.route === "abroad" ? "出国" : 
    state.route === "baoyan" ? "保研" : 
    state.route === "kaoyan" ? "考研" : 
    state.route === "gongkao" ? "考公" : 
    state.route === "qiuzhao" ? "就业" : 
    "未选择";
  logLine(`✅ 开局完成：学院=${state.academy}，家境=${state.family}，路线=${routeZh}。`);

  // 就业状态重置
  state.branches = state.branches || {};
  state.branches.autumnRecruit = {
    enabled: false,
    resume: 0,
    prep: 0,
    queue: [],
    offers: [],
    inbox: []
  };

  // 进第1周：月初结算/周开销/强制课补齐/聚餐保底/随机事件
  ensureMandatoryCoursesForTerm(getCurrentTermIndex());
  autoPlanThisTerm();
  enterWeek({ skipRandomEvent: true });

  setTab("tabCourses");
  render();
}

/* ========== 绑定事件 ========== */
/* ========== 调试/验证工具（在浏览器控制台调用） ========== */
function dumpTermSelectedCourses() {
  const rows = (state.termSelectedCourses || []).map(c => {
    const p = state.courseProgress[c.id] || { hits: 0.0, done: false };
    const isMandatory = isLockedCourseThisTerm(c.id);
    const passed = state.completedCourseIds.has(c.id);
    const failed = state.failedCourseIds.has(c.id);
    const retake = isRetakeTerm(c.id);
    const status = p.done ? "done" : "in-progress";
    const out = {
      id: c.id,
      name: c.name,
      term: c.suggestedTerm || c.term || null,
      isMandatory,
      status,
      hits: Number((p.hits || 0).toFixed(1)),
      passed,
      failed,
      retake,
    };
    const line = `${out.id} | ${out.name} | term=${out.term} | mandatory=${out.isMandatory} | status=${out.status} | hits=${out.hits} | passed=${out.passed} | failed=${out.failed} | retake=${out.retake}`;
    logLine(line);
    return out;
  });
  try { console.log(rows); } catch (e) {}
  return rows;
}

function dumpStudyState() {
  const queue = Array.isArray(state.studyQueue) ? state.studyQueue.slice() : [];
  const slots = (state.studySlots || []).slice();
  logLine(`StudyQueue: [${queue.join(", ")}]`);
  logLine(`Slots: [${slots.map(s => s || "null").join(", ")}]`);
  try { console.log({ queue, slots }); } catch (e) {}
  return { queue, slots };
}

// 最小自动验证流程（在浏览器控制台调用）：会按需求执行并输出日志
function simulateMinimalValidation() {
  logLine("=== 最小化验证开始 ===");
  // 开局设置（如果还没选）
  if (!state.academy) state.academy = "理工";
  if (!state.family) state.family = "ok";
  if (!state.started) {
    try { startGame(); } catch (e) { logLine("startGame() failed: " + e.toString()); }
  }

  logLine("-- startGame 后：本学期已选课程（termSelectedCourses） --");
  dumpTermSelectedCourses();
  dumpStudyState();

  // 学习一次（执行 study action）
  logLine("-- 执行一次学习行动 --");
  try { doStudyAction(); } catch (e) { logLine("doStudyAction() failed: " + e.toString()); }
  dumpStudyState();

  // 模拟第3周退补选：添加一门非强制且未选的课程，退掉一门非强制已选课程
  logLine("-- 模拟第3周退补选 --");
  state.week = 3;
  // 找一门可加课
  const pool = state.allCoursesPool || [];
  const canAdd = pool.find(c => !isCourseSelectedThisTerm(c.id) && !state.completedCourseIds.has(c.id) && !isLockedCourseThisTerm(c.id));
  const toRemove = state.termSelectedCourses.find(c => !isLockedCourseThisTerm(c.id));
  if (canAdd) {
    state.termSelectedCourses.push(canAdd);
    logLine(`(sim) added ${canAdd.id} ${canAdd.name}`);
  } else logLine("(sim) 无可添加课程");
  if (toRemove) {
    state.termSelectedCourses = state.termSelectedCourses.filter(x => x.id !== toRemove.id);
    logLine(`(sim) removed ${toRemove.id} ${toRemove.name}`);
  } else logLine("(sim) 无可移除课程");

  // 重建队列并检查 hits/slots 是否保留
  rebuildStudyQueue();
  dumpTermSelectedCourses();
  dumpStudyState();

  // 期末结算（直接调用）
  logLine("-- 期末结算（finalizeTermGrades） --");
  try { finalizeTermGrades(); } catch (e) { logLine("finalizeTermGrades() failed: " + e.toString()); }

  logLine("-- 成绩记录（gradeHistory） --");
  try { console.log(state.gradeHistory); } catch (e) {}
  if (state.gradeHistory && state.gradeHistory.length) {
    for (const rec of state.gradeHistory) {
      logLine(`TermRecord: year=${rec.year} term=${rec.term} termGPA=${rec.termGPA.toFixed(2)} totalCredits=${rec.totalCredits}`);
      for (const c of rec.courses) {
        logLine(`  ${c.name} | percent=${c.percent} | letter=${c.letter} | gpa=${c.gpa} | pass=${c.pass}`);
      }
    }
  }

  // 进入下学期：模拟自动加入强制课
  logLine("-- 模拟进入下学期并确保强制课 --");
  state.term += 1;
  if (state.term > TERMS_PER_YEAR) { state.term = 1; state.year += 1; }
  ensureMandatoryCoursesForTerm(getCurrentTermIndex());
  autoPlanThisTerm();
  rebuildStudyQueue();
  dumpTermSelectedCourses();
  logLine("=== 最小化验证结束 ===");
}

function bindUI() {
  // tabs
  ui.tabs.forEach(btn => {
    btn.addEventListener("click", () => setTab(btn.dataset.tab));
  });

  // academy
  ui.btnAcaMed?.addEventListener("click", () => { if (!state.started) setAcademy("医"); render(); });
  ui.btnAcaStem?.addEventListener("click", () => { if (!state.started) setAcademy("理工"); render(); });
  ui.btnAcaBiz?.addEventListener("click", () => { if (!state.started) setAcademy("商科"); render(); });
  ui.btnAcaArts?.addEventListener("click", () => { if (!state.started) setAcademy("文社"); render(); });

  // family
  ui.btnFamPoor?.addEventListener("click", () => { if (!state.started) setFamily("poor"); render(); });
  ui.btnFamOk?.addEventListener("click", () => { if (!state.started) setFamily("ok"); render(); });
  ui.btnFamMid?.addEventListener("click", () => { if (!state.started) setFamily("mid"); render(); });
  ui.btnFamRich?.addEventListener("click", () => { if (!state.started) setFamily("rich"); render(); });

  // route
  ui.btnRouteAbroad?.addEventListener("click", () => { setRoute("abroad"); render(); });
  ui.btnRouteBaoyan?.addEventListener("click", () => { setRoute("baoyan"); render(); });
  ui.btnRouteKaoyan?.addEventListener("click", () => { setRoute("kaoyan"); render(); });
  ui.btnRouteGongkao?.addEventListener("click", () => { setRoute("gongkao"); render(); });
  ui.btnRouteQiuzhao?.addEventListener("click", () => { setRoute("qiuzhao"); render(); });
  ui.btnRouteTodo?.addEventListener("click", () => {
    if (state.routeChoice) return;
    if (!(state.flags && state.flags.routeChoiceReady)) {
      logLine("路线选择尚未开放，请在第6学期成绩结算后再选。");
      return;
    }
    openRouteChoiceModal();
  });

  // start
  ui.btnStart?.addEventListener("click", startGame);

  // courses tab
  ui.btnAutoPlan?.addEventListener("click", onAutoPlanClick);

  ui.btnOpenAddDrop?.addEventListener("click", () => {
    if (!state.started) return logLine("⚠️ 还没开始游戏。");
    openAddDropModal();
  });

  // 退补选弹窗：保证能关（你反馈“关不上”）
  const closeAddDrop = (e) => {
    e?.preventDefault?.();
    ui.modalAddDrop.classList.add("hidden");
    render();
  };
  ui.btnCloseAddDrop?.addEventListener("click", closeAddDrop);
  ui.btnCloseAddDropX?.addEventListener("click", closeAddDrop);

  // 点遮罩层也能关闭（点击白框外，更直觉）
  ui.modalAddDrop?.addEventListener("click", (e) => {
    if (e.target === ui.modalAddDrop) {
      ui.modalAddDrop.classList.add("hidden");
      render();
    }
  });

  // ESC 关闭退补选
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!ui.modalAddDrop.classList.contains("hidden")) {
      ui.modalAddDrop.classList.add("hidden");
      render();
    }
  });

  // next week (wrapped: 防止僵尸 eventPending 阻塞按钮)
  ui.btnNextWeek?.addEventListener("click", () => {
    // 如果还有行动则阻止
    if (state.actionsLeft > 0) return;

    // 如果存在事件/考试待处理且对应 modal 可见，则要求先处理
    const modalVisible = (ui.modalAddDrop && !ui.modalAddDrop.classList.contains('hidden'))
      || (ui.modalEvent && !ui.modalEvent.classList.contains('hidden'))
      || (ui.modalAdjust && !ui.modalAdjust.classList.contains('hidden'));

    if ((state.eventPending || state.cetExamPending) && modalVisible) {
      logLine('⚠️ 本周有待处理的弹窗/事件，请先完成。');
      return;
    }

    // 如果标记为 pending 但没有任何可见弹窗，说明可能为僵尸标记，自动清理并继续
    if ((state.eventPending || state.cetExamPending) && !modalVisible) {
      logLine('⚠️ 检测到未关闭的 pending 状态，自动清理并继续下一周。');
      state.eventPending = false;
      state.cetExamPending = false;
    }

    nextWeek();
  });
}

if (TEST_MODE) {
  const setAbsTerm = (absTerm) => {
    const t = Math.max(1, Number(absTerm) || 1);
    state.year = Math.floor((t - 1) / TERMS_PER_YEAR) + 1;
    state.term = ((t - 1) % TERMS_PER_YEAR) + 1;
  };

  const ensureTermInit = (prevAbsTerm) => {
    if (prevAbsTerm === getCurrentTermIndex()) return;
    state.termSelectedCourses = [];
    state.recommendedCoursesThisTerm = { current: [], retake: [], overdue: [] };
    state.addDropShownThisTerm = false;
    state.cetRegistrationShownThisTerm = false;
    ensureMandatoryCoursesForTerm(getCurrentTermIndex());
    autoPlanThisTerm();
    initStudySystem();
  };

  const resolvePendingModal = () => {
    if (state.eventPending || state.cetExamPending) {
      const btn = ui.evOptions?.querySelector("button");
      if (btn) {
        btn.click();
        return true;
      }
      state.eventPending = false;
      state.cetExamPending = false;
      state.pendingEvent = null;
      ui.modalEvent?.classList.add("hidden");
    }
    return false;
  };

  const applyEventOption = (ev, optRaw) => {
    const opt = (optRaw && typeof optRaw.build === "function") ? optRaw.build() : optRaw;
    if (!opt || opt.disabled) return false;
    const before = snapshotMainStats();
    logLine(`[TEST] auto pick: ${opt.text}`);
    applyEffects(opt.effects);
    if (opt.evidence) {
      addEvidence(opt.evidence);
    }
    applySeasonOption(ev, opt);
    applyOfferOption(opt);
    if (opt.expireOffers) expireOffers(opt.expireOffers);
    if (typeof opt.onSelect === "function") {
      opt.onSelect();
    }
    const cd = Number(ev.cooldownWeeks || 0);
    if (cd > 0) state.eventCooldownUntilAbsWeek[ev.id] = absWeekIndex() + cd;
    state.recentEventIds.push(ev.id);
    if (state.recentEventIds.length > 10) state.recentEventIds.shift();
    state.eventPending = false;
    state.pendingEvent = null;
    ui.modalEvent?.classList.add("hidden");
    const d = formatDeltaLine(before, snapshotMainStats());
    if (d) logLine(d);
    render();
    return true;
  };

  window.TEST = {
    snapshot() {
      return {
        term: getCurrentTermIndex(),
        week: state.week,
        absWeek: absWeekIndex(),
        gpa: calcCumulativeGPA(),
        hiddenProfile: Object.assign({}, state.hiddenProfile),
        track: JSON.parse(JSON.stringify(state.track || {})),
        offers: JSON.parse(JSON.stringify(state.offers || [])),
        outcomes: JSON.parse(JSON.stringify(state.outcomes || {})),
        seasons: JSON.parse(JSON.stringify(state.seasons || {})),
        endingUnlocked: Object.assign({}, state.endingUnlocked || {}),
        routeChoice: state.routeChoice,
        recentEvents: (state.recentEventIds || []).slice()
      };
    },
    gotoTermWeek(term, week) {
      const prevAbsTerm = getCurrentTermIndex();
      setAbsTerm(term);
      state.week = Math.max(1, Math.min(TERM_WEEKS, Number(week) || 1));
      ensureTermInit(prevAbsTerm);
      enterWeek({ skipRandomEvent: false });
      render();
      return this.snapshot();
    },
    setGPA(value) {
      state.testGPA = Number(value);
      return state.testGPA;
    },
    setHidden(profileObj) {
      state.hiddenProfile = state.hiddenProfile || {};
      for (const k of Object.keys(profileObj || {})) {
        state.hiddenProfile[k] = Number(profileObj[k] || 0);
      }
      return Object.assign({}, state.hiddenProfile);
    },
    chooseRoute(routeId) {
      setRouteChoice(routeId);
      render();
      return state.routeChoice;
    },
    forceTriggerCheckpoint(name) {
      if (name === "pushmian_predict") {
        const prev = getCurrentTermIndex();
        setAbsTerm(PARAMS_V2.pushmian.predictAtTermEnd);
        handlePushmianTermEnd();
        setAbsTerm(prev);
        return state.track.pushmian.status;
      }
      if (name === "pushmian_final") {
        const prev = getCurrentTermIndex();
        setAbsTerm(PARAMS_V2.pushmian.finalAtTermEnd);
        handlePushmianTermEnd();
        setAbsTerm(prev);
        return state.track.pushmian.status;
      }
      if (name === "autumn_recruit") return handleJobOutcomeCheckpoint();
      if (name === "overseas_apply") return handleOverseasOutcomeCheckpoint();
      if (name === "postgrad_final") return handlePostgradOutcomeCheckpoint();
      if (name === "civil_final") return handleCivilOutcomeCheckpoint();
      if (name === "graduation") return showGraduationVerdict();
      return null;
    },
    forceEvent(eventId, autoPickIndex) {
      const ev = (window.EVENTS || []).find(e => e.id === eventId);
      if (!ev) { logLine(`[TEST] forceEvent missing id=${eventId}`); return false; }
      if (!ev) return false;
      openEventModal(Object.assign({}, ev));
      if (typeof autoPickIndex === "number") {
        const opt = (ev.options || [])[autoPickIndex];
        logLine(`[TEST] forceEvent id=${eventId} optIndex=${autoPickIndex} hasOption=${!!opt}`);
        console.log(`[TEST] forceEvent id=${eventId} optIndex=${autoPickIndex} hasOption=${!!opt}`);
        if (!opt) return false;
        applyEventOption(ev, opt);
      }
      return true;
    },
    runTo(term, week, maxSteps = 300) {
      const targetTerm = Number(term) || getCurrentTermIndex();
      const targetWeek = Number(week) || state.week;
      let steps = 0;
      while (steps < maxSteps) {
        const curTerm = getCurrentTermIndex();
        if (curTerm > targetTerm || (curTerm === targetTerm && state.week >= targetWeek)) break;
        if (resolvePendingModal()) {
          steps += 1;
          continue;
        }
        nextWeek();
        steps += 1;
      }
      return this.snapshot();
    },
    runToGraduation() {
      this.runTo(8, 16, 400);
      return showGraduationVerdict();
    },
    exportLog() {
      const logs = state.logHistory || [];
      return logs.slice(-200).join("\n");
    }
    ,
    listEvents() {
      return (window.EVENTS || []).map(e => e.id);
    },
    hasEvent(id) {
      return !!(window.EVENTS || []).find(e => e.id === id);
    }
  };
}

/* ========== 初始化 ========== */
bindUI();
logLine("[TEST] 构建=042f");
setTab("tabOverview");
logLine("欢迎来到大学生模拟器 v0.4.3。");
logLine("去概览页：先选学院、家境（路线可不选），然后点【开始】。");
logLine("本游戏要点：第1周自动加入强制课 + 生成推荐；第3周退补选；每周3次行动；社交影响运气与人生轨迹。");
logLine("【新规则】必修课需达到 B (78分) 才能解锁 A+；选修课只要学一次就至少 A。");
render();

/* route_spec.js
 * 大学生模拟器：支线系统配置驱动规格 v1.0（给 Codex）
 * 目标：route engine 通用；五条支线只靠配置表跑起来
 */

/* =========================
 * 0) 全局常量：时间轴与冻结规则
 * ========================= */
const ROUTE_GLOBAL = {
  // 每周行动数：学期3，假期2
  ACTIONS_PER_WEEK: {
    TERM: 3,
    HOLIDAY: 2,
  },

  // 假期 money 冻结：不发补贴、不扣固定支出、不触发赚钱、不允许花钱按钮
  MONEY_FROZEN_SEGMENTS: ["SUMMER", "WINTER"],

  // 每周自然漂移（所有模式都执行，假期也执行）
  WEEKLY_DRIFT: {
    stress: +2,
    mood: -1,
    // 条件漂移写成规则，便于 Codex 实现
    rules: [
      { if: "stress>80", then: { health: -2 } },
      { if: "stress>90", then: { mood: -2 } },
      // health<30 -> 学习/面试收益-20%（引擎里做 multiplier）
      { if: "health<30", then: { globalGainMult: -0.20 } },
    ],
  },

  // 冲突：同一周最多2个事件（面试/笔试/营期）
  MAX_EVENTS_PER_WEEK: 2,

  // 改期：只允许1次；成功率=0.35 + luck/200（luck=50->0.60）
  RESCHEDULE: {
    maxTimes: 1,
    baseProb: 0.35,
    luckFactor: 1 / 200,
  },

  // 通用 penalty（压力、健康）
  PENALTY: {
    // stressPenalty = max(0,(stress-70)*0.3)
    stress: { start: 70, k: 0.3 },
    // healthPenalty = max(0,(50-health)*0.2)
    health: { start: 50, k: 0.2, direction: "below" },
  },

  // UI 模式
  UI_MODES: ["CLASSIC", "ROUTE_PANEL", "ROUTE_SPECIAL"],
};

/* =========================
 * 1) 通用状态字段（引擎应确保存在）
 * ========================= */
const ROUTE_STATE_SCHEMA = {
  baseStats: ["mood", "stress", "health", "energy", "luck"],
  abilities: ["gpa", "english", "research", "majorSkill", "examSkill", "interviewSkill"],
  // 通用过程指标（某些支线会用到）
  process: ["docsQuality", "resumeQuality", "projectPortfolio", "campPrep", "politicsSkill"],
};

/* =========================
 * 2) 通用行动（动作）配置：effects 写死数值范围
 *    - 引擎负责：随机取区间、clamp 0-100、应用 gainMult
 * ========================= */
const ROUTE_ACTIONS = {
  // 通用准备动作（空档周）
  study_major: {
    name: "复习知识（专业）",
    effects: { majorSkill: [3, 5], mood: [-2, -2], stress: [4, 4], health: [-1, -1] },
    tags: ["prep"],
  },
  drill_exam: {
    name: "刷题训练（应试）",
    effects: { examSkill: [3, 5], mood: [-3, -3], stress: [5, 5], health: [-2, -2] },
    tags: ["prep"],
  },
  practice_english: {
    name: "练英语（口语/听力）",
    effects: { english: [3, 5], mood: [-1, -1], stress: [3, 3], health: [-1, 0] },
    tags: ["prep"],
  },
  mock_interview: {
    name: "模拟面试",
    effects: { interviewSkill: [3, 5], mood: [-1, -1], stress: [4, 4], health: [-1, -1] },
    tags: ["prep"],
  },
  polish_docs: {
    name: "材料整理/文书打磨",
    effects: { docsQuality: [4, 7], mood: [-2, -2], stress: [4, 4], health: [-1, -1] },
    tags: ["prep"],
  },
  recover_routine: {
    name: "作息修复/运动",
    effects: { health: [4, 7], stress: [-7, -4], mood: [1, 3], energy: [0, 5] },
    tags: ["recover"],
  },
  chill: {
    name: "彻底摆烂（休息娱乐）",
    effects: { mood: [6, 10], stress: [-6, -3], health: [0, 2] },
    tags: ["recover", "risk"],
    // 冲刺阶段摆烂轻微惩罚：由 route 的 stage rules 决定是否追加 route指标-2
  },

  // 事件动作（占用1槽）
  attend_interview: {
    name: "参加面试",
    effects: { stress: [8, 12], mood: [-4, 2], health: [-2, -2] }, // mood 由结果修正
    tags: ["event"],
  },
  attend_exam: {
    name: "参加笔试",
    effects: { stress: [10, 14], mood: [-3, -3], health: [-2, -2] },
    tags: ["event"],
  },

  // 支线专属动作（保研/出国/秋招/考公/考研会引用）
  research_sprint: {
    name: "科研冲刺（补一个小成果）",
    effects: { research: [2, 4], docsQuality: [2, 2], stress: [6, 6], mood: [-3, -3], health: [-2, -2] },
    tags: ["prep", "route"],
  },
  memorize_boost: {
    name: "背诵强化（考研）",
    effects: { examSkill: [4, 6], mood: [-3, -3], stress: [6, 6], health: [-2, -2] },
    tags: ["prep", "route"],
  },
  full_mock_exam: {
    name: "模考（考研）",
    effects: { examSkill: [1, 2], stress: [10, 10], mood: [-4, -4], health: [-2, -2] },
    tags: ["prep", "route"],
    meta: { emits: "mockScoreHint" },
  },
  resume_opt: {
    name: "简历优化（秋招）",
    effects: { resumeQuality: [5, 8], stress: [3, 3], mood: [-1, -1], health: [-1, -1] },
    tags: ["prep", "route"],
  },
  project_polish: {
    name: "项目打磨（秋招）",
    effects: { projectPortfolio: [4, 7], majorSkill: [2, 3], stress: [5, 5], mood: [-2, -2], health: [-1, -1] },
    tags: ["prep", "route"],
  },
  civil_drill_xc: {
    name: "行测刷题（考公）",
    effects: { examSkill: [4, 6], stress: [6, 6], mood: [-3, -3], health: [-2, -2] },
    tags: ["prep", "route"],
  },
  civil_write_sl: {
    name: "申论写作（考公）",
    effects: { politicsSkill: [4, 6], interviewSkill: [1, 2], stress: [5, 5], mood: [-2, -2], health: [-1, -1] },
    tags: ["prep", "route"],
  },
};

/* =========================
 * 3) 38所高校（保研/考研/出国可复用池）
 *    - tier: 1最强 5保底
 * ========================= */
const UNIV_38 = [
  // tier1
  { id: "THU", name: "清华大学", tier: 1 },
  { id: "PKU", name: "北京大学", tier: 1 },

  // tier2（华五 + 顶尖985 + 国科大）
  { id: "FDU", name: "复旦大学", tier: 2 },
  { id: "SJTU", name: "上海交通大学", tier: 2 },
  { id: "ZJU", name: "浙江大学", tier: 2 },
  { id: "NJU", name: "南京大学", tier: 2 },
  { id: "USTC", name: "中国科学技术大学", tier: 2 },
  { id: "UCAS", name: "中国科学院大学", tier: 2 },

  // tier3（强985）
  { id: "WHU", name: "武汉大学", tier: 3 },
  { id: "HUST", name: "华中科技大学", tier: 3 },
  { id: "XJTU", name: "西安交通大学", tier: 3 },
  { id: "HIT", name: "哈尔滨工业大学", tier: 3 },
  { id: "SEU", name: "东南大学", tier: 3 },
  { id: "SYSU", name: "中山大学", tier: 3 },
  { id: "SCU", name: "四川大学", tier: 3 },
  { id: "UESTC", name: "电子科技大学", tier: 3 },
  { id: "BNU", name: "北京师范大学", tier: 3 },
  { id: "RUC", name: "中国人民大学", tier: 3 },
  { id: "NANKAI", name: "南开大学", tier: 3 },
  { id: "XMU", name: "厦门大学", tier: 3 },

  // tier4（中上985）
  { id: "SDU", name: "山东大学", tier: 4 },
  { id: "JLU", name: "吉林大学", tier: 4 },
  { id: "CSU", name: "中南大学", tier: 4 },
  { id: "BUAA", name: "北京航空航天大学", tier: 4 },
  { id: "SCUT", name: "华南理工大学", tier: 4 },
  { id: "TJTU", name: "天津大学", tier: 4 },
  { id: "ECNU", name: "华东师范大学", tier: 4 },
  { id: "TJU", name: "同济大学", tier: 4 }, // 这里占位：避免你后续想替换名单

  // tier5（保底985）
  { id: "NWPU", name: "西北工业大学", tier: 5 },
  { id: "CQU", name: "重庆大学", tier: 5 },
  { id: "LZU", name: "兰州大学", tier: 5 },
  { id: "NWAFU", name: "西北农林科技大学", tier: 5 },
  { id: "BIT", name: "北京理工大学", tier: 5 },
  { id: "HNU", name: "湖南大学", tier: 5 },
  { id: "DUT", name: "大连理工大学", tier: 5 },
  { id: "NEU", name: "东北大学", tier: 5 },
];

/* =========================
 * Abroad school pool (60) - Asia-leaning
 *  - tier: 1 strongest, 5 safest
 *  - matches UNIV_38: { id, name, tier }
 * ========================= */
const UNIV_ABROAD_60 = [
  // tier1
  { id: "MIT",     name: "Massachusetts Institute of Technology (MIT)（麻省理工学院）", tier: 1 },
  { id: "STAN",    name: "Stanford University（斯坦福大学）", tier: 1 },
  { id: "HARV",    name: "Harvard University（哈佛大学）", tier: 1 },
  { id: "OXF",     name: "University of Oxford（牛津大学）", tier: 1 },
  { id: "CAM",     name: "University of Cambridge（剑桥大学）", tier: 1 },
  { id: "ETH",     name: "ETH Zurich（苏黎世联邦理工学院）", tier: 1 },
  { id: "NUS",     name: "National University of Singapore (NUS)（新加坡国立大学）", tier: 1 },
  { id: "TSU",     name: "The University of Tokyo（东京大学）", tier: 1 },
  { id: "HKU",     name: "The University of Hong Kong (HKU)（香港大学）", tier: 1 },

  // tier2
  { id: "UCB",     name: "University of California, Berkeley（加州大学伯克利分校）", tier: 2 },
  { id: "CALTECH", name: "California Institute of Technology（加州理工学院）", tier: 2 },
  { id: "ICL",     name: "Imperial College London（帝国理工学院）", tier: 2 },
  { id: "UCL",     name: "University College London (UCL)（伦敦大学学院）", tier: 2 },
  { id: "EPFL",    name: "EPFL（洛桑联邦理工学院）", tier: 2 },
  { id: "NTU_SG",  name: "Nanyang Technological University (NTU)（南洋理工大学）", tier: 2 },
  { id: "HKUST",   name: "HKUST（香港科技大学）", tier: 2 },
  { id: "CUHK",    name: "The Chinese University of Hong Kong (CUHK)（香港中文大学）", tier: 2 },
  { id: "KAIST",   name: "KAIST（韩国科学技术院）", tier: 2 },
  { id: "POSTECH", name: "POSTECH（浦项工科大学）", tier: 2 },
  { id: "SNU",     name: "Seoul National University（首尔大学）", tier: 2 },
  { id: "KYOTO",   name: "Kyoto University（京都大学）", tier: 2 },
  { id: "TOHOKU",  name: "Tohoku University（东北大学·日本）", tier: 2 },

  // tier3
  { id: "UCLA",    name: "University of California, Los Angeles (UCLA)（加州大学洛杉矶分校）", tier: 3 },
  { id: "UCSD",    name: "University of California, San Diego (UCSD)（加州大学圣迭戈分校）", tier: 3 },
  { id: "UMICH",   name: "University of Michigan–Ann Arbor（密歇根大学安娜堡分校）", tier: 3 },
  { id: "UW",      name: "University of Washington（华盛顿大学）", tier: 3 },
  { id: "UIUC",    name: "University of Illinois Urbana-Champaign (UIUC)（伊利诺伊大学香槟分校）", tier: 3 },
  { id: "CMU",     name: "Carnegie Mellon University（卡内基梅隆大学）", tier: 3 },
  { id: "TOR",     name: "University of Toronto（多伦多大学）", tier: 3 },
  { id: "UBC",     name: "University of British Columbia (UBC)（不列颠哥伦比亚大学）", tier: 3 },
  { id: "EDIN",    name: "The University of Edinburgh（爱丁堡大学）", tier: 3 },
  { id: "HKPOLYU", name: "The Hong Kong Polytechnic University（香港理工大学）", tier: 3 },
  { id: "HKCITYU", name: "City University of Hong Kong（香港城市大学）", tier: 3 },
  { id: "HKBU",    name: "Hong Kong Baptist University（香港浸会大学）", tier: 3 },
  { id: "KOREA",   name: "Korea University（高丽大学）", tier: 3 },
  { id: "YONSEI",  name: "Yonsei University（延世大学）", tier: 3 },
  { id: "NTU_TW",  name: "National Taiwan University (NTU)（台湾大学）", tier: 3 },
  { id: "OSAKA",   name: "Osaka University（大阪大学）", tier: 3 },
  { id: "NAGOYA",  name: "Nagoya University（名古屋大学）", tier: 3 },

  // tier4
  { id: "KCL",     name: "King's College London (KCL)（伦敦国王学院）", tier: 4 },
  { id: "MANC",    name: "The University of Manchester（曼彻斯特大学）", tier: 4 },
  { id: "WARW",    name: "The University of Warwick（华威大学）", tier: 4 },
  { id: "BRIS",    name: "University of Bristol（布里斯托大学）", tier: 4 },
  { id: "MELB",    name: "The University of Melbourne（墨尔本大学）", tier: 4 },
  { id: "SYD",     name: "The University of Sydney（悉尼大学）", tier: 4 },
  { id: "UNSW",    name: "UNSW Sydney（新南威尔士大学）", tier: 4 },
  { id: "MONASH",  name: "Monash University（莫纳什大学）", tier: 4 },
  { id: "SMU_SG",  name: "Singapore Management University (SMU)（新加坡管理大学）", tier: 4 },
  { id: "SUTD",    name: "Singapore University of Technology and Design (SUTD)（新加坡科技设计大学）", tier: 4 },
  { id: "TOKYOTECH", name: "Tokyo Institute of Technology（东京工业大学）", tier: 4 },
  { id: "WASEDA",  name: "Waseda University（早稻田大学）", tier: 4 },
  { id: "KEIO",    name: "Keio University（庆应义塾大学）", tier: 4 },

  // tier5
  { id: "ANU",     name: "The Australian National University (ANU)（澳大利亚国立大学）", tier: 5 },
  { id: "UQ",      name: "The University of Queensland（昆士兰大学）", tier: 5 },
  { id: "UWA",     name: "The University of Western Australia（西澳大学）", tier: 5 },
  { id: "ADE",     name: "The University of Adelaide（阿德莱德大学）", tier: 5 },
  { id: "ASU",     name: "Arizona State University（亚利桑那州立大学）", tier: 5 },
  { id: "RUTG",    name: "Rutgers University–New Brunswick（罗格斯大学新布朗斯维克分校）", tier: 5 },
  { id: "NEU_US",  name: "Northeastern University（美国东北大学）", tier: 5 },
  { id: "NTNU_TW", name: "National Taiwan Normal University（台湾师范大学）", tier: 5 },
  { id: "HANYANG", name: "Hanyang University（汉阳大学）", tier: 5 },
  { id: "SKKU",    name: "Sungkyunkwan University (SKKU)（成均馆大学）", tier: 5 },
  { id: "TSUKUBA", name: "University of Tsukuba（筑波大学）", tier: 5 },
  { id: "KYUSHU",  name: "Kyushu University（九州大学）", tier: 5 },
];

/* =========================
 * 4) tier -> 阈值映射（保研/考研/出国/秋招/考公都会用）
 * ========================= */
const TIER_THRESHOLDS = {
  // 保研：入营阈值
  campInvite: { 1: 72, 2: 66, 3: 60, 4: 54, 5: 48 },
  // 保研：offer阈值（按 tier 基准）
  campOfferBase: { 1: 76, 2: 70, 3: 64, 4: 58, 5: 52 },

  // 考研：初试/复试学校线（可微调）
  kaoyanCutoff: { 1: 80, 2: 74, 3: 68, 4: 62, 5: 56 },

  // 出国：项目筛选阈值
  abroadScreen: { 1: 78, 2: 72, 3: 66, 4: 60, 5: 54 },

  // 秋招：公司门槛
  jobBar: { 1: 78, 2: 70, 3: 64, 4: 58, 5: 52 },

  // 考公：进面阈值
  civilIn: { 1: 80, 2: 72, 3: 66, 4: 60, 5: 54 },
};

/* =========================
 * 5) 五条支线配置：timeline hooks + action pools + scoring weights + 结果流程
 * ========================= */
const ROUTES = {
  /* ---------- 保研 ---------- */
  baoyan: {
    id: "baoyan",
    name: "保研",
    flow: "camp_prepush",
    needsSummer: true,
    needsWinter: false,
    // 插入段落规则：第6学期末已选保研 -> 插入暑假8周
    segments: {
      insertSummerIfChosenByEndOfTerm6: true,
      insertWinter: false,
    },

    // 阶段（引擎只要根据 segment+week 找 stage）
    stages: [
      { key: "SUMMER_SUBMIT", segment: "SUMMER", weeks: [1, 1], uiMode: "ROUTE_SPECIAL", actionPoolKey: "SUMMER_FREE", eventPoolKey: "SUMMER_EVENT" },
      { key: "SUMMER_WAIT_OR_CAMP", segment: "SUMMER", weeks: [2, 8], uiMode: "ROUTE_SPECIAL", actionPoolKey: "SUMMER_FREE", eventPoolKey: "SUMMER_EVENT" },
      { key: "TERM7_CLASSIC", segment: "TERM7", weeks: [1, 16], uiMode: "ROUTE_PANEL" },
      { key: "PREPUSH_CONFIRM", segment: "TERM7", weeks: [2, 2], uiMode: "ROUTE_SPECIAL", actionPoolKey: "PREPUSH_FREE", eventPoolKey: "PREPUSH_EVENT" },
      { key: "PREPUSH_INTERVIEW", segment: "TERM7", weeks: [3, 3], uiMode: "ROUTE_SPECIAL", actionPoolKey: "PREPUSH_FREE", eventPoolKey: "PREPUSH_EVENT" },
      { key: "BAOYAN_FINALIZE", segment: "TERM7", weeks: [4, 4], uiMode: "ROUTE_SPECIAL", actionPoolKey: "PREPUSH_FREE", eventPoolKey: "PREPUSH_EVENT" },
    ],

    // SUMMER 规则：第1周投5所；第2-8周出入营与营期冲突
    summerRules: {
      submitWeek: 1,
      submitLimit: 5,
      univPool: "UNIV_38",
      inviteNoticeWindow: [2, 8], // 通知出现周
      campWeekWindow: [2, 8],     // 营期周
      // 冲突规则使用全局 MAX_EVENTS_PER_WEEK
    },

    // TERM7 预推免规则
    prePushRules: {
      optInWeek: 2,
      submitLimit: 3,
      univPool: "UNIV_38",
      interviewWeek: 3,
      resultWeek: 4,
      scoringKey: "prePush",
      thresholdKey: "campOfferBase",
      logKeyResult: "prepushResult"
    },

    // 空档周行动池（每周2行动；有营期周：事件占1槽 + 自由1槽）
    actionPools: {
      SUMMER_FREE: [
        "study_major",
        "practice_english",
        "mock_interview",
        "polish_docs",
        "research_sprint",
        "recover_routine",
        "chill",
      ],
      SUMMER_EVENT: ["attend_interview"], // 参加夏令营面试（事件）
      PREPUSH_FREE: ["study_major", "practice_english", "mock_interview", "polish_docs", "recover_routine"],
      PREPUSH_EVENT: ["attend_interview"],
    },

    // 评分权重（统一 score=Σ(w*stat)+rand - penalty）
    scoring: {
      campInvite: { gpa: 0.35, english: 0.20, research: 0.15, docsQuality: 0.10, luck: 0.10, campPrep: 0.10 },
      campOffer:  { gpa: 0.30, english: 0.15, research: 0.15, interviewSkill: 0.15, majorSkill: 0.15, luck: 0.10 },
      prePush:    { gpa: 0.33, english: 0.17, research: 0.15, interviewSkill: 0.15, majorSkill: 0.10, luck: 0.10 },
    },

    // 结果判定：offer/候补/淘汰（候补可以在SUMMER末或TERM7第1周统一清算一次）
    resultRules: {
      offerBand: { offer: +8, waitlist: [-8, +8] }, // 相对阈值的区间
      thresholds: {
        inviteByTier: "campInvite",
        offerByTierBase: "campOfferBase",
      },
    },

    // 保底：本校保底录取
    fallback: {
      enabled: true,
      when: { segment: "TERM7", week: 4 },
      condition: "gpa>=baoyanQuota && failCourses==0 && noDiscipline==true",
      grant: { type: "offer", name: "本校保底录取", tier: 5 },
      logKey: "fallbackOffer"
    },
  },

  /* ---------- 考研 ---------- */
  kaoyan: {
    id: "kaoyan",
    name: "考研",
    flow: "exam_retest",
    needsSummer: true,
    needsWinter: true,
    segments: {
      insertSummerIfChosenByEndOfTerm6: true,
      insertWinter: true, // 出分等待&复试准备
    },
    stages: [
      { key: "SUMMER_PREP", segment: "SUMMER", weeks: [1, 8], uiMode: "ROUTE_SPECIAL", actionPoolKey: "SUMMER", eventPoolKey: "EXAM" },
      { key: "TERM7_GRIND", segment: "TERM7", weeks: [1, 15], uiMode: "ROUTE_PANEL", actionPoolKey: "TERM7" },
      { key: "TERM7_EXAM", segment: "TERM7", weeks: [16, 16], uiMode: "ROUTE_SPECIAL", actionPoolKey: "TERM7", eventPoolKey: "EXAM" },
      { key: "WINTER_SCORE", segment: "WINTER", weeks: [1, 4], uiMode: "ROUTE_SPECIAL", actionPoolKey: "WINTER" },
      { key: "TERM8_RETEST", segment: "TERM8", weeks: [1, 8], uiMode: "ROUTE_SPECIAL", actionPoolKey: "RETEST_FREE", eventPoolKey: "RETEST_EVENT" },
    ],
    summerRules: {
      chooseTargetsWeek: 1,
      targetLimit: 3, // 主1 + 备2
      univPool: "UNIV_38",
    },
    examRules: {
      examWeek: 16,
      scoringKey: "firstExam",
      thresholdKey: "kaoyanCutoff",
      resultDelay: 0,
      logKey: "kaoyanExam"
    },
    retestRules: {
      interviewWeek: 4,
      scoringKey: "retest",
      thresholdKey: "kaoyanCutoff",
      resultDelay: 0,
      logKey: "kaoyanRetest"
    },
    actionPools: {
      SUMMER: ["drill_exam", "study_major", "practice_english", "memorize_boost", "full_mock_exam", "recover_routine", "chill"],
      TERM7:  ["drill_exam", "study_major", "practice_english", "memorize_boost", "full_mock_exam", "recover_routine"],
      EXAM:   ["attend_exam"],
      WINTER: ["mock_interview", "study_major", "drill_exam", "recover_routine"],
      RETEST_FREE: ["mock_interview", "study_major", "practice_english", "recover_routine"],
      RETEST_EVENT: ["attend_interview"],
    },
    scoring: {
      firstExam: { examSkill: 0.45, majorSkill: 0.25, english: 0.15, luck: 0.10, gpa: 0.05 },
      retest:    { interviewSkill: 0.30, majorSkill: 0.25, english: 0.15, examSkill: 0.15, research: 0.10, luck: 0.05 },
      adjust:    { examSkill: 0.35, majorSkill: 0.20, luck: 0.20, english: 0.15, interviewSkill: 0.10 }, // 调剂更看运气+余量
    },
    thresholds: { byTier: "kaoyanCutoff" },
    fallback: {
      enabled: true,
      when: { segment: "TERM8", week: 8 },
      // 软保底：不强送上岸，但给不崩盘结局
      condition: "graduateOk==true && failCourses==0 && noDiscipline==true",
      grant: { type: "ending", name: "科研助理+二战选项（软保底）" },
      logKey: "fallbackOffer"
    },
  },

  /* ---------- 出国 ---------- */
  abroad: {
    id: "abroad",
    name: "出国",
    flow: "apply_interview",
    needsSummer: true,
    needsWinter: true,
    segments: {
      insertSummerIfChosenByEndOfTerm6: true,
      insertWinter: true,
    },
    stages: [
      { key: "SUMMER_DOCS", segment: "SUMMER", weeks: [1, 8], uiMode: "ROUTE_SPECIAL", actionPoolKey: "SUMMER" },
      { key: "TERM7_APPLY", segment: "TERM7", weeks: [1, 16], uiMode: "ROUTE_SPECIAL", actionPoolKey: "TERM7" }, // 申请季用专属界面更清晰
      { key: "WINTER_WAIT", segment: "WINTER", weeks: [1, 4], uiMode: "ROUTE_PANEL", actionPoolKey: "WINTER" },
      { key: "TERM8_INTERVIEW", segment: "TERM8", weeks: [1, 8], uiMode: "ROUTE_SPECIAL", actionPoolKey: "TERM8_FREE", eventPoolKey: "TERM8_EVENT" },
    ],
    applyRules: {
      totalSubmitLimit: 8,
      perWeekSubmitLimit: 2,
      // 项目池可先复用 UNIV_38 当作“项目按钮”，后续再换成 PROGRAM_40
      pool: "UNIV_38",
      resultWindowWeeksAfterSubmit: [2, 6], // 2-6周出状态
      interviewWindow: { segment: "TERM8", weeks: [1, 6] }, // 面试可能冲突
      screenScoringKey: "screen",
      interviewScoringKey: "interview",
      thresholdKey: "abroadScreen",
      logKeyScreen: "abroadScreen",
      logKeyInterview: "abroadInterview"
    },
    actionPools: {
      SUMMER: ["practice_english", "polish_docs", "research_sprint", "mock_interview", "recover_routine", "chill"],
      TERM7:  ["polish_docs", "practice_english", "research_sprint", "recover_routine"],
      TERM8_FREE: ["practice_english", "mock_interview", "research_sprint", "recover_routine"],
      TERM8_EVENT: ["attend_interview"],
    },
    scoring: {
      screen:   { gpa: 0.30, research: 0.25, english: 0.15, docsQuality: 0.15, majorSkill: 0.10, luck: 0.05 },
      interview:{ english: 0.30, interviewSkill: 0.25, research: 0.20, majorSkill: 0.15, luck: 0.10 },
      admit:    { gpa: 0.25, research: 0.25, docsQuality: 0.20, interviewResult: 0.15, english: 0.10, luck: 0.05 },
    },
    thresholds: { byTier: "abroadScreen" },
    fallback: {
      enabled: true,
      when: { segment: "TERM8", week: 8 },
      condition: "gpa>=70 && english>=60 && docsQuality>=60",
      grant: { type: "offer", name: "保底项目/港澳/联合培养 Offer", tier: 5 },
      logKey: "fallbackOffer"
    },
  },

  /* ---------- 秋招 ---------- */
  job: {
    id: "job",
    name: "秋招",
    flow: "job_pipeline",
    needsSummer: true,
    needsWinter: true,
    segments: {
      insertSummerIfChosenByEndOfTerm6: true,
      insertWinter: true, // 春招准备也可以塞冬季
    },
    stages: [
      { key: "SUMMER_EARLY", segment: "SUMMER", weeks: [1, 8], uiMode: "ROUTE_SPECIAL", actionPoolKey: "SUMMER" },
      { key: "TERM7_PEAK", segment: "TERM7", weeks: [1, 12], uiMode: "ROUTE_SPECIAL", actionPoolKey: "TERM7", eventPoolKey: "EVENT" },
      { key: "TERM7_LATE", segment: "TERM7", weeks: [13, 16], uiMode: "ROUTE_PANEL", actionPoolKey: "TERM7" },
      { key: "WINTER_PREP_SPRING", segment: "WINTER", weeks: [1, 4], uiMode: "ROUTE_PANEL", actionPoolKey: "SPRING" },
      { key: "TERM8_SPRING", segment: "TERM8", weeks: [3, 8], uiMode: "ROUTE_SPECIAL", actionPoolKey: "SPRING", eventPoolKey: "EVENT" },
    ],
    submitRules: {
      summerWeek1Limit: 8,
      term7TotalLimit: 15,
      term7PerWeekLimit: 3,
      // 公司池这里先做成名字列表（后续你想更精细可换 COMPANY_40 对象）
      pool: "COMPANY_40",
      // 面试/笔试安排：submit后1-2周触发笔试/一面；每轮间隔1-2周
      pipeline: { rounds: ["笔试", "一面", "二面", "HR面"], gapWeeks: [1, 2] },
      interviewWeeks: { segment: "TERM7", weeks: [1, 12] }, // 高峰冲突期
      springRules: { submitLimit: 5, noConflict: true }, // 春招兜底不冲突
      screenScoringKey: "resumeScreen",
      interviewScoringKey: "interview",
      thresholdKey: "jobBar",
      screenGap: [1, 2],
      interviewGap: [1, 2],
      logKeyScreen: "jobScreen",
      logKeyInterview: "jobInterview"
    },
    actionPools: {
      SUMMER: ["resume_opt", "project_polish", "drill_exam", "mock_interview", "practice_english", "recover_routine", "chill"],
      TERM7:  ["resume_opt", "project_polish", "drill_exam", "mock_interview", "recover_routine"],
      EVENT:  ["attend_interview", "attend_exam"], // 秋招可能笔试也可能面试
      SPRING: ["resume_opt", "mock_interview", "project_polish", "recover_routine"],
    },
    scoring: {
      resumeScreen: { gpa: 0.25, resumeQuality: 0.25, projectPortfolio: 0.20, english: 0.10, majorSkill: 0.15, luck: 0.05 },
      interview:    { interviewSkill: 0.30, majorSkill: 0.25, projectPortfolio: 0.20, english: 0.10, resumeQuality: 0.10, luck: 0.05 },
    },
    thresholds: { byTier: "jobBar" },
    fallback: {
      enabled: true,
      when: { segment: "TERM8", week: 8 },
      condition: "graduateOk==true && failCourses==0 && noDiscipline==true",
      grant: { type: "offer", name: "校招保底/中小企业 Offer", tier: 5 },
      logKey: "fallbackOffer"
    },
  },

  /* ---------- 考公 ---------- */
  civil: {
    id: "civil",
    name: "考公",
    flow: "civil_exam",
    needsSummer: true,
    needsWinter: true,
    segments: {
      insertSummerIfChosenByEndOfTerm6: true,
      insertWinter: true,
    },
    stages: [
      { key: "SUMMER_BASE", segment: "SUMMER", weeks: [1, 8], uiMode: "ROUTE_SPECIAL", actionPoolKey: "SUMMER" },
      { key: "TERM7_SELECT", segment: "TERM7", weeks: [2, 2], uiMode: "ROUTE_SPECIAL", actionPoolKey: "TERM7" },
      { key: "TERM7_WRITTEN", segment: "TERM7", weeks: [12, 13], uiMode: "ROUTE_SPECIAL", actionPoolKey: "TERM7", eventPoolKey: "WRITTEN" },
      { key: "TERM8_INTERVIEW", segment: "TERM8", weeks: [4, 4], uiMode: "ROUTE_SPECIAL", actionPoolKey: "TERM7", eventPoolKey: "INTERVIEW" },
      { key: "TERM8_FINAL", segment: "TERM8", weeks: [6, 6], uiMode: "ROUTE_SPECIAL", actionPoolKey: "TERM7", eventPoolKey: "INTERVIEW" },
    ],
    jobRules: {
      pool: "CIVIL_JOB_30",
      chooseLimit: 1,
    },
    examRules: {
      writtenWeeks: [12, 13],
      interviewWeek: 4,
      finalWeek: 6,
      scoringKey: "written",
      interviewScoringKey: "interview",
      logKeyWritten: "civilWritten",
      logKeyInterview: "civilInterview"
    },
    actionPools: {
      SUMMER: ["civil_drill_xc", "civil_write_sl", "mock_interview", "recover_routine", "chill"],
      TERM7:  ["civil_drill_xc", "civil_write_sl", "mock_interview", "recover_routine"],
      WRITTEN: ["attend_exam"],
      INTERVIEW: ["attend_interview"],
    },
    scoring: {
      written:  { examSkill: 0.45, politicsSkill: 0.25, english: 0.15, luck: 0.10, gpa: 0.05 },
      interview:{ interviewSkill: 0.35, politicsSkill: 0.25, healthStability: 0.20, luck: 0.10, majorSkill: 0.10 },
      finalCheckProb: { base: 0.70, healthFactor: 1/200, luckFactor: 1/300 }, // 体检政审简化
    },
    thresholds: { byTier: "civilIn" },
    fallback: {
      enabled: true,
      when: { segment: "TERM8", week: 8 },
      condition: "graduateOk==true && failCourses==0 && noDiscipline==true",
      grant: { type: "offer", name: "基层/合同制/国企行政岗 保底 Offer", tier: 5 },
      logKey: "fallbackOffer"
    },
  },
};

/* =========================
 * 6) 秋招公司池、考公岗位池（先给可用的名字列表，Codex可随时换成对象）
 * ========================= */
const COMPANY_40 = [
  // 互联网/科技（tier1-2）
  "字节跳动","腾讯","阿里巴巴","华为","美团","京东","网易","百度","小米","滴滴",
  // 外企/金融/咨询（tier2-3）
  "微软","谷歌(中国岗)","亚马逊","苹果(中国岗)","麦肯锡","波士顿咨询","贝恩","德勤","普华永道","安永",
  // 生物医药/器械（tier2-4）
  "药明康德","药明生物","恒瑞医药","百济神州","信达生物","复星医药","迈瑞医疗","联影医疗",
  // 国企/央企/研究院（tier3-5）
  "中科院系统单位","国家电网","中国移动","中国电信","中石化","中石油","中国航天科工","中国船舶","中车集团","地方国企平台公司",
];

const CIVIL_JOB_30 = [
  "中央部委综合岗A","中央部委综合岗B",
  "省直机关综合岗A","省直机关综合岗B","省直机关法务岗","省直机关财会岗",
  "市直机关综合岗A","市直机关综合岗B","市直机关宣传岗",
  "区县机关综合岗A","区县机关综合岗B",
  "税务系统岗A","税务系统岗B",
  "海关系统岗A","海关系统岗B",
  "银保监系统岗","证监系统岗",
  "统计系统岗","市场监管岗","人社系统岗",
  "街道办综合岗","乡镇基层岗A","乡镇基层岗B",
  "公安文职岗","检法辅助岗",
  "事业单位综合岗A","事业单位综合岗B","事业单位科研岗",
];

// 岗位规格（tier + track）
const CIVIL_JOB_SPEC = {
  "中央部委综合岗A": { tier: 1, track: "general" },
  "中央部委综合岗B": { tier: 1, track: "general" },

  "省直机关综合岗A": { tier: 2, track: "general" },
  "省直机关综合岗B": { tier: 2, track: "general" },
  "省直机关法务岗":   { tier: 2, track: "law" },
  "省直机关财会岗":   { tier: 2, track: "finance" },

  "市直机关综合岗A": { tier: 3, track: "general" },
  "市直机关综合岗B": { tier: 3, track: "general" },
  "市直机关宣传岗":   { tier: 3, track: "propaganda" },

  "区县机关综合岗A": { tier: 4, track: "general" },
  "区县机关综合岗B": { tier: 4, track: "general" },

  "税务系统岗A":     { tier: 3, track: "tax" },
  "税务系统岗B":     { tier: 3, track: "tax" },

  "海关系统岗A":     { tier: 2, track: "customs" },
  "海关系统岗B":     { tier: 2, track: "customs" },

  "银保监系统岗":     { tier: 2, track: "finreg" },
  "证监系统岗":       { tier: 2, track: "finreg" },

  "统计系统岗":       { tier: 3, track: "stats" },
  "市场监管岗":       { tier: 3, track: "market" },
  "人社系统岗":       { tier: 3, track: "hr" },

  "街道办综合岗":     { tier: 5, track: "grassroots" },
  "乡镇基层岗A":      { tier: 5, track: "grassroots" },
  "乡镇基层岗B":      { tier: 5, track: "grassroots" },

  "公安文职岗":       { tier: 4, track: "police" },
  "检法辅助岗":       { tier: 3, track: "judicial" },

  "事业单位综合岗A":  { tier: 4, track: "inst_general" },
  "事业单位综合岗B":  { tier: 4, track: "inst_general" },
  "事业单位科研岗":    { tier: 4, track: "inst_research" },
};

const ROUTE_ID_MAP = {
  pushmian: "baoyan",
  job: "job",
  overseas: "abroad",
  postgrad: "kaoyan",
  civil: "civil"
};

window.ROUTE_SPEC = {
  ROUTE_GLOBAL,
  ROUTE_ID_MAP,
  ROUTE_STATE_SCHEMA,
  ROUTE_ACTIONS,
  UNIV_38,
  TIER_THRESHOLDS,
  ROUTES,
  COMPANY_40,
  CIVIL_JOB_30
};

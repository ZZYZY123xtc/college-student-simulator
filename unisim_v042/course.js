// course.js
// =========================
// 大学生模拟器 v0.4.2 课程系统（培养方案版）
// - window.COURSE.generatePlan(academyZh)
// - 输出接口对齐 game.js：
//   { graduateCredits, termTargetCredits, lockedByTerm, planByTerm, coursePool }
// - 强制课锁死：体育1-4、大学英语1-2、学术英语读写（大二）、思政顺序（前六学期）
// - 课程带 timeslots（上课时间），冲突检测靠 timeslots
// =========================
(() => {
  const TIME_SLOTS = [
    "Mon-1", "Mon-2", "Mon-3",
    "Tue-1", "Tue-2", "Tue-3",
    "Wed-1", "Wed-2", "Wed-3",
    "Thu-1", "Thu-2", "Thu-3",
    "Fri-1", "Fri-2", "Fri-3",
  ];

  function normalizeAcademy(academyZh) {
    if (academyZh === "理工") return "stem";
    if (academyZh === "商科") return "biz";
    if (academyZh === "医" || academyZh === "医学") return "medicine";
    return "arts"; // 文社
  }

  function courseId(name) {
    return name.replace(/\s+/g, "_").replace(/[^\w\u4e00-\u9fa5]/g, "");
  }

  // 随机选择一个可用的 timeslot
  function pickRandomTimeslot(excludeSlots = []) {
    const excludeSet = new Set(excludeSlots);
    const available = TIME_SLOTS.filter(slot => !excludeSet.has(slot));
    if (available.length === 0) {
      // 如果所有时间都被占用，随机返回一个（允许冲突）
      return TIME_SLOTS[Math.floor(Math.random() * TIME_SLOTS.length)];
    }
    return available[Math.floor(Math.random() * available.length)];
  }

  function mkCourse({
    name,
    credits = 2,
    difficulty = 3,
    examLoad = 2,
    required = false,
    locked = false,
    chainGroup = "",
    chainOrder = null,
    area = "",
    type = "",
    category = "",
    isMandatory = false,
    tag = "",
    suggestedTerm = 1,
    slot = null,
    autoAssignSlot = false, // 新增：是否自动分配 slot
  }) {
    const id = courseId(name);
    let timeslots = [];
    
    if (slot) {
      // 如果明确指定了 slot，使用它
      timeslots = [slot];
    } else if (autoAssignSlot) {
      // 如果需要自动分配，随机选择一个
      timeslots = [pickRandomTimeslot()];
    }
    // 如果 slot 为 null 且 autoAssignSlot 为 false，timeslots 保持为空数组
    // 后续会在 generatePlan 中统一分配
    
    let derivedCategory = category;
    if (!derivedCategory) {
      const nameStr = String(name || "");
      const areaStr = String(area || "");
      if (chainGroup === "pe" || nameStr.includes("体育") || areaStr.includes("体育")) {
        derivedCategory = "PE";
      } else if (chainGroup === "english" || nameStr.includes("英语") || areaStr.includes("英语")) {
        derivedCategory = "EN";
      } else if (chainGroup === "politics" || nameStr.includes("思政") || nameStr.includes("政治") || areaStr.includes("思政")) {
        derivedCategory = "POLITICS";
      } else {
        derivedCategory = "MAJOR";
      }
    }

    const derivedMandatory = Boolean(isMandatory || (required && locked));

    return {
      id,
      name,
      credits,
      difficulty,
      examLoad,
      required,
      locked,
      chainGroup,
      chainOrder,
      area,
      category: derivedCategory,
      isMandatory: derivedMandatory,
      tag: tag || (derivedMandatory ? "强制" : ""),
      type,
      suggestedTerm,
      term: suggestedTerm,
      timeslots
    };
  }

  function courseConflicts(a, b) {
    const A = new Set(a.timeslots || []);
    for (const t of (b.timeslots || [])) if (A.has(t)) return true;
    return false;
  }

  function conflictsWithAny(course, list) {
    return list.some(c => courseConflicts(course, c));
  }

  function sumCredits(list) {
    return list.reduce((s, c) => s + Number(c.credits || 0), 0);
  }
  const CATEGORY_LIMITS = { PE: 1, EN: 1 };

  function countCategory(list, category) {
    return list.filter(c => c.category === category).length;
  }


  // ===== 强制通用课（所有学院通用） =====
  const GENERAL_REQUIRED_SEQUENCE = [
    mkCourse({ name: "体育1", credits: 1, difficulty: 1, examLoad: 1, required: true, locked: true, chainGroup: "pe", chainOrder: 1, area: "体育", suggestedTerm: 1, slot: "Mon-1" }),
    mkCourse({ name: "体育2", credits: 1, difficulty: 1, examLoad: 1, required: true, locked: true, chainGroup: "pe", chainOrder: 2, area: "体育", suggestedTerm: 2, slot: "Mon-1" }),
    mkCourse({ name: "体育3", credits: 1, difficulty: 1, examLoad: 1, required: true, locked: true, chainGroup: "pe", chainOrder: 3, area: "体育", suggestedTerm: 3, slot: "Mon-1" }),
    mkCourse({ name: "体育4", credits: 1, difficulty: 1, examLoad: 1, required: true, locked: true, chainGroup: "pe", chainOrder: 4, area: "体育", suggestedTerm: 4, slot: "Mon-1" }),

    mkCourse({ name: "大学英语1", credits: 3, difficulty: 3, examLoad: 2, required: true, locked: true, chainGroup: "english", chainOrder: 1, area: "英语", suggestedTerm: 1, slot: "Tue-1" }),
    mkCourse({ name: "大学英语2", credits: 3, difficulty: 3, examLoad: 2, required: true, locked: true, chainGroup: "english", chainOrder: 2, area: "英语", suggestedTerm: 2, slot: "Tue-1" }),

    mkCourse({ name: "学术英语阅读", credits: 2, difficulty: 3, examLoad: 2, required: true, locked: true, chainGroup: "english", chainOrder: 3, area: "英语", suggestedTerm: 3, slot: "Tue-2" }),
    mkCourse({ name: "学术英语写作", credits: 2, difficulty: 4, examLoad: 2, required: true, locked: true, chainGroup: "english", chainOrder: 4, area: "英语", suggestedTerm: 4, slot: "Tue-2" }),

    mkCourse({ name: "思政导论", credits: 2, difficulty: 2, examLoad: 2, required: true, locked: true, chainGroup: "politics", chainOrder: 1, area: "思政", suggestedTerm: 1, slot: "Wed-1" }),
    mkCourse({ name: "中国近代史纲要", credits: 2, difficulty: 2, examLoad: 2, required: true, locked: true, chainGroup: "politics", chainOrder: 2, area: "思政", suggestedTerm: 2, slot: "Wed-1" }),
    mkCourse({ name: "马克思主义基本原理", credits: 3, difficulty: 3, examLoad: 3, required: true, locked: true, chainGroup: "politics", chainOrder: 3, area: "思政", suggestedTerm: 3, slot: "Wed-1" }),
    mkCourse({ name: "毛泽东思想和中国特色社会主义理论体系概论", credits: 3, difficulty: 3, examLoad: 3, required: true, locked: true, chainGroup: "politics", chainOrder: 4, area: "思政", suggestedTerm: 4, slot: "Wed-1" }),
    mkCourse({ name: "习近平新时代中国特色社会主义思想概论", credits: 3, difficulty: 3, examLoad: 3, required: true, locked: true, chainGroup: "politics", chainOrder: 5, area: "思政", suggestedTerm: 5, slot: "Wed-1" }),
    mkCourse({ name: "形势与政策", credits: 1, difficulty: 1, examLoad: 1, required: true, locked: true, chainGroup: "politics", chainOrder: 6, area: "思政", suggestedTerm: 6, slot: "Wed-1" }),
    mkCourse({ name: "形势与政策2", credits: 1, difficulty: 1, examLoad: 1, required: true, locked: true, chainGroup: "politics", chainOrder: 7, area: "思政", suggestedTerm: 7, slot: "Wed-1" }),
    mkCourse({ name: "形势与政策3", credits: 1, difficulty: 1, examLoad: 1, required: true, locked: true, chainGroup: "politics", chainOrder: 8, area: "思政", suggestedTerm: 8, slot: "Wed-1" }),
  ];

  function getTermRequiredGeneral(term) {
    return GENERAL_REQUIRED_SEQUENCE.filter(c => c.suggestedTerm === term);
  }

  // ===== 学院核心课池（可继续加厚） =====
  function buildAcademyPool(academyNorm) {
    const pool = [];

    if (academyNorm === "stem") {
      pool.push(
        // 1-2学期：基础课
        mkCourse({ name: "高等数学A", credits: 4, difficulty: 5, examLoad: 3, required: true, area: "理工", suggestedTerm: 1, slot: "Thu-1" }),
        mkCourse({ name: "线性代数", credits: 3, difficulty: 4, examLoad: 3, required: true, area: "理工", suggestedTerm: 1, slot: "Fri-1" }),
        mkCourse({ name: "大学物理", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "理工", suggestedTerm: 1, slot: "Thu-2" }),
        mkCourse({ name: "高等数学B", credits: 4, difficulty: 5, examLoad: 3, required: true, area: "理工", suggestedTerm: 2, slot: "Thu-1" }),
        mkCourse({ name: "程序设计基础", credits: 3, difficulty: 3, examLoad: 2, required: true, area: "理工", suggestedTerm: 2, slot: "Thu-2" }),
        mkCourse({ name: "概率论与数理统计", credits: 3, difficulty: 4, examLoad: 3, required: true, area: "理工", suggestedTerm: 2, slot: "Fri-2" }),
        mkCourse({ name: "数据分析入门", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "理工", suggestedTerm: 2, slot: "Wed-2" }),
        mkCourse({ name: "电路与电子技术", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "理工", suggestedTerm: 2, slot: "Fri-3" }),

        // 3-4学期：核心课
        mkCourse({ name: "数据结构", credits: 3, difficulty: 4, examLoad: 3, required: true, area: "理工", suggestedTerm: 3, slot: "Thu-3" }),
        mkCourse({ name: "离散数学", credits: 3, difficulty: 4, examLoad: 3, required: true, area: "理工", suggestedTerm: 3, slot: "Fri-3" }),
        mkCourse({ name: "计算机组成", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "理工", suggestedTerm: 3, slot: "Wed-3" }),
        mkCourse({ name: "面向对象程序设计", credits: 3, difficulty: 3, examLoad: 2, required: false, area: "理工", suggestedTerm: 3, slot: "Mon-3" }),
        mkCourse({ name: "操作系统", credits: 3, difficulty: 4, examLoad: 3, required: true, area: "理工", suggestedTerm: 4, slot: "Thu-1" }),
        mkCourse({ name: "数据库基础", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "理工", suggestedTerm: 4, slot: "Fri-1" }),
        mkCourse({ name: "算法设计", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "理工", suggestedTerm: 4, slot: "Fri-2" }),
        mkCourse({ name: "计算机网络", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "理工", suggestedTerm: 4, slot: "Wed-2" }),
        mkCourse({ name: "编译原理", credits: 3, difficulty: 5, examLoad: 3, required: false, area: "理工", suggestedTerm: 4, slot: "Thu-2" }),

        // 5-6学期：进阶/方向课
        mkCourse({ name: "机器学习导论", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "理工", suggestedTerm: 5, slot: "Thu-2" }),
        mkCourse({ name: "统计学习", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "理工", suggestedTerm: 5, slot: "Fri-2" }),
        mkCourse({ name: "生物信息学导论", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "理工", suggestedTerm: 5, slot: "Tue-3" }),
        mkCourse({ name: "人工智能基础", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "理工", suggestedTerm: 5, slot: "Mon-2" }),
        mkCourse({ name: "计算机图形学", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "理工", suggestedTerm: 5, slot: "Wed-3" }),
        mkCourse({ name: "信息安全导论", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "理工", suggestedTerm: 5, slot: "Tue-2" }),
        mkCourse({ name: "深度学习入门", credits: 3, difficulty: 5, examLoad: 3, required: false, area: "理工", suggestedTerm: 6, slot: "Thu-3" }),
        mkCourse({ name: "软件工程", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "理工", suggestedTerm: 6, slot: "Mon-2" }),
        mkCourse({ name: "大数据技术", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "理工", suggestedTerm: 6, slot: "Fri-1" }),
        mkCourse({ name: "分布式系统", credits: 3, difficulty: 5, examLoad: 3, required: false, area: "理工", suggestedTerm: 6, slot: "Wed-2" }),
        mkCourse({ name: "云计算技术", credits: 2, difficulty: 4, examLoad: 2, required: false, area: "理工", suggestedTerm: 6, slot: "Tue-3" }),
        mkCourse({ name: "数字图像处理", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "理工", suggestedTerm: 6, slot: "Thu-2" }),

        // 7学期：高阶/实践
        mkCourse({ name: "科研项目实践", credits: 4, difficulty: 4, examLoad: 2, required: false, area: "理工", suggestedTerm: 7, slot: "Wed-2" }),
        mkCourse({ name: "自然语言处理", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "理工", suggestedTerm: 7, slot: "Thu-1" }),
        mkCourse({ name: "计算机视觉", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "理工", suggestedTerm: 7, slot: "Fri-2" }),
        mkCourse({ name: "高级算法设计", credits: 3, difficulty: 5, examLoad: 3, required: false, area: "理工", suggestedTerm: 7, slot: "Thu-3" }),
        mkCourse({ name: "软件架构设计", credits: 2, difficulty: 4, examLoad: 2, required: false, area: "理工", suggestedTerm: 7, slot: "Mon-3" }),
        mkCourse({ name: "移动应用开发", credits: 3, difficulty: 3, examLoad: 2, required: false, area: "理工", suggestedTerm: 7, slot: "Wed-3" }),

        // 8学期：毕业
        mkCourse({ name: "毕业设计/论文", credits: 6, difficulty: 4, examLoad: 2, required: true, area: "理工", suggestedTerm: 8, slot: "Thu-1" }),
      );
    }

    if (academyNorm === "medicine") {
      pool.push(
        // 1-2学期：基础医学
        mkCourse({ name: "人体解剖学", credits: 4, difficulty: 5, examLoad: 3, required: true, area: "医学", suggestedTerm: 1, slot: "Thu-1" }),
        mkCourse({ name: "医学细胞生物学", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "医学", suggestedTerm: 1, slot: "Fri-1" }),
        mkCourse({ name: "组织胚胎学", credits: 3, difficulty: 4, examLoad: 3, required: true, area: "医学", suggestedTerm: 1, slot: "Wed-2" }),
        mkCourse({ name: "医学遗传学", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "医学", suggestedTerm: 1, slot: "Tue-2" }),
        mkCourse({ name: "生理学", credits: 3, difficulty: 4, examLoad: 3, required: true, area: "医学", suggestedTerm: 2, slot: "Thu-2" }),
        mkCourse({ name: "生物化学", credits: 3, difficulty: 4, examLoad: 3, required: true, area: "医学", suggestedTerm: 2, slot: "Fri-2" }),
        mkCourse({ name: "免疫学", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "医学", suggestedTerm: 2, slot: "Wed-3" }),
        mkCourse({ name: "医学统计学", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "医学", suggestedTerm: 2, slot: "Tue-3" }),

        // 3-4学期：核心医学
        mkCourse({ name: "病理学", credits: 3, difficulty: 4, examLoad: 3, required: true, area: "医学", suggestedTerm: 3, slot: "Thu-3" }),
        mkCourse({ name: "微生物学", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "医学", suggestedTerm: 3, slot: "Fri-3" }),
        mkCourse({ name: "寄生虫学", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "医学", suggestedTerm: 3, slot: "Wed-2" }),
        mkCourse({ name: "病理生理学", credits: 3, difficulty: 4, examLoad: 3, required: true, area: "医学", suggestedTerm: 4, slot: "Thu-1" }),
        mkCourse({ name: "药理学", credits: 3, difficulty: 4, examLoad: 3, required: true, area: "医学", suggestedTerm: 4, slot: "Fri-1" }),
        mkCourse({ name: "诊断学", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "医学", suggestedTerm: 4, slot: "Thu-2" }),
        mkCourse({ name: "医学影像学", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "医学", suggestedTerm: 4, slot: "Wed-3" }),

        // 5-6学期：临床医学
        mkCourse({ name: "内科学", credits: 4, difficulty: 5, examLoad: 3, required: false, area: "医学", suggestedTerm: 5, slot: "Thu-2" }),
        mkCourse({ name: "外科学", credits: 4, difficulty: 5, examLoad: 3, required: false, area: "医学", suggestedTerm: 5, slot: "Fri-2" }),
        mkCourse({ name: "妇产科学", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "医学", suggestedTerm: 5, slot: "Wed-2" }),
        mkCourse({ name: "儿科学", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "医学", suggestedTerm: 5, slot: "Tue-3" }),
        mkCourse({ name: "临床见习", credits: 4, difficulty: 4, examLoad: 2, required: true, area: "医学", suggestedTerm: 6, slot: "Thu-3" }),
        mkCourse({ name: "神经病学", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "医学", suggestedTerm: 6, slot: "Fri-1" }),
        mkCourse({ name: "精神病学", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "医学", suggestedTerm: 6, slot: "Wed-3" }),
        mkCourse({ name: "传染病学", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "医学", suggestedTerm: 6, slot: "Tue-2" }),
        mkCourse({ name: "急诊医学", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "医学", suggestedTerm: 6, slot: "Mon-2" }),

        // 7学期：进阶/科研
        mkCourse({ name: "科研/病例报告写作", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "医学", suggestedTerm: 7, slot: "Tue-3" }),
        mkCourse({ name: "临床技能训练", credits: 3, difficulty: 3, examLoad: 1, required: false, area: "医学", suggestedTerm: 7, slot: "Thu-1" }),
        mkCourse({ name: "医学伦理学", credits: 2, difficulty: 2, examLoad: 1, required: false, area: "医学", suggestedTerm: 7, slot: "Wed-2" }),
        mkCourse({ name: "循证医学", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "医学", suggestedTerm: 7, slot: "Fri-2" }),
        mkCourse({ name: "临床药理学", credits: 2, difficulty: 4, examLoad: 2, required: false, area: "医学", suggestedTerm: 7, slot: "Thu-2" }),

        // 8学期：毕业
        mkCourse({ name: "毕业实习/论文", credits: 6, difficulty: 4, examLoad: 2, required: true, area: "医学", suggestedTerm: 8, slot: "Thu-1" }),
      );
    }

    if (academyNorm === "biz") {
      pool.push(
        // 1-2学期：基础课
        mkCourse({ name: "微观经济学", credits: 3, difficulty: 4, examLoad: 3, required: true, area: "商科", suggestedTerm: 1, slot: "Thu-1" }),
        mkCourse({ name: "管理学导论", credits: 3, difficulty: 3, examLoad: 2, required: true, area: "商科", suggestedTerm: 1, slot: "Fri-1" }),
        mkCourse({ name: "经济数学", credits: 3, difficulty: 4, examLoad: 3, required: true, area: "商科", suggestedTerm: 1, slot: "Wed-1" }),
        mkCourse({ name: "宏观经济学", credits: 3, difficulty: 4, examLoad: 3, required: true, area: "商科", suggestedTerm: 2, slot: "Thu-2" }),
        mkCourse({ name: "会计学基础", credits: 3, difficulty: 3, examLoad: 2, required: true, area: "商科", suggestedTerm: 2, slot: "Fri-2" }),
        mkCourse({ name: "经济法", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "商科", suggestedTerm: 2, slot: "Wed-2" }),

        // 3-4学期：核心课
        mkCourse({ name: "统计学（商科）", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "商科", suggestedTerm: 3, slot: "Thu-3" }),
        mkCourse({ name: "市场营销", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "商科", suggestedTerm: 3, slot: "Fri-3" }),
        mkCourse({ name: "财务管理", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "商科", suggestedTerm: 3, slot: "Wed-2" }),
        mkCourse({ name: "中级财务会计", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "商科", suggestedTerm: 3, slot: "Tue-2" }),
        mkCourse({ name: "商业案例分析", credits: 3, difficulty: 4, examLoad: 2, required: false, area: "商科", suggestedTerm: 4, slot: "Thu-1" }),
        mkCourse({ name: "运营管理", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "商科", suggestedTerm: 4, slot: "Fri-1" }),
        mkCourse({ name: "组织行为学", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "商科", suggestedTerm: 4, slot: "Wed-3" }),
        mkCourse({ name: "人力资源管理", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "商科", suggestedTerm: 4, slot: "Tue-3" }),

        // 5-6学期：进阶/方向课
        mkCourse({ name: "公司金融", credits: 3, difficulty: 5, examLoad: 3, required: false, area: "商科", suggestedTerm: 5, slot: "Thu-2" }),
        mkCourse({ name: "战略管理", credits: 3, difficulty: 4, examLoad: 2, required: false, area: "商科", suggestedTerm: 5, slot: "Fri-2" }),
        mkCourse({ name: "投资学", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "商科", suggestedTerm: 5, slot: "Wed-2" }),
        mkCourse({ name: "国际金融", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "商科", suggestedTerm: 5, slot: "Tue-2" }),
        mkCourse({ name: "消费者行为学", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "商科", suggestedTerm: 5, slot: "Mon-2" }),
        mkCourse({ name: "实习与职场实践", credits: 4, difficulty: 3, examLoad: 1, required: false, area: "商科", suggestedTerm: 6, slot: "Tue-3" }),
        mkCourse({ name: "金融风险管理", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "商科", suggestedTerm: 6, slot: "Thu-1" }),
        mkCourse({ name: "供应链管理", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "商科", suggestedTerm: 6, slot: "Fri-1" }),
        mkCourse({ name: "品牌管理", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "商科", suggestedTerm: 6, slot: "Wed-3" }),
        mkCourse({ name: "审计学", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "商科", suggestedTerm: 6, slot: "Thu-2" }),

        // 7学期：高阶/专题
        mkCourse({ name: "高级财务管理", credits: 3, difficulty: 5, examLoad: 3, required: false, area: "商科", suggestedTerm: 7, slot: "Thu-1" }),
        mkCourse({ name: "企业并购与重组", credits: 2, difficulty: 4, examLoad: 2, required: false, area: "商科", suggestedTerm: 7, slot: "Fri-2" }),
        mkCourse({ name: "国际商务", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "商科", suggestedTerm: 7, slot: "Wed-2" }),
        mkCourse({ name: "创业管理", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "商科", suggestedTerm: 7, slot: "Tue-3" }),
        mkCourse({ name: "商业数据分析", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "商科", suggestedTerm: 7, slot: "Thu-2" }),

        // 8学期：毕业
        mkCourse({ name: "毕业论文", credits: 6, difficulty: 3, examLoad: 2, required: true, area: "商科", suggestedTerm: 8, slot: "Thu-1" }),
      );
    }

    if (academyNorm === "arts") {
      pool.push(
        // 1-2学期：基础课
        mkCourse({ name: "学术写作基础", credits: 2, difficulty: 3, examLoad: 2, required: true, area: "文社", suggestedTerm: 1, slot: "Thu-1" }),
        mkCourse({ name: "经典阅读", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "文社", suggestedTerm: 1, slot: "Fri-1" }),
        mkCourse({ name: "社会学导论", credits: 3, difficulty: 3, examLoad: 2, required: true, area: "文社", suggestedTerm: 1, slot: "Wed-1" }),
        mkCourse({ name: "社会调查方法", credits: 3, difficulty: 4, examLoad: 3, required: true, area: "文社", suggestedTerm: 2, slot: "Thu-2" }),
        mkCourse({ name: "统计入门（社科）", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "文社", suggestedTerm: 2, slot: "Fri-2" }),
        mkCourse({ name: "人类学导论", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "文社", suggestedTerm: 2, slot: "Wed-2" }),
        mkCourse({ name: "政治学原理", credits: 3, difficulty: 3, examLoad: 2, required: false, area: "文社", suggestedTerm: 2, slot: "Tue-2" }),

        // 3-4学期：核心课
        mkCourse({ name: "论文写作工作坊", credits: 3, difficulty: 4, examLoad: 2, required: true, area: "文社", suggestedTerm: 3, slot: "Thu-3" }),
        mkCourse({ name: "定量研究方法", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "文社", suggestedTerm: 3, slot: "Fri-3" }),
        mkCourse({ name: "质性研究方法", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "文社", suggestedTerm: 3, slot: "Wed-3" }),
        mkCourse({ name: "社会心理学", credits: 3, difficulty: 3, examLoad: 2, required: false, area: "文社", suggestedTerm: 3, slot: "Tue-3" }),
        mkCourse({ name: "社会理论", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "文社", suggestedTerm: 4, slot: "Thu-1" }),
        mkCourse({ name: "文化研究导论", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "文社", suggestedTerm: 4, slot: "Fri-1" }),
        mkCourse({ name: "发展社会学", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "文社", suggestedTerm: 4, slot: "Wed-2" }),
        mkCourse({ name: "城市社会学", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "文社", suggestedTerm: 4, slot: "Tue-2" }),

        // 5-6学期：进阶/方向课
        mkCourse({ name: "田野调查", credits: 3, difficulty: 4, examLoad: 2, required: false, area: "文社", suggestedTerm: 5, slot: "Tue-3" }),
        mkCourse({ name: "高级社会统计", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "文社", suggestedTerm: 5, slot: "Thu-2" }),
        mkCourse({ name: "社会网络分析", credits: 2, difficulty: 4, examLoad: 2, required: false, area: "文社", suggestedTerm: 5, slot: "Fri-2" }),
        mkCourse({ name: "性别研究", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "文社", suggestedTerm: 5, slot: "Wed-2" }),
        mkCourse({ name: "环境社会学", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "文社", suggestedTerm: 5, slot: "Mon-2" }),
        mkCourse({ name: "社会政策分析", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "文社", suggestedTerm: 6, slot: "Thu-1" }),
        mkCourse({ name: "比较社会学", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "文社", suggestedTerm: 6, slot: "Fri-1" }),
        mkCourse({ name: "历史社会学", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "文社", suggestedTerm: 6, slot: "Wed-3" }),
        mkCourse({ name: "媒体与社会", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "文社", suggestedTerm: 6, slot: "Tue-2" }),

        // 7学期：高阶/专题
        mkCourse({ name: "高级研究方法专题", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "文社", suggestedTerm: 7, slot: "Thu-1" }),
        mkCourse({ name: "社会分层与流动", credits: 2, difficulty: 4, examLoad: 2, required: false, area: "文社", suggestedTerm: 7, slot: "Fri-2" }),
        mkCourse({ name: "全球化研究", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "文社", suggestedTerm: 7, slot: "Wed-2" }),
        mkCourse({ name: "社会问题专题研究", credits: 3, difficulty: 4, examLoad: 3, required: false, area: "文社", suggestedTerm: 7, slot: "Thu-2" }),
        mkCourse({ name: "学术前沿讲座", credits: 2, difficulty: 2, examLoad: 1, required: false, area: "文社", suggestedTerm: 7, slot: "Tue-3" }),

        // 8学期：毕业
        mkCourse({ name: "毕业论文", credits: 6, difficulty: 4, examLoad: 2, required: true, area: "文社", suggestedTerm: 8, slot: "Thu-1" }),
      );
    }

        // ===== 通识/选修池（所有学院） =====
    // ===== 通识/选修池（所有学院） =====
    pool.push(
      // ===== 你原来的核心通识（保留 + 微调分布） =====
      mkCourse({ name: "心理健康与自我成长", credits: 2, difficulty: 2, examLoad: 1, required: false, area: "通识", suggestedTerm: 2, slot: "Mon-2" }),
      mkCourse({ name: "科研入门与文献检索", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "通识", suggestedTerm: 3, slot: "Mon-3" }),
      mkCourse({ name: "演讲与沟通", credits: 2, difficulty: 2, examLoad: 1, required: false, area: "通识", suggestedTerm: 3, slot: "Tue-3" }),
      mkCourse({ name: "职业发展与求职", credits: 2, difficulty: 2, examLoad: 1, required: false, area: "通识", suggestedTerm: 5, slot: "Wed-2" }),
      mkCourse({ name: "创新创业基础", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "通识", suggestedTerm: 6, slot: "Mon-3" }),
      mkCourse({ name: "跨学科项目实践", credits: 3, difficulty: 4, examLoad: 2, required: false, area: "通识", suggestedTerm: 7, slot: "Wed-3" }),

      // ===== 填学分用的 2 学分通识（用来凑到 160） =====
      mkCourse({ name: "通识选修：艺术鉴赏", credits: 2, difficulty: 2, examLoad: 1, required: false, area: "通识", suggestedTerm: 1, slot: "Mon-2" }),
      mkCourse({ name: "通识选修：科学史", credits: 2, difficulty: 2, examLoad: 1, required: false, area: "通识", suggestedTerm: 1, slot: "Mon-3" }),
      mkCourse({ name: "通识选修：写作与表达", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "通识", suggestedTerm: 2, slot: "Tue-3" }),
      mkCourse({ name: "通识选修：数据素养", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "通识", suggestedTerm: 2, slot: "Wed-2" }),
      mkCourse({ name: "通识选修：心理学导论", credits: 2, difficulty: 2, examLoad: 1, required: false, area: "通识", suggestedTerm: 3, slot: "Mon-2" }),
      mkCourse({ name: "通识选修：经济学思维", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "通识", suggestedTerm: 4, slot: "Tue-3" }),
      mkCourse({ name: "通识选修：AI 与社会", credits: 2, difficulty: 3, examLoad: 1, required: false, area: "通识", suggestedTerm: 5, slot: "Fri-3" }),
      mkCourse({ name: "通识选修：法律常识", credits: 2, difficulty: 2, examLoad: 1, required: false, area: "通识", suggestedTerm: 5, slot: "Thu-3" }),
      mkCourse({ name: "通识选修：金融与生活", credits: 2, difficulty: 2, examLoad: 1, required: false, area: "通识", suggestedTerm: 6, slot: "Fri-3" }),
      mkCourse({ name: "通识选修：社会热点研讨", credits: 2, difficulty: 2, examLoad: 1, required: false, area: "通识", suggestedTerm: 7, slot: "Thu-2" }),
      mkCourse({ name: "通识选修：毕业求职写作", credits: 2, difficulty: 2, examLoad: 1, required: false, area: "通识", suggestedTerm: 8, slot: "Tue-3" }),

      // ===== 新增：更丰富的 2 学分通识（人文/表达/认知/审美） =====
      mkCourse({ name: "通识选修：批判性思维与逻辑", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "通识", suggestedTerm: 1, slot: "Tue-2" }),
      mkCourse({ name: "通识选修：哲学入门：我们如何知道", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "通识", suggestedTerm: 2, slot: "Thu-2" }),
      mkCourse({ name: "通识选修：媒介素养与信息辨真", credits: 2, difficulty: 2, examLoad: 1, required: false, area: "通识", suggestedTerm: 2, slot: "Fri-2" }),
      mkCourse({ name: "通识选修：电影与叙事结构", credits: 2, difficulty: 2, examLoad: 1, required: false, area: "通识", suggestedTerm: 3, slot: "Wed-3" }),
      mkCourse({ name: "通识选修：阅读经典：短篇小说工作坊", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "通识", suggestedTerm: 3, slot: "Fri-1" }),
      mkCourse({ name: "通识选修：写作进阶：观点与论证", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "通识", suggestedTerm: 4, slot: "Mon-1" }),
      mkCourse({ name: "通识选修：公共表达：即兴与辩论", credits: 2, difficulty: 3, examLoad: 1, required: false, area: "通识", suggestedTerm: 4, slot: "Wed-1" }),
      mkCourse({ name: "通识选修：设计思维与创意方法", credits: 2, difficulty: 3, examLoad: 1, required: false, area: "通识", suggestedTerm: 5, slot: "Tue-1" }),
      mkCourse({ name: "通识选修：审美力：从配色到版式", credits: 2, difficulty: 2, examLoad: 1, required: false, area: "通识", suggestedTerm: 5, slot: "Thu-1" }),
      mkCourse({ name: "通识选修：跨文化沟通与礼仪", credits: 2, difficulty: 2, examLoad: 1, required: false, area: "通识", suggestedTerm: 6, slot: "Mon-4" }),
      mkCourse({ name: "通识选修：第二外语体验课", credits: 2, difficulty: 2, examLoad: 1, required: false, area: "通识", suggestedTerm: 6, slot: "Tue-4" }),
      mkCourse({ name: "通识选修：领导力与团队协作", credits: 2, difficulty: 3, examLoad: 1, required: false, area: "通识", suggestedTerm: 7, slot: "Wed-4" }),
      mkCourse({ name: "通识选修：谈判与冲突管理", credits: 2, difficulty: 3, examLoad: 1, required: false, area: "通识", suggestedTerm: 7, slot: "Thu-4" }),
      mkCourse({ name: "通识选修：时间与注意力科学", credits: 2, difficulty: 2, examLoad: 1, required: false, area: "通识", suggestedTerm: 8, slot: "Mon-4" }),
      mkCourse({ name: "通识选修：幸福课：心理学与实践", credits: 2, difficulty: 2, examLoad: 1, required: false, area: "通识", suggestedTerm: 8, slot: "Wed-4" }),

      // ===== 新增：更丰富的 2 学分通识（科技/数据/AI/安全） =====
      mkCourse({ name: "通识选修：编程思维入门", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "通识", suggestedTerm: 1, slot: "Thu-3" }),
      mkCourse({ name: "通识选修：数据分析入门（可视化）", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "通识", suggestedTerm: 2, slot: "Mon-4" }),
      mkCourse({ name: "通识选修：统计直觉与概率", credits: 2, difficulty: 4, examLoad: 2, required: false, area: "通识", suggestedTerm: 3, slot: "Thu-1" }),
      mkCourse({ name: "通识选修：AI 工具使用与提示工程", credits: 2, difficulty: 2, examLoad: 0, required: false, area: "通识", suggestedTerm: 4, slot: "Fri-4" }),
      mkCourse({ name: "通识选修：信息安全与隐私保护", credits: 2, difficulty: 3, examLoad: 1, required: false, area: "通识", suggestedTerm: 5, slot: "Mon-1" }),
      mkCourse({ name: "通识选修：产品思维与用户研究", credits: 2, difficulty: 3, examLoad: 1, required: false, area: "通识", suggestedTerm: 6, slot: "Tue-2" }),
      mkCourse({ name: "通识选修：数据伦理与算法偏见", credits: 2, difficulty: 3, examLoad: 1, required: false, area: "通识", suggestedTerm: 7, slot: "Fri-2" }),
      mkCourse({ name: "通识选修：科研写作：摘要到投稿", credits: 2, difficulty: 4, examLoad: 2, required: false, area: "通识", suggestedTerm: 7, slot: "Mon-2" }),
      mkCourse({ name: "通识选修：开源协作与版本管理", credits: 2, difficulty: 3, examLoad: 1, required: false, area: "通识", suggestedTerm: 8, slot: "Thu-2" }),

      // ===== 新增：更丰富的 2 学分通识（法律/经济/社会/商业常识） =====
      mkCourse({ name: "通识选修：合同与劳动法入门", credits: 2, difficulty: 2, examLoad: 1, required: false, area: "通识", suggestedTerm: 4, slot: "Wed-2" }),
      mkCourse({ name: "通识选修：知识产权与专利基础", credits: 2, difficulty: 3, examLoad: 1, required: false, area: "通识", suggestedTerm: 5, slot: "Tue-4" }),
      mkCourse({ name: "通识选修：商业分析：报表读懂公司", credits: 2, difficulty: 3, examLoad: 2, required: false, area: "通识", suggestedTerm: 5, slot: "Thu-4" }),
      mkCourse({ name: "通识选修：市场营销与品牌", credits: 2, difficulty: 2, examLoad: 1, required: false, area: "通识", suggestedTerm: 6, slot: "Wed-1" }),
      mkCourse({ name: "通识选修：宏观经济与政策理解", credits: 2, difficulty: 4, examLoad: 2, required: false, area: "通识", suggestedTerm: 6, slot: "Thu-1" }),
      mkCourse({ name: "通识选修：社会调查方法入门", credits: 2, difficulty: 3, examLoad: 1, required: false, area: "通识", suggestedTerm: 7, slot: "Tue-1" }),
      mkCourse({ name: "通识选修：城市与公共议题", credits: 2, difficulty: 2, examLoad: 1, required: false, area: "通识", suggestedTerm: 8, slot: "Fri-1" }),

      // ===== 新增：跨院“硬菜”3 学分选修（收益高但更累） =====
      mkCourse({ name: "跨院选修：案例分析与决策训练", credits: 3, difficulty: 4, examLoad: 2, required: false, area: "通识", suggestedTerm: 4, slot: "Fri-3" }),
      mkCourse({ name: "跨院选修：数据驱动问题解决（实战）", credits: 3, difficulty: 4, examLoad: 2, required: false, area: "通识", suggestedTerm: 5, slot: "Wed-3" }),
      mkCourse({ name: "跨院选修：产品原型与路演", credits: 3, difficulty: 4, examLoad: 2, required: false, area: "通识", suggestedTerm: 6, slot: "Thu-3" }),
      mkCourse({ name: "跨院选修：科研项目训练营", credits: 3, difficulty: 5, examLoad: 3, required: false, area: "通识", suggestedTerm: 6, slot: "Tue-3" }),
      mkCourse({ name: "跨院选修：社会创新与公益项目", credits: 3, difficulty: 3, examLoad: 1, required: false, area: "通识", suggestedTerm: 7, slot: "Mon-3" }),
      mkCourse({ name: "跨院选修：毕业作品集（综合实践）", credits: 3, difficulty: 4, examLoad: 2, required: false, area: "通识", suggestedTerm: 8, slot: "Wed-3" }),

      // ===== 1 学分小课：用来精确凑学分（轻量、低考试） =====
      mkCourse({ name: "任选小课：摄影入门", credits: 1, difficulty: 1, examLoad: 0, required: false, area: "通识", suggestedTerm: 2, slot: "Wed-3" }),
      mkCourse({ name: "任选小课：时间管理", credits: 1, difficulty: 1, examLoad: 0, required: false, area: "通识", suggestedTerm: 3, slot: "Thu-2" }),
      mkCourse({ name: "任选小课：求职简历", credits: 1, difficulty: 1, examLoad: 0, required: false, area: "通识", suggestedTerm: 4, slot: "Fri-2" }),
      mkCourse({ name: "任选小课：英语口语角", credits: 1, difficulty: 1, examLoad: 0, required: false, area: "通识", suggestedTerm: 5, slot: "Mon-2" }),
      mkCourse({ name: "任选小课：科研伦理", credits: 1, difficulty: 1, examLoad: 0, required: false, area: "通识", suggestedTerm: 6, slot: "Wed-2" }),
      mkCourse({ name: "任选小课：毕业讲座", credits: 1, difficulty: 1, examLoad: 0, required: false, area: "通识", suggestedTerm: 8, slot: "Fri-3" }),

      // ===== 新增：更多 1 学分“爽课”（让玩家体验感更好） =====
      mkCourse({ name: "任选小课：PPT 速成与汇报技巧", credits: 1, difficulty: 1, examLoad: 0, required: false, area: "通识", suggestedTerm: 2, slot: "Mon-1" }),
      mkCourse({ name: "任选小课：读书会（轻量）", credits: 1, difficulty: 1, examLoad: 0, required: false, area: "通识", suggestedTerm: 3, slot: "Tue-1" }),
      mkCourse({ name: "任选小课：记笔记的方法论", credits: 1, difficulty: 1, examLoad: 0, required: false, area: "通识", suggestedTerm: 3, slot: "Wed-1" }),
      mkCourse({ name: "任选小课：情绪急救与压力缓解", credits: 1, difficulty: 1, examLoad: 0, required: false, area: "通识", suggestedTerm: 4, slot: "Thu-1" }),
      mkCourse({ name: "任选小课：健身入门（无考试）", credits: 1, difficulty: 1, examLoad: 0, required: false, area: "通识", suggestedTerm: 4, slot: "Fri-1" }),
      mkCourse({ name: "任选小课：理财入门（记账与预算）", credits: 1, difficulty: 1, examLoad: 0, required: false, area: "通识", suggestedTerm: 5, slot: "Tue-2" }),
      mkCourse({ name: "任选小课：效率工具与自动化", credits: 1, difficulty: 2, examLoad: 0, required: false, area: "通识", suggestedTerm: 6, slot: "Thu-4" }),
      mkCourse({ name: "任选小课：面试模拟（无笔试）", credits: 1, difficulty: 2, examLoad: 0, required: false, area: "通识", suggestedTerm: 7, slot: "Mon-4" }),
      mkCourse({ name: "任选小课：学术海报速成", credits: 1, difficulty: 2, examLoad: 0, required: false, area: "通识", suggestedTerm: 7, slot: "Wed-2" }),
      mkCourse({ name: "任选小课：毕业手续与避坑指南", credits: 1, difficulty: 1, examLoad: 0, required: false, area: "通识", suggestedTerm: 8, slot: "Thu-3" }),
    );

    return pool;
    }// 通识/选修池


  // 8 学期目标学分（总计 160）
  const TERM_TARGET_CREDITS = [20, 20, 20, 20, 20, 20, 20, 20];

  // 为某个学期的课程分配不冲突的 timeslot
  function assignTimeslotsForTerm(courses, term) {
    if (!courses || courses.length === 0) return;
    
    // 已使用的 timeslot（用于避免冲突）
    const usedSlots = new Set();
    
    // 优先为已有 slot 的课程保留时间
    for (const course of courses) {
      if (course.timeslots && course.timeslots.length > 0) {
        course.timeslots.forEach(slot => usedSlots.add(slot));
      }
    }
    
    // 为没有 timeslot 的课程分配
    for (const course of courses) {
      if (!course.timeslots || course.timeslots.length === 0) {
        const slot = pickRandomTimeslot(Array.from(usedSlots));
        course.timeslots = [slot];
        usedSlots.add(slot);
      }
    }
  }

  function pickToFill(candidates, chosen, target) {
    // 目标：尽量不冲突、尽量刚好填到 target（可允许微小超额）
    const picked = [];

    const tryPick = (list, remaining, preferFit) => {
      let best = null;
      let bestOver = Infinity;

      for (const c of list) {
        if (CATEGORY_LIMITS[c.category] && countCategory(chosen, c.category) >= CATEGORY_LIMITS[c.category]) continue;
        if (conflictsWithAny(c, chosen)) continue;

        const cc = Number(c.credits || 0);
        const over = (sumCredits(chosen) + cc) - target;

        // 先尝试"能正好塞进 remaining"
        if (preferFit && cc <= remaining) {
          best = c;
          bestOver = over;
          break;
        }

        // 否则选"超额最小"的
        if (over >= 0 && over < bestOver) {
          best = c;
          bestOver = over;
        }
      }
      return best;
    };

    let guard = 0;
    while (sumCredits(chosen) < target && guard < 200) {
      guard++;
      const remaining = target - sumCredits(chosen);

      // 先选能 fit 的
      let c = tryPick(candidates, remaining, true);

      // 如果剩余太小，找 1 学分/2 学分小课来凑
      if (!c && remaining <= 2) {
        const small = candidates.filter(x => Number(x.credits || 0) <= remaining)
          .sort((a, b) => Number(a.credits || 0) - Number(b.credits || 0));
        c = tryPick(small, remaining, true);
      }

      // 实在不行就选超额最小的（即使冲突也选，保证毕业）
      if (!c) {
        // 移除冲突检查，确保能选到课程（毕业保障）
        let best = null;
        let bestOver = Infinity;
        for (const candidate of candidates) {
          const cc = Number(candidate.credits || 0);
          const over = (sumCredits(chosen) + cc) - target;
          if (over >= 0 && over < bestOver) {
            best = candidate;
            bestOver = over;
          }
        }
        c = best;
        // 如果还是找不到，尝试找任意一个能增加学分的课程
        if (!c && candidates.length > 0) {
          c = candidates[0];
        }
      }

      if (!c) break;
      chosen.push({ ...c });
      picked.push({ ...c });
      candidates = candidates.filter(x => x.id !== c.id);
    }

    return picked;
  }

  function generatePlan(academyZh) {
    const academyNorm = normalizeAcademy(academyZh);
    const coursePool = [
      ...GENERAL_REQUIRED_SEQUENCE.map(c => ({ ...c })),
      ...buildAcademyPool(academyNorm).map(c => ({ ...c })),
    ];

    const lockedByTerm = {};
    for (let term = 1; term <= 8; term++) {
      lockedByTerm[term] = getTermRequiredGeneral(term).map(c => c.id);
    }

    // 计划：term -> courseId[]
    const planByTerm = {};

    // 按“这门课预计在哪学期修”做一个可用池
    const bySuggestedTerm = (t) => coursePool.filter(c => Number(c.suggestedTerm || 1) <= t);

    const used = new Set();

    for (let term = 1; term <= 8; term++) {
      const chosen = [];

      // 1) 强制课（锁死）
      for (const c of getTermRequiredGeneral(term)) {
        chosen.push({ ...c });
        used.add(c.id);
      }

      // 2) 本学院/通识课程：优先 required，再选修
      const target = TERM_TARGET_CREDITS[term - 1] || 20;

      const poolNow = coursePool
        .filter(c => !used.has(c.id))
        .filter(c => Number(c.suggestedTerm || 1) <= term + 1) // 允许提前一点点看到未来课
        .map(c => ({ ...c }));

      const req = poolNow.filter(c => c.required).sort((a, b) => (a.suggestedTerm - b.suggestedTerm) || (b.credits - a.credits));
      const ele = poolNow.filter(c => !c.required).sort((a, b) => (a.suggestedTerm - b.suggestedTerm) || (Number(a.credits || 0) - Number(b.credits || 0)));

      pickToFill(req, chosen, target);
      pickToFill(ele, chosen, target);

      // 3) 为这个学期的课程分配 timeslot（尽量不冲突）
      assignTimeslotsForTerm(chosen, term);

      // 4) 记录 + 标记 used
      for (const c of chosen) used.add(c.id);
      planByTerm[term] = chosen.map(c => c.id);
    }
    
    // 5) 为所有未在计划中的课程（如通识选修）也分配随机 timeslot
    // 这些课程可能不在 planByTerm 中，但会在课程池中显示
    for (const course of coursePool) {
      if (!course.timeslots || course.timeslots.length === 0) {
        course.timeslots = [pickRandomTimeslot()];
      }
    }

    const termTargetCredits = {};
    for (let term = 1; term <= 8; term++) termTargetCredits[term] = TERM_TARGET_CREDITS[term - 1];

    const requiredCredits = coursePool.filter(c => c.required).reduce((sum, c) => sum + (c.credits || 0), 0);

    return {
      graduateCredits: requiredCredits + 10,
      termTargetCredits,
      lockedByTerm,
      planByTerm,
      coursePool,
      TIME_SLOTS,
      sumCredits,
      courseConflicts,
    };
  }

  window.COURSE = {
    generatePlan,
    TIME_SLOTS,
  };
})();

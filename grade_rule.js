// grade_rule.js
// =====================================
// 成绩规则 v3.2（阶段解锁制 + 选修秒A + 必修卡B）
//
// 核心逻辑更新：
// 1. 【选修课】：学1次(hits>=1) -> 直接到达 A 等级。想要 A+？必须等“高分解锁”。
// 2. 【必修课】：正常积累。但在“高分解锁”前，分数被强制锁定在 B (78-81) 封顶。
// 3. 【高分解锁】：外部(game.js)判断“当前所有必修课是否都>=B”。
//    - 如果是 -> 解锁 A+ 及必修课的 A/A+ 上限。
//    - 如果否 -> 执行上述锁定逻辑。
//
// =====================================

(() => {
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  // ====== 成绩等级表 (UI标准) ======
  const GRADE_TABLE = [
    { level: "A+", lo: 95, hi: 100, gpLo: 4.5, gpHi: 5.0 },
    { level: "A",  lo: 90, hi: 94,  gpLo: 4.0, gpHi: 4.4 },
    { level: "A-", lo: 85, hi: 89,  gpLo: 3.5, gpHi: 3.9 },
    { level: "B+", lo: 82, hi: 84,  gpLo: 3.2, gpHi: 3.4 },
    { level: "B",  lo: 78, hi: 81,  gpLo: 2.8, gpHi: 3.1 }, // 必修课第一阶段目标
    { level: "B-", lo: 75, hi: 77,  gpLo: 2.5, gpHi: 2.7 },
    { level: "C+", lo: 71, hi: 74,  gpLo: 2.1, gpHi: 2.4 },
    { level: "C",  lo: 66, hi: 70,  gpLo: 1.6, gpHi: 2.0 },
    { level: "C-", lo: 62, hi: 65,  gpLo: 1.2, gpHi: 1.5 },
    { level: "D",  lo: 60, hi: 61,  gpLo: 1.0, gpHi: 1.1 },
    { level: "F",  lo: -Infinity, hi: 59, gpLo: 0.0, gpHi: 0.0 },
  ];

  // 辅助：判断分数是否达到 B (78分)
  function isGradeB(score) {
    return Number(score) >= 78;
  }

  function randNormal(rand = Math.random) {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  function randRange(a, b, rand = Math.random) {
    return a + (b - a) * rand();
  }

  function getCourseParams(course) {
    const diff = Number(course?.difficulty ?? course?.diff ?? 3); // 1-5
    const exam = Number(course?.examLoad ?? course?.exam ?? 2);
    const required = !!course?.required;
    const name = String(course?.name ?? "");
    return { diff, exam, required, name };
  }

  // 计算学习一次增加的基础 Level
  // 即使被锁分，内部Level依然可以累积，只是输出Score被砍了一刀
  function levelGainPerStudy(course) {
    const { diff } = getCourseParams(course);
    // 难度越高，涨得越慢
    if (diff <= 1) return 2.0;
    if (diff === 2) return 1.0;
    if (diff === 3) return 0.6; // 微调：让普通必修课不那么容易一次满
    if (diff === 4) return 0.45;
    return 0.35; // diff>=5
  }

  // Level 转换为 分数段
  // Level 2.0 ~ B range
  // Level 4.0 ~ A range
  function bandFromLevel(level) {
    if (level >= 4.5) return { band: "A+_range", lo: 95, hi: 99 };
    if (level >= 4.0) return { band: "A_range",  lo: 90, hi: 94 }; // 选修课起步点
    if (level >= 3.0) return { band: "A-_range", lo: 85, hi: 89 };
    if (level >= 2.2) return { band: "B_range",  lo: 78, hi: 84 }; // 稍微放宽 B 的 Level 区间
    if (level >= 1.5) return { band: "C_range",  lo: 66, hi: 77 };
    if (level >= 0.8) return { band: "D_range",  lo: 60, hi: 65 };
    return { band: "F_range", lo: 35, hi: 59 };
  }

  function _calcCoursePercentV32(args) {
    const {
      course,
      studyActionsForThisCourse = 0,
      
      // 关键开关：所有必修课是否都已经到达 B ？
      // 由 game.js 传入。如果为 false，则启用“锁分逻辑”。
      unlockHighGrades = false, 

      termBonus = 0,
      energy = 60,
      stress = 40,
      rand = Math.random,
    } = args || {};

    const p = getCourseParams(course);
    const hits = Number(studyActionsForThisCourse);

    // 1. 基础 Level 计算
    let level = 0;
    
    if (!p.required) {
      // === 选修课逻辑 ===
      // 规则：只要学过一次，Level 直接起飞到 A (4.0)
      if (hits >= 1) {
        level = 4.0 + (hits - 1) * 0.5; // 后续学习依然可以加分，冲 A+
      } else {
        level = 0; // 没学就是 F
      }
    } else {
      // === 必修课逻辑 ===
      // 正常累积
      level = hits * levelGainPerStudy(course);
    }

    // 2. 加成计算 (Event / Bonus)
    // 稍微影响一点，但不至于破坏锁分平衡
    const bonusLv = clamp(Number(termBonus || 0), -10, 10) * 0.05;
    level += bonusLv;

    // 3. 【核心】锁分机制 (Gating)
    // 如果还没解锁高分阶段 (unlockHighGrades = false)
    if (!unlockHighGrades) {
      if (p.required) {
        // 必修课：只要没解锁，死都不能超过 B+ 的门槛 (Level 2.8 左右)
        // 对应分数约 81 分
        if (level > 2.8) level = 2.8; 
      } else {
        // 选修课：没解锁前，允许它是 A，但不能是 A+
        // 对应分数约 94 分
        if (level > 4.4) level = 4.4;
      }
    }

    // 4. 转为分数基数
    const band = bandFromLevel(level);
    let base = randRange(band.lo, band.hi, rand);

    // 5. 噪声与修正
    // 必修课稍微有点波动，选修课既然学了就给稳一点
    const sigma = p.required ? 1.5 : 0.8;
    const noise = randNormal(rand) * sigma;

    // 状态惩罚 (如果太累，可能会掉出 B 或 A，逼迫玩家休息)
    const stressPenalty = stress > 90 ? (stress - 90) * 0.5 : 0;
    const energyPenalty = energy < 30 ? (30 - energy) * 0.5 : 0;

    let score = base + noise - stressPenalty - energyPenalty;

    // 6. 最终保底与封顶修正
    // 如果因为随机数掉出区间，强行拉回来一点
    // 必修锁分阶段：强行锁在 81 以下
    if (!unlockHighGrades && p.required && score > 81) score = 81;
    // 选修锁分阶段：强行锁在 94 以下
    if (!unlockHighGrades && !p.required && score > 94) score = 94;

    // 选修保底：学过一次就绝不挂科，且尽量维持在 A 范围
    if (!p.required && hits >= 1) {
        score = Math.max(score, 90); // 只要学了，最低给 A
        // 如果没解锁A+，那就卡死在90-94之间
        if (!unlockHighGrades) score = Math.min(score, 94);
    }
    
    // 必修保底：如果真的学到位了(Level够了)，即使有随机波动，也不要掉出 B (78)
    if (p.required && !unlockHighGrades && level >= 2.2) {
        score = Math.max(score, 78);
    }

    return clamp(Math.round(score), 0, 100);
  }

  // 暴露给外部的接口
  function calcCoursePercent(a, b) {
    // 兼容旧版调用 (state, course)
    if (b && typeof a === "object") {
      const state = a;
      const course = b;
      
      // === 关键逻辑：计算 unlockHighGrades ===
      // 这里只是做一个简单的推断，准确的逻辑最好在 game.js 里算好传进来
      // 但为了省事，我们可以尝试从 state 里读
      let allReachedB = state.flags?.allRequiredReachedB ?? false;

      return _calcCoursePercentV32({
        course,
        studyActionsForThisCourse: state?.studyActionsByCourseId?.[course.id] || 0,
        unlockHighGrades: allReachedB,
        termBonus: state?.termGradeBonus || 0,
        energy: state?.energy,
        stress: state?.stress,
        rand: Math.random,
      });
    }
    return _calcCoursePercentV32(a || {});
  }

  // 调试与解释用
  function explain(args) {
    const res = _calcCoursePercentV32(args);
    const p = getCourseParams(args.course);
    return {
       name: p.name,
       type: p.required ? "必修" : "选修",
       hits: args.studyActionsForThisCourse,
       unlock: args.unlockHighGrades,
       score: res,
       grade: percentToGradeLevel(res)
    };
  }

  function _toIntScore(score) {
    return Math.max(0, Math.round(Number(score) || 0));
  }

  function percentToGradeLevel(score) {
    const s = _toIntScore(score);
    for (const row of GRADE_TABLE) {
      if (s >= row.lo && s <= row.hi) return row.level;
    }
    return "F";
  }

  function percentToGradePoint(score) {
    const s = _toIntScore(score);
    const row = GRADE_TABLE.find(r => s >= r.lo && s <= r.hi) || GRADE_TABLE[GRADE_TABLE.length - 1];
    if (row.gpLo === row.gpHi || row.hi === row.lo) return row.gpLo;
    const t = (s - row.lo) / (row.hi - row.lo);
    const gp = row.gpLo + t * (row.gpHi - row.gpLo);
    return Math.round(gp * 10) / 10;
  }

  window.GRADING = {
    calcCoursePercent,
    percentToGradeLevel,
    percentToGradePoint,
    // 兼容 game.js 里旧命名
    percentToLetter: percentToGradeLevel,
    percentToGPA: percentToGradePoint,
    isGradeB, // 导出此函数供 game.js 判断
    explain
  };
})();

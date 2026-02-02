(function () {
  function getSpec() {
    return window.ROUTE_SPEC || {};
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function randi(a, b) {
    return Math.floor(Math.random() * (b - a + 1)) + a;
  }

  function safeLog(msg) {
    if (typeof window.logLine === "function") window.logLine(msg);
    else if (typeof console !== "undefined") console.log(msg);
  }

  function getRouteKey(state) {
    const spec = getSpec();
    const map = spec.ROUTE_ID_MAP || {};
    const raw = state.routeChoice || state.route || null;
    return (raw && map[raw]) ? map[raw] : raw;
  }

  function getRouteConfig(state) {
    const spec = getSpec();
    const routes = spec.ROUTES || {};
    const key = getRouteKey(state);
    return key ? routes[key] : null;
  }

  function getTermIndex(state) {
    return (Number(state.year || 1) - 1) * 2 + Number(state.term || 1);
  }

  function getSegmentKey(state) {
    const seg = state.segment || {};
    if (seg.type && seg.type !== "TERM") return seg.type;
    return "TERM" + getTermIndex(state);
  }

  function routeInit(state) {
    state.route = state.route || state.routeChoice || null;
    state.segment = state.segment || { type: "TERM", week: state.week || 1 };
    state.weekInSegment = state.segment.week || state.week || 1;
    state.calendarSegments = state.calendarSegments || [];
    state.moneyFrozen = routeIsMoneyFrozen(state);
    state.routeData = state.routeData || {};
    state.routeData.applications = state.routeData.applications || [];
    state.routeData.weeklySchedule = state.routeData.weeklySchedule || {};
    state.routeData.offers = state.routeData.offers || [];
    state.routeData.flags = state.routeData.flags || {};
    state.routeData.counters = state.routeData.counters || {};
  }

  function routeRebuildCalendar(state) {
    const routeKey = getRouteKey(state);
    const spec = getSpec();
    const routes = spec.ROUTES || {};
    const cfg = routes[routeKey] || null;
    const needsSummer = !!cfg?.needsSummer;
    const needsWinter = !!cfg?.needsWinter;

    const segments = [];
    const anchor = Number(state.routeChoiceAnchorTerm || getTermIndex(state)) || getTermIndex(state);

    segments.push({ type: "TERM", termIndex: anchor, totalWeeks: 16 });
    if (needsSummer) segments.push({ type: "SUMMER", anchorTerm: anchor, totalWeeks: 8 });
    segments.push({ type: "TERM", termIndex: anchor + 1, totalWeeks: 16 });
    if (needsWinter) segments.push({ type: "WINTER", anchorTerm: anchor + 1, totalWeeks: 4 });
    segments.push({ type: "TERM", termIndex: anchor + 2, totalWeeks: 16 });
    state.calendarSegments = segments;
    return segments;
  }

  function routeGetStage(state) {
    const route = getRouteConfig(state);
    if (!route || !Array.isArray(route.stages)) {
      return { stageKey: null, uiMode: state.routeChoice ? "ROUTE_PANEL" : "CLASSIC", routeKey: getRouteKey(state), stage: null };
    }

    const segKey = getSegmentKey(state);
    const week = Number((state.segment && state.segment.week) || state.week || 1);
    let found = null;
    for (const s of route.stages) {
      if (s.segment !== segKey) continue;
      const start = Number(s.weeks[0]);
      const end = Number(s.weeks[1]);
      if (week >= start && week <= end) {
        found = s;
        break;
      }
    }

    if (!found) {
      return { stageKey: null, uiMode: state.routeChoice ? "ROUTE_PANEL" : "CLASSIC", routeKey: getRouteKey(state), stage: null };
    }

    return { stageKey: found.key, uiMode: found.uiMode || "ROUTE_PANEL", routeKey: getRouteKey(state), stage: found };
  }

  function routeGetWeeklySlots(state) {
    const spec = getSpec();
    const g = spec.ROUTE_GLOBAL || {};
    const seg = (state.segment && state.segment.type) || "TERM";
    const map = g.ACTIONS_PER_WEEK || { TERM: 3, HOLIDAY: 2 };
    return (seg === "SUMMER" || seg === "WINTER") ? map.HOLIDAY : map.TERM;
  }

  function absWeekIndex(state) {
    const termIdx = getTermIndex(state);
    return (termIdx - 1) * 16 + Number(state.segment?.week || state.week || 1);
  }

  function routeComputeScore(state) {
    const route = getRouteConfig(state);
    if (!route || !route.scoring) return null;
    const stats = state.routeStats || {};
    const src = {
      gpa: state.cumGPA || 0,
      english: stats.english || stats.englishPower || (state.hiddenProfile && state.hiddenProfile.englishPower) || 0,
      research: stats.research || stats.researchPower || (state.hiddenProfile && state.hiddenProfile.researchPower) || 0,
      majorSkill: stats.majorSkill || 0,
      examSkill: stats.examSkill || 0,
      interviewSkill: stats.interviewSkill || 0,
      docsQuality: stats.docsQuality || 0,
      resumeQuality: stats.resumeQuality || 0,
      projectPortfolio: stats.projectPortfolio || 0,
      politicsSkill: stats.politicsSkill || 0,
      healthStability: (state.health || 0) + (state.status?.stability || 0),
      luck: (state.hiddenProfile && state.hiddenProfile.luck) || stats.luck || 50,
      campPrep: stats.campPrep || 0,
    };

    const out = {};
    for (const [key, weights] of Object.entries(route.scoring)) {
      let sum = 0;
      for (const [k, w] of Object.entries(weights)) {
        const v = Number(src[k] || 0);
        sum += v * Number(w || 0);
      }
      out[key] = Math.round(sum * 100) / 100;
    }
    return out;
  }

  /* ========== 秋招流水线 ========== */
  function jobInitApplications(state) {
    state.routeData = state.routeData || {};
    state.routeData.applications = state.routeData.applications || [];
    // 手动投递模式：不再自动生成投递。仅确保数据结构存在。
    state.routeData.pipelineQueue = state.routeData.pipelineQueue || [];
  }

  function getPipelineQueue(state) {
    state.routeData = state.routeData || {};
    if (!state.routeData.pipelineQueue) state.routeData.pipelineQueue = [];
    return state.routeData.pipelineQueue;
  }

  function jobScore(state, key) {
    const scores = routeComputeScore(state) || {};
    return Number(scores[key] || 0);
  }

  function jobThreshold(tier) {
    const spec = getSpec();
    return spec.TIER_THRESHOLDS?.jobBar?.[tier] ?? 60;
  }

  function jobWeekly(state) {
    if (getRouteKey(state) !== "job") return;
    const segType = state.segment?.type || "TERM";
    const termIdx = state.segment?.termIndex || getTermIndex(state);
    // 秋招流水线仅在学期段且 termIndex==7 运转；暑假只做准备，不跑流水线
    if (segType !== "TERM" || termIdx !== 7) return;

    const apps = state.routeData.applications || [];
    const nowAbs = absWeekIndex(state);

    for (const app of apps) {
      if (app.status === "screening" && nowAbs >= app.screenAbsWeek) {
        const score = jobScore(state, "resumeScreen");
        const pass = score >= jobThreshold(app.tier);
        app.screenScore = score;
        if (pass) {
          app.status = "exam_pending";
          app.examAbsWeek = nowAbs;
          safeLog(`[秋招] ${app.name} 简历通过，等待你安排笔试（需手动“参加笔试”行动）`);
        } else {
          app.status = "rejected";
          safeLog(`[秋招] ${app.name} 简历被刷，score=${score} / bar=${jobThreshold(app.tier)}`);
        }
      }
    }

    processPipelineQueue(state, nowAbs);
  }

  function processPipelineQueue(state, nowAbsWeek) {
    const queue = getPipelineQueue(state);
    const apps = state.routeData.applications || [];
    const remaining = [];
    for (const item of queue) {
      if (!item || typeof item.dueAbsWeek !== "number" || nowAbsWeek < item.dueAbsWeek) {
        remaining.push(item);
        continue;
      }
      const app = apps.find(a => a.id === item.appId);
      if (!app) continue;
      if (item.type === "exam_result") {
        const score = jobScore(state, "resumeScreen");
        const pass = score >= jobThreshold(app.tier);
        app.examScore = score;
        if (pass) {
          app.status = "interview_pending";
          safeLog(`[秋招] ${app.name} 笔试通过，等待安排面试`);
        } else {
          app.status = "rejected";
          safeLog(`[秋招] ${app.name} 笔试未通过（${score}/${jobThreshold(app.tier)}）`);
        }
      } else if (item.type === "interview_result") {
        let score = jobScore(state, "interview");
        score += randi(-6, 6);
        const pass = score >= jobThreshold(app.tier);
        app.interviewScore = score;
        if (pass) {
          app.status = "offer";
          addOffer(state, app, "offer");
          safeLog(`[秋招] ${app.name} 面试通过，发放 offer（${score}/${jobThreshold(app.tier)}）`);
        } else {
          app.status = "rejected";
          safeLog(`[秋招] ${app.name} 面试未通过（${score}/${jobThreshold(app.tier)}）`);
        }
      } else {
        remaining.push(item);
      }
    }
    state.routeData.pipelineQueue = remaining;
  }

  function routeIsMoneyFrozen(state) {
    const spec = getSpec();
    const g = spec.ROUTE_GLOBAL || {};
    const seg = (state.segment && state.segment.type) || "TERM";
    const list = g.MONEY_FROZEN_SEGMENTS || [];
    return list.includes(seg);
  }

  function evalRule(state, expr) {
    const m = expr.match(/^([a-zA-Z_]+)\s*(>=|<=|==|>|<)\s*([0-9.]+)$/);
    if (!m) return false;
    const key = m[1];
    const op = m[2];
    const val = Number(m[3]);
    const cur = Number(state[key] || 0);
    if (op === ">") return cur > val;
    if (op === "<") return cur < val;
    if (op === ">=") return cur >= val;
    if (op === "<=") return cur <= val;
    if (op === "==") return cur === val;
    return false;
  }

  function routeApplyWeeklyDrift(state) {
    const spec = getSpec();
    const g = spec.ROUTE_GLOBAL || {};
    const drift = g.WEEKLY_DRIFT || {};

    if (typeof drift.stress === "number") state.stress = clamp(state.stress + drift.stress, 0, 100);
    if (typeof drift.mood === "number") state.mood = clamp(state.mood + drift.mood, 0, 100);

    let globalGainMult = 1.0;
    const rules = drift.rules || [];
    for (const rule of rules) {
      if (!rule.if || !rule.then) continue;
      if (!evalRule(state, rule.if)) continue;
      for (const [k, v] of Object.entries(rule.then)) {
        if (k === "globalGainMult") {
          globalGainMult = clamp(globalGainMult + Number(v || 0), 0, 2);
        } else if (k in state) {
          state[k] = clamp(state[k] + Number(v || 0), 0, 100);
        }
      }
    }

    state.flags = state.flags || {};
    state.flags.lowHealthPenalty = state.health < 30;
    return { globalGainMult };
  }

  function getPoolItems(poolName) {
    const spec = getSpec();
    if (!poolName) return [];
    const raw = spec[poolName] || [];
    return raw.map(normalizePoolItem);
  }

  function normalizePoolItem(item) {
    if (item && typeof item === "object") return item;
    const name = String(item);
    return { id: name, name: name, tier: 3 };
  }


  function normalizeAction(actionId) {
    const spec = getSpec();
    const defs = spec.ROUTE_ACTIONS || {};
    const def = defs[actionId];
    if (!def) return null;
    return { id: actionId, name: def.name, effects: def.effects, tags: def.tags || [], meta: def.meta || {} };
  }

  function routeGetActionPool(state) {
    const info = routeGetStage(state);
    if (!info || info.uiMode !== "ROUTE_SPECIAL") return null;
    const route = getRouteConfig(state);
    if (!route || !route.actionPools) return null;

    const pools = route.actionPools;
    const stage = info.stage || {};
    const freeKey = stage.actionPoolKey || stage.actionPool || null;
    const eventKey = stage.eventPoolKey || stage.eventPool || null;

    let freePool = [];
    let eventPool = [];

    if (freeKey && pools[freeKey]) freePool = pools[freeKey];
    if (eventKey && pools[eventKey]) eventPool = pools[eventKey];

    if (!freePool.length && pools[info.stageKey]) freePool = pools[info.stageKey];
    if (!freePool.length) {
      const seg = (state.segment && state.segment.type) || "TERM";
      if (pools[seg]) freePool = pools[seg];
    }

    return {
      free: freePool.map(normalizeAction).filter(Boolean),
      event: eventPool.map(normalizeAction).filter(Boolean)
    };
  }

  function calcPenalty(state) {
    const spec = getSpec();
    const p = (spec.ROUTE_GLOBAL && spec.ROUTE_GLOBAL.PENALTY) || {};
    let penalty = 0;
    if (p.stress && typeof p.stress.start === "number") {
      const v = Math.max(0, (state.stress || 0) - p.stress.start);
      penalty += v * (p.stress.k || 0);
    }
    if (p.health && typeof p.health.start === "number") {
      const base = p.health.direction === "below" ? Math.max(0, (p.health.start || 0) - (state.health || 0)) : Math.max(0, (state.health || 0) - (p.health.start || 0));
      penalty += base * (p.health.k || 0);
    }
    return penalty;
  }

  function getStatValue(state, key) {
    if (key === "healthStability") {
      const h = Number(state.health || 0);
      const s = Number(state.stress || 0);
      return clamp(Math.round((h - s + 100) / 2), 0, 100);
    }
    if (state.routeStats && key in state.routeStats) return Number(state.routeStats[key] || 0);
    if (state.routeProcess && key in state.routeProcess) return Number(state.routeProcess[key] || 0);
    if (key === "gpa" && typeof window.calcCumulativeGPA === "function") return Number(window.calcCumulativeGPA() || 0);
    return Number(state[key] || 0);
  }

  function routeEvaluate(state, applicationId, context) {
    const route = getRouteConfig(state);
    if (!route) return { score: 0, result: "rejected" };
    if (typeof window.syncRouteStatsFromCore === "function") {
      window.syncRouteStatsFromCore();
    }
    const scoringKey = context && context.scoringKey;
    const weights = (route.scoring && scoringKey && route.scoring[scoringKey]) || {};
    let score = 0;
    for (const [k, w] of Object.entries(weights)) {
      score += Number(w || 0) * getStatValue(state, k);
    }
    score = score - calcPenalty(state) + randi(-10, 10);
    score = clamp(Math.round(score), 0, 100);

    const thresholdKey = context && context.thresholdKey;
    const tier = context && (context.tier || (context.app && context.app.tier));
    let threshold = 0;
    const thresholds = getSpec().TIER_THRESHOLDS || {};
    if (thresholdKey && thresholds[thresholdKey] && tier != null) threshold = Number(thresholds[thresholdKey][tier] || 0);

    const band = (context && context.band) || null;
    if (band && typeof band.offerDelta === "number") {
      if (score >= threshold + band.offerDelta) return { score, result: "offer" };
      if (score >= threshold + (band.waitlistMin || -8)) return { score, result: "waitlist" };
      return { score, result: "rejected" };
    }

    const passLabel = (context && context.passLabel) || "pass";
    const failLabel = (context && context.failLabel) || "fail";
    return score >= threshold ? { score, result: passLabel } : { score, result: failLabel };
  }

  function addOffer(state, app, status) {
    state.routeData.offers = state.routeData.offers || [];
    state.routeData.offers.push({
      id: `offer_${app.id}`,
      name: app.name,
      status: status || "offered",
      tier: app.tier || null
    });
  }

  function scheduleWeeklyList(state, app) {
    const weekKey = String(state.absWeekCounter || 1);
    state.routeData.weeklySchedule = state.routeData.weeklySchedule || {};
    const list = state.routeData.weeklySchedule[weekKey] || [];
    list.push(app);
    state.routeData.weeklySchedule[weekKey] = list;
  }

  function resolveConflicts(state) {
    const spec = getSpec();
    const g = spec.ROUTE_GLOBAL || {};
    const maxEvents = g.MAX_EVENTS_PER_WEEK || 2;
    const resched = g.RESCHEDULE || { maxTimes: 1, baseProb: 0.35, luckFactor: 1 / 200 };

    const weekKey = String(state.absWeekCounter || 1);
    const list = (state.routeData.weeklySchedule && state.routeData.weeklySchedule[weekKey]) || [];
    if (list.length <= maxEvents) return;

    const overflow = list.slice(maxEvents);
    const segmentWeeks = (state.segment && state.segment.type === "SUMMER") ? 8 : (state.segment && state.segment.type === "WINTER" ? 4 : 16);
    const segmentStartAbs = (state.absWeekCounter || 1) - (Number(state.segment && state.segment.week) - 1);
    const segmentEndAbs = segmentStartAbs + segmentWeeks - 1;

    for (const app of overflow) {
      if (app.rescheduleUsed) {
        app.status = "withdrawn";
        continue;
      }
      const luck = getStatValue(state, "luck");
      const prob = resched.baseProb + luck * resched.luckFactor;
      if (Math.random() < prob) {
        app.rescheduleUsed = true;
        const newWeek = (app.eventWeek || state.absWeekCounter) + 1;
        if (newWeek <= segmentEndAbs) {
          app.eventWeek = newWeek;
          if (typeof app.resultDelay === "number") app.resultWeek = newWeek + app.resultDelay;
          if (app.campWeek != null) app.campWeek = newWeek;
          if (app.pendingResult) delete app.pendingResult;
          app.status = app.preEventStatus || app.status;
        } else {
          app.status = "withdrawn";
        }
      } else {
        app.status = "withdrawn";
      }
    }

    state.routeData.weeklySchedule[weekKey] = list.slice(0, maxEvents);
  }

  function scheduleSummer(state, route) {
    const rules = route.summerRules;
    const rd = state.routeData;
    if (!rules) return;

    const segWeek = Number(state.segment && state.segment.week || 1);
    if (segWeek === rules.submitWeek && !rd.flags.summerSubmitted && !state.eventPending) {
      const pool = getPoolItems(rules.univPool);
      if (window.openMultiSelectModal) {
        window.openMultiSelectModal({
          id: "BAOYAN_SUMMER_SUBMIT",
          title: "夏令营投递（最多5所）",
          text: "请选择本次夏令营投递学校。",
          items: pool,
          max: rules.submitLimit,
          onConfirm: (picked) => {
            for (const item of picked) {
              rd.applications.push({
                id: `camp_${item.id}_${Math.random().toString(36).slice(2, 6)}`,
                name: item.name,
                tier: item.tier,
                phase: "summer",
                status: "submitted",
                inviteWeek: null,
                campWeek: null,
                rescheduleUsed: false
              });
            }
            rd.flags.summerSubmitted = true;
          }
        });
      } else {
        const picked = pool.slice(0, rules.submitLimit);
        for (const item of picked) {
          rd.applications.push({
            id: `camp_${item.id}_${Math.random().toString(36).slice(2, 6)}`,
            name: item.name,
            tier: item.tier,
            phase: "summer",
            status: "submitted",
            inviteWeek: null,
            campWeek: null,
            rescheduleUsed: false
          });
        }
        rd.flags.summerSubmitted = true;
      }
    }

    const segStartAbs = (state.absWeekCounter || 1) - (segWeek - 1);
    const inviteWindow = rules.inviteNoticeWindow || [2, 8];
    const campWindow = rules.campWeekWindow || [2, 8];
    for (const app of rd.applications) {
      if (app.phase !== "summer") continue;
      if (!app.inviteWeek) {
        const minW = Math.max(inviteWindow[0], 1);
        const maxW = Math.max(inviteWindow[1], minW);
        app.inviteWeek = segStartAbs + randi(minW - 1, maxW - 1);
      }
      if (app.inviteWeek === state.absWeekCounter && app.status === "submitted") {
        const inviteKey = route.resultRules && route.resultRules.thresholds ? route.resultRules.thresholds.inviteByTier : "campInvite";
        const ev = routeEvaluate(state, app.id, { scoringKey: "campInvite", thresholdKey: inviteKey, tier: app.tier, passLabel: "invited", failLabel: "rejected" });
        if (ev.result === "invited") {
          app.status = "invited";
          const minW = Math.max(campWindow[0], 1);
          const maxW = Math.max(campWindow[1], minW);
          app.campWeek = segStartAbs + randi(minW - 1, maxW - 1);
          app.eventWeek = app.campWeek;
          safeLog(window.routeLog ? window.routeLog("campInvite", { name: app.name }) : `[SUMMER] invited: ${app.name}`);
        } else {
          app.status = "rejected";
        }
      }
      if (app.eventWeek === state.absWeekCounter && app.status === "invited") {
        app.preEventStatus = app.status;
        app.status = "interviewing";
        app.eventWeek = app.campWeek;
        app.resultWeek = app.campWeek;
        app.resultDelay = 0;
        const offerKey = route.resultRules && route.resultRules.thresholds ? route.resultRules.thresholds.offerByTierBase : "campOfferBase";
        const band = route.resultRules && route.resultRules.offerBand ? route.resultRules.offerBand : { offer: 8, waitlist: [-8, 8] };
        app.pendingResult = {
          scoringKey: "campOffer",
          thresholdKey: offerKey,
          tier: app.tier,
          band: { offerDelta: band.offer || 8, waitlistMin: Array.isArray(band.waitlist) ? band.waitlist[0] : -8 }
        };
        app.logKey = "campOffer";
        scheduleWeeklyList(state, app);
      }
    }
  }

  function schedulePrepush(state, route) {
    const rules = route.prePushRules;
    const rd = state.routeData;
    if (!rules) return;

    const segWeek = Number(state.segment && state.segment.week || 1);
    if (segWeek === rules.optInWeek && !rd.flags.prepushAsked && !state.eventPending) {
      rd.flags.prepushAsked = true;
      if (window.openEventModal) {
        window.openEventModal({
          id: "BAOYAN_PREPUSH_OPTIN",
          title: "预推免报名",
          text: "是否参加本学期预推免？",
          options: [
            { text: "参加预推免", onSelect: () => { rd.flags.prepushOptIn = true; } },
            { text: "暂不参加", onSelect: () => { rd.flags.prepushOptIn = false; } }
          ]
        });
      } else {
        rd.flags.prepushOptIn = true;
      }
    }

    if (rd.flags.prepushOptIn && !rd.flags.prepushSubmitted && segWeek >= rules.optInWeek && !state.eventPending) {
      const pool = getPoolItems(rules.univPool);
      if (window.openMultiSelectModal) {
        window.openMultiSelectModal({
          id: "BAOYAN_PREPUSH_SUBMIT",
          title: "预推免投递（最多3所）",
          text: "请选择预推免投递学校。",
          items: pool,
          max: rules.submitLimit,
          onConfirm: (picked) => {
            for (const item of picked) {
              rd.applications.push({
                id: `pre_${item.id}_${Math.random().toString(36).slice(2, 6)}`,
                name: item.name,
                tier: item.tier,
                phase: "prepush",
                status: "submitted",
                eventWeek: null,
                rescheduleUsed: false
              });
            }
            rd.flags.prepushSubmitted = true;
            safeLog(window.routeLog ? window.routeLog("prepushStart", { count: picked.length }) : "[PREPUSH] submit ok");
          }
        });
      } else {
        const picked = pool.slice(0, rules.submitLimit);
        for (const item of picked) {
          rd.applications.push({
            id: `pre_${item.id}_${Math.random().toString(36).slice(2, 6)}`,
            name: item.name,
            tier: item.tier,
            phase: "prepush",
            status: "submitted",
            eventWeek: null,
            rescheduleUsed: false
          });
        }
        rd.flags.prepushSubmitted = true;
      }
    }

    if (segWeek === rules.interviewWeek) {
      for (const app of rd.applications) {
        if (app.phase !== "prepush" || app.status !== "submitted") continue;
        app.preEventStatus = app.status;
        app.status = "interviewing";
        app.eventWeek = state.absWeekCounter;
        app.resultWeek = state.absWeekCounter + Math.max(0, rules.resultWeek - rules.interviewWeek);
        app.resultDelay = Math.max(0, rules.resultWeek - rules.interviewWeek);
        app.pendingResult = { scoringKey: rules.scoringKey, thresholdKey: rules.thresholdKey, tier: app.tier, band: { offerDelta: 0, waitlistMin: -6 } };
        app.logKey = rules.logKeyResult || "prepushResult";
        scheduleWeeklyList(state, app);
      }
    }

    if (segWeek === rules.resultWeek) return;
  }

  function scheduleKaoyan(state, route) {
    const rd = state.routeData;
    const segKey = getSegmentKey(state);
    const segWeek = Number(state.segment && state.segment.week || 1);
    const summer = route.summerRules || {};
    const exam = route.examRules || {};
    const retest = route.retestRules || {};

    if (segKey === "SUMMER" && segWeek === summer.chooseTargetsWeek && !rd.flags.targetsChosen && !state.eventPending) {
      const pool = getPoolItems(summer.univPool);
      if (window.openMultiSelectModal) {
        window.openMultiSelectModal({
          id: "KAOYAN_TARGETS",
          title: "考研目标选择（最多3所）",
          text: "选择主目标1所 + 备选2所。",
          items: pool,
          max: summer.targetLimit || 3,
          onConfirm: (picked) => {
            rd.targets = picked.slice();
            rd.flags.targetsChosen = true;
          }
        });
      } else {
        rd.targets = pool.slice(0, summer.targetLimit || 3);
        rd.flags.targetsChosen = true;
      }
    }

    if (segKey === "TERM7" && segWeek === exam.examWeek && !rd.flags.examScheduled) {
      const main = (rd.targets && rd.targets[0]) ? rd.targets[0] : { id: "default", name: "目标院校", tier: 3 };
      const app = {
        id: `kaoyan_${main.id}_${Math.random().toString(36).slice(2, 6)}`,
        name: main.name,
        tier: main.tier,
        phase: "kaoyan_exam",
        status: "interviewing",
        eventWeek: state.absWeekCounter,
        resultWeek: state.absWeekCounter + (exam.resultDelay || 0),
        resultHook: "kaoyan_exam",
        pendingResult: { scoringKey: exam.scoringKey, thresholdKey: exam.thresholdKey, tier: main.tier, passLabel: "pass", failLabel: "fail" },
        logKey: exam.logKey || "kaoyanExam"
      };
      rd.applications.push(app);
      scheduleWeeklyList(state, app);
      rd.flags.examScheduled = true;
    }

    if (segKey === "TERM8" && segWeek === retest.interviewWeek && rd.flags.examPassed && !rd.flags.retestScheduled) {
      const main = (rd.targets && rd.targets[0]) ? rd.targets[0] : { id: "default", name: "目标院校", tier: 3 };
      const app = {
        id: `kaoyan_retest_${main.id}_${Math.random().toString(36).slice(2, 6)}`,
        name: main.name,
        tier: main.tier,
        phase: "kaoyan_retest",
        status: "interviewing",
        eventWeek: state.absWeekCounter,
        resultWeek: state.absWeekCounter + (retest.resultDelay || 0),
        resultHook: "kaoyan_retest",
        pendingResult: { scoringKey: retest.scoringKey, thresholdKey: retest.thresholdKey, tier: main.tier, passLabel: "pass", failLabel: "fail" },
        logKey: retest.logKey || "kaoyanRetest"
      };
      rd.applications.push(app);
      scheduleWeeklyList(state, app);
      rd.flags.retestScheduled = true;
    }
  }

  function scheduleAbroad(state, route) {
    const rd = state.routeData;
    const segKey = getSegmentKey(state);
    const segWeek = Number(state.segment && state.segment.week || 1);
    const rules = route.applyRules || {};
    const pool = getPoolItems(rules.pool);

    if (segKey === "TERM7" && segWeek === 1 && !rd.flags.poolSelected && !state.eventPending) {
      if (window.openMultiSelectModal) {
        window.openMultiSelectModal({
          id: "ABROAD_POOL",
          title: "申请项目清单（最多8个）",
          text: "选择你要投递的项目清单。",
          items: pool,
          max: rules.totalSubmitLimit || 8,
          onConfirm: (picked) => {
            rd.pool = picked.slice();
            rd.flags.poolSelected = true;
          }
        });
      } else {
        rd.pool = pool.slice(0, rules.totalSubmitLimit || 8);
        rd.flags.poolSelected = true;
      }
    }

    if (segKey === "TERM7" && rd.pool && rd.pool.length && (rd.counters.submitted || 0) < (rules.totalSubmitLimit || 0)) {
      const toAdd = Math.min(rules.perWeekSubmitLimit || 0, (rules.totalSubmitLimit || 0) - (rd.counters.submitted || 0));
      for (let i = 0; i < toAdd; i++) {
        const item = rd.pool.shift();
        if (!item) break;
        const submitWeek = state.absWeekCounter;
        const w = rules.resultWindowWeeksAfterSubmit || [2, 6];
        const app = {
          id: `abroad_${item.id}_${Math.random().toString(36).slice(2, 6)}`,
          name: item.name,
          tier: item.tier,
          phase: "abroad_apply",
          status: "submitted",
          submitWeek: submitWeek,
          resultWeek: submitWeek + randi(w[0], w[1])
        };
        rd.applications.push(app);
        rd.counters.submitted = (rd.counters.submitted || 0) + 1;
      }
    }

    for (const app of rd.applications) {
      if (app.phase !== "abroad_apply") continue;
      if (app.status === "submitted" && state.absWeekCounter >= app.resultWeek) {
        const ev = routeEvaluate(state, app.id, { scoringKey: rules.screenScoringKey, thresholdKey: rules.thresholdKey, tier: app.tier, passLabel: "invited", failLabel: "rejected" });
        if (ev.result === "invited") {
          app.status = "invited";
        } else {
          app.status = "rejected";
        }
        const logKey = rules.logKeyScreen || "abroadScreen";
        safeLog(window.routeLog ? window.routeLog(logKey, { name: app.name, result: app.status }) : `[SCREEN] ${app.name} -> ${app.status}`);
      }
    }

    if (segKey === "TERM8") {
      const startAbs = (state.absWeekCounter || 1) - (segWeek - 1);
      const windowWeeks = (rules.interviewWindow && rules.interviewWindow.weeks) ? rules.interviewWindow.weeks : [1, 6];
      for (const app of rd.applications) {
        if (app.phase !== "abroad_apply" || app.status !== "invited") continue;
        if (!app.eventWeek) {
          app.eventWeek = startAbs + randi(windowWeeks[0] - 1, windowWeeks[1] - 1);
        }
        if (app.eventWeek === state.absWeekCounter) {
          app.preEventStatus = app.status;
          app.status = "interviewing";
          app.resultWeek = app.eventWeek;
          app.pendingResult = { scoringKey: rules.interviewScoringKey, thresholdKey: rules.thresholdKey, tier: app.tier, passLabel: "offer", failLabel: "rejected" };
          app.logKey = rules.logKeyInterview || "abroadInterview";
          scheduleWeeklyList(state, app);
        }
      }
    }
  }

  function scheduleJob(state, route) {
    const rd = state.routeData;
    const segKey = getSegmentKey(state);
    const segWeek = Number(state.segment && state.segment.week || 1);
    const rules = route.submitRules || {};
    const pool = getPoolItems(rules.pool);

    if (segKey === "SUMMER" && segWeek === 1 && !rd.flags.jobSummerSubmitted && !state.eventPending) {
      if (window.openMultiSelectModal) {
        window.openMultiSelectModal({
          id: "JOB_SUMMER_SUBMIT",
          title: "提前批投递（最多8家）",
          text: "选择暑期提前批投递公司。",
          items: pool,
          max: rules.summerWeek1Limit || 8,
          onConfirm: (picked) => {
            rd.poolSummer = picked.slice();
            rd.flags.jobSummerSubmitted = true;
          }
        });
      } else {
        rd.poolSummer = pool.slice(0, rules.summerWeek1Limit || 8);
        rd.flags.jobSummerSubmitted = true;
      }
    }

    if (segKey === "SUMMER" && rd.poolSummer && rd.poolSummer.length) {
      const item = rd.poolSummer.shift();
      if (item) {
        const submitWeek = state.absWeekCounter;
        const sg = rules.screenGap || [1, 2];
        const ig = rules.interviewGap || [1, 2];
        const app = {
          id: `job_${item.id}_${Math.random().toString(36).slice(2, 6)}`,
          name: item.name,
          tier: item.tier,
          phase: "job_apply",
          status: "submitted",
          screenWeek: submitWeek + randi(sg[0], sg[1]),
          interviewGap: ig
        };
        rd.applications.push(app);
      }
    }

    if (segKey === "TERM7" && segWeek === 1 && !rd.flags.jobPoolSelected && !state.eventPending) {
      if (window.openMultiSelectModal) {
        window.openMultiSelectModal({
          id: "JOB_TERM_POOL",
          title: "秋招投递清单（最多15家）",
          text: "选择秋招投递公司清单。",
          items: pool,
          max: rules.term7TotalLimit || 15,
          onConfirm: (picked) => {
            rd.pool = picked.slice();
            rd.flags.jobPoolSelected = true;
          }
        });
      } else {
        rd.pool = pool.slice(0, rules.term7TotalLimit || 15);
        rd.flags.jobPoolSelected = true;
      }
    }

    if (segKey === "TERM7" && rd.pool && rd.pool.length && (rd.counters.submitted || 0) < (rules.term7TotalLimit || 0)) {
      const toAdd = Math.min(rules.term7PerWeekLimit || 0, (rules.term7TotalLimit || 0) - (rd.counters.submitted || 0));
      for (let i = 0; i < toAdd; i++) {
        const item = rd.pool.shift();
        if (!item) break;
        const submitWeek = state.absWeekCounter;
        const sg = rules.screenGap || [1, 2];
        const ig = rules.interviewGap || [1, 2];
        const app = {
          id: `job_${item.id}_${Math.random().toString(36).slice(2, 6)}`,
          name: item.name,
          tier: item.tier,
          phase: "job_apply",
          status: "submitted",
          screenWeek: submitWeek + randi(sg[0], sg[1]),
          interviewGap: ig
        };
        rd.applications.push(app);
        rd.counters.submitted = (rd.counters.submitted || 0) + 1;
      }
    }

    for (const app of rd.applications) {
      if (app.phase !== "job_apply") continue;
      if (app.status === "submitted" && app.screenWeek && state.absWeekCounter >= app.screenWeek) {
        const ev = routeEvaluate(state, app.id, { scoringKey: rules.screenScoringKey, thresholdKey: rules.thresholdKey, tier: app.tier, passLabel: "invited", failLabel: "rejected" });
        if (ev.result === "invited") {
          app.status = "invited";
          app.eventWeek = app.screenWeek + randi(app.interviewGap[0], app.interviewGap[1]);
        } else {
          app.status = "rejected";
        }
        const logKey = rules.logKeyScreen || "jobScreen";
        safeLog(window.routeLog ? window.routeLog(logKey, { name: app.name, result: app.status }) : `[SCREEN] ${app.name} -> ${app.status}`);
      }
      if (app.status === "invited" && app.eventWeek === state.absWeekCounter) {
        app.preEventStatus = app.status;
        app.status = "interviewing";
        app.resultWeek = app.eventWeek;
        app.pendingResult = { scoringKey: rules.interviewScoringKey, thresholdKey: rules.thresholdKey, tier: app.tier, passLabel: "offer", failLabel: "rejected" };
        app.logKey = rules.logKeyInterview || "jobInterview";
        scheduleWeeklyList(state, app);
      }
    }

    if (segKey === "TERM8" && segWeek === 3 && !rd.flags.springSubmitted) {
      const spring = rules.springRules || {};
      const limit = spring.submitLimit || 0;
      for (let i = 0; i < limit; i++) {
        const item = pool[i];
        if (!item) break;
        const app = {
          id: `job_spring_${item.id}_${Math.random().toString(36).slice(2, 6)}`,
          name: item.name,
          tier: item.tier,
          phase: "job_spring",
          status: "interviewing",
          eventWeek: state.absWeekCounter,
          resultWeek: state.absWeekCounter,
          pendingResult: { scoringKey: rules.interviewScoringKey, thresholdKey: rules.thresholdKey, tier: item.tier, passLabel: "offer", failLabel: "rejected" }
        };
        rd.applications.push(app);
        scheduleWeeklyList(state, app);
      }
      rd.flags.springSubmitted = true;
    }
  }

  function scheduleCivil(state, route) {
    const rd = state.routeData;
    const segKey = getSegmentKey(state);
    const segWeek = Number(state.segment && state.segment.week || 1);
    const rules = route.examRules || {};
    const jobRules = route.jobRules || {};
    const pool = getPoolItems(jobRules.pool);

    if (segKey === "TERM7" && segWeek === 2 && !rd.civilJob && !state.eventPending) {
      if (window.openMultiSelectModal) {
        window.openMultiSelectModal({
          id: "CIVIL_JOB_SELECT",
          title: "考公岗位选择（国考）",
          text: "请选择1个岗位。",
          items: pool,
          max: jobRules.chooseLimit || 1,
          onConfirm: (picked) => {
            rd.civilJob = picked[0] || null;
          }
        });
      } else {
        rd.civilJob = pool[0] || null;
      }
    }

    if (segKey === "TERM7" && !rd.flags.civilWrittenScheduled && rules.writtenWeeks && rules.writtenWeeks.includes(segWeek)) {
      const job = rd.civilJob || { id: "civil", name: "国考岗位", tier: 3 };
      const app = {
        id: `civil_written_${job.id}_${Math.random().toString(36).slice(2, 6)}`,
        name: job.name,
        tier: job.tier,
        phase: "civil_written",
        status: "interviewing",
        eventWeek: state.absWeekCounter,
        resultWeek: state.absWeekCounter,
        resultHook: "civil_written",
        pendingResult: { scoringKey: rules.scoringKey, thresholdKey: "civilIn", tier: job.tier, passLabel: "pass", failLabel: "fail" },
        logKey: rules.logKeyWritten || "civilWritten"
      };
      rd.applications.push(app);
      scheduleWeeklyList(state, app);
      rd.flags.civilWrittenScheduled = true;
    }

    if (segKey === "TERM8" && segWeek === rules.interviewWeek && rd.flags.civilWrittenPassed && !rd.flags.civilInterviewScheduled) {
      const job = rd.civilJob || { id: "civil", name: "国考岗位", tier: 3 };
      const app = {
        id: `civil_interview_${job.id}_${Math.random().toString(36).slice(2, 6)}`,
        name: job.name,
        tier: job.tier,
        phase: "civil_interview",
        status: "interviewing",
        eventWeek: state.absWeekCounter,
        resultWeek: state.absWeekCounter,
        resultHook: "civil_interview",
        pendingResult: { scoringKey: rules.interviewScoringKey, thresholdKey: "civilIn", tier: job.tier, passLabel: "pass", failLabel: "fail" },
        logKey: rules.logKeyInterview || "civilInterview"
      };
      rd.applications.push(app);
      scheduleWeeklyList(state, app);
      rd.flags.civilInterviewScheduled = true;
    }

    if (segKey === "TERM8" && segWeek === rules.finalWeek && rd.flags.civilInterviewPassed && !rd.flags.civilFinalized) {
      const prob = route.scoring && route.scoring.finalCheckProb ? route.scoring.finalCheckProb : { base: 0.7, healthFactor: 1/200, luckFactor: 1/300 };
      const luck = getStatValue(state, "luck");
      const health = getStatValue(state, "health");
      let passProb = prob.base + (health - 50) * prob.healthFactor + luck * prob.luckFactor;
      passProb = clamp(passProb, 0, 1);
      if (Math.random() < passProb) {
        const offer = { id: "civil_final", name: "考公上岸", tier: 3, status: "offered" };
        rd.offers.push(offer);
      }
      rd.flags.civilFinalized = true;
    }
  }

  function processPendingResults(state) {
    const list = (state.routeData.applications || []);
    for (const app of list) {
      if (!app.pendingResult || app.status !== "interviewing") continue;
      if (app.resultWeek && app.resultWeek !== state.absWeekCounter) continue;
      const ev = routeEvaluate(state, app.id, app.pendingResult);
      app.lastResult = ev.result;
      if (ev.result === "offer") {
        app.status = "offered";
        addOffer(state, app, "offered");
      } else if (ev.result === "waitlist") {
        app.status = "waitlist";
      } else if (ev.result === "pass") {
        app.status = "passed";
      } else if (ev.result === "fail") {
        app.status = "failed";
      } else {
        app.status = "rejected";
      }
      if (app.resultHook === "kaoyan_exam") {
        state.routeData.flags.examPassed = (ev.result === "pass");
      } else if (app.resultHook === "kaoyan_retest") {
        if (ev.result === "pass") {
          addOffer(state, app, "offered");
        } else {
          state.routeData.flags.retestFailed = true;
        }
      } else if (app.resultHook === "civil_written") {
        state.routeData.flags.civilWrittenPassed = (ev.result === "pass");
      } else if (app.resultHook === "civil_interview") {
        state.routeData.flags.civilInterviewPassed = (ev.result === "pass");
      }
      const logKey = app.logKey || "routeResult";
      safeLog(window.routeLog ? window.routeLog(logKey, { name: app.name, result: app.status }) : `[RESULT] ${app.name} -> ${app.status}`);
      delete app.pendingResult;
      delete app.preEventStatus;
      delete app.resultDelay;
    }
  }

  function checkFallback(state, route) {
    const fb = route.fallback;
    if (!fb || !fb.enabled) return;
    const segKey = getSegmentKey(state);
    const week = Number(state.segment && state.segment.week || 1);
    if (fb.when && fb.when.segment && fb.when.segment !== segKey) return;
    if (fb.when && fb.when.week && fb.when.week !== week) return;

    const rd = state.routeData;
    if (rd.offers && rd.offers.length > 0) return;

    const vars = {
      gpa: getStatValue(state, "gpa"),
      english: getStatValue(state, "english"),
      research: getStatValue(state, "research"),
      majorSkill: getStatValue(state, "majorSkill"),
      examSkill: getStatValue(state, "examSkill"),
      interviewSkill: getStatValue(state, "interviewSkill"),
      docsQuality: getStatValue(state, "docsQuality"),
      health: getStatValue(state, "health"),
      stress: getStatValue(state, "stress"),
      luck: getStatValue(state, "luck"),
      failCourses: (state.failedCourseIds && state.failedCourseIds.size) ? state.failedCourseIds.size : 0,
      noDiscipline: !state.disciplineFlag,
      baoyanQuota: (window.PARAMS_V2 && window.PARAMS_V2.pushmian && window.PARAMS_V2.pushmian.gpaThreshold) ? window.PARAMS_V2.pushmian.gpaThreshold : 3.7,
      graduateOk: !state.disciplineFlag
    };

    let ok = true;
    const expr = fb.condition || "";
    const parts = expr.split("&&").map(s => s.trim()).filter(Boolean);
    for (const part of parts) {
      const m = part.match(/^([a-zA-Z_]+)\s*(>=|<=|==|>|<)\s*([a-zA-Z0-9_.]+)$/);
      if (!m) continue;
      const key = m[1];
      const op = m[2];
      const raw = m[3];
      const left = Number(vars[key]);
      const right = raw in vars ? Number(vars[raw]) : Number(raw);
      if (op === ">" && !(left > right)) ok = false;
      if (op === "<" && !(left < right)) ok = false;
      if (op === ">=" && !(left >= right)) ok = false;
      if (op === "<=" && !(left <= right)) ok = false;
      if (op === "==" && !(left == right)) ok = false;
    }

    if (!ok) return;
    const offer = { id: "fallback", name: fb.grant.name, tier: fb.grant.tier || 5, status: "offered" };
    rd.offers.push(offer);
    const logKey = fb.logKey || "fallbackOffer";
    safeLog(window.routeLog ? window.routeLog(logKey, { name: offer.name, result: offer.status }) : "[FALLBACK] offer");
  }

  function routeScheduleEvents(state) {
    const route = getRouteConfig(state);
    if (!route) return;
    state.routeData = state.routeData || {};
    state.routeData.weeklySchedule = state.routeData.weeklySchedule || {};
    const weekKey = String(state.absWeekCounter || 1);
    state.routeData.weeklySchedule[weekKey] = [];

    const stageInfo = routeGetStage(state);
    state.routeData.stage = stageInfo.stageKey || "";
    const segType = (state.segment && state.segment.type) || "TERM";
    const segWeeks = segType === "SUMMER" ? 8 : (segType === "WINTER" ? 4 : 16);
    const segWeek = Number(state.segment && state.segment.week || 1);
    state.routeData.countdownWeeks = Math.max(0, segWeeks - segWeek + 1);

    // 秋招流水线：暑假/TERM7自动推进
    if (getRouteKey(state) === "job") {
      jobWeekly(state);
    }

    if (route.flow === "camp_prepush") {
      if (segType === "SUMMER") scheduleSummer(state, route);
      if (getSegmentKey(state) === "TERM7") schedulePrepush(state, route);
    } else if (route.flow === "exam_retest") {
      scheduleKaoyan(state, route);
    } else if (route.flow === "apply_interview") {
      scheduleAbroad(state, route);
    } else if (route.flow === "job_pipeline") {
      scheduleJob(state, route);
    } else if (route.flow === "civil_exam") {
      scheduleCivil(state, route);
    }

    resolveConflicts(state);
    processPendingResults(state);
    checkFallback(state, route);
  }

  window.routeInit = routeInit;
  window.routeRebuildCalendar = routeRebuildCalendar;
  window.routeGetStage = routeGetStage;
  window.routeGetWeeklySlots = routeGetWeeklySlots;
  window.routeComputeScore = routeComputeScore;
  window.routeIsMoneyFrozen = routeIsMoneyFrozen;
  window.routeApplyWeeklyDrift = routeApplyWeeklyDrift;
  window.routeGetActionPool = routeGetActionPool;
  window.routeScheduleEvents = routeScheduleEvents;
  window.routeJobWeekly = jobWeekly;
  window.routeEvaluate = routeEvaluate;
  window.routeJobEnqueue = function (state, payload) {
    if (!payload || !payload.appId || !payload.type) return;
    const q = getPipelineQueue(state);
    q.push(payload);
  };
  // 供手动投递使用
  window.routeJobManualSubmit = function (state, companyNames = []) {
    const spec = getSpec();
    const pool = spec.COMPANY_40 || [];
    state.routeData = state.routeData || {};
    state.routeData.applications = state.routeData.applications || [];
    state.routeData.pipelineQueue = state.routeData.pipelineQueue || [];
    const nowAbs = absWeekIndex(state);
    const pick = companyNames.length ? companyNames : pool.slice(0, 6);
    for (const name of pick) {
      state.routeData.applications.push({
        id: `JOB_${nowAbs}_${name}`,
        name,
        tier: 3,
        status: "screening",
        submitAbsWeek: nowAbs,
        screenAbsWeek: nowAbs + randi(1, 2),
        interviewAbsWeek: null,
        offerAbsWeek: null,
        rounds: []
      });
    }
    safeLog(`[秋招] 手动投递 ${pick.length} 家：${pick.join("、")}`);
  };
})();

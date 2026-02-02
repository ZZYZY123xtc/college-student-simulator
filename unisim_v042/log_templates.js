(function () {
  const TEMPLATES = {
    segmentEnter: "[SEGMENT] 进入{segmentName} 第{week}周",
    moneyFrozenHint: "[SEGMENT] 假期资金冻结：补贴/固定支出暂停",
    weeklySlots: "[SEGMENT] 本周行动次数：{slots}",
    campInvite: "[保研] 收到夏令营通知：{name}",
    campOffer: "[保研] 夏令营结果：{name} -> {result}",
    prepushStart: "[保研] 预推免已开启：{count}所",
    prepushResult: "[保研] 预推免结果：{name} -> {result}",
    fallbackOffer: "[路线] 保底录取已生成",
    routeResult: "[路线] 结果：{name} -> {result}",
    kaoyanExam: "[考研] 初试结果：{name} -> {result}",
    kaoyanRetest: "[考研] 复试结果：{name} -> {result}",
    abroadScreen: "[出国] 申请筛选：{name} -> {result}",
    abroadInterview: "[出国] 面试结果：{name} -> {result}",
    jobScreen: "[秋招] 简历筛选：{name} -> {result}",
    jobInterview: "[秋招] 面试结果：{name} -> {result}",
    civilWritten: "[考公] 笔试结果：{name} -> {result}",
    civilInterview: "[考公] 面试结果：{name} -> {result}"
  };

  const ROUTE_PATCHES = {
    baoyan: {
      stageSummer: "[保研] 暑期阶段：夏令营准备",
      stagePrepush: "[保研] 学期阶段：预推免流程"
    }
  };

  function formatTemplate(text, vars) {
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  }

  function routeLog(key, vars) {
    const tmpl = TEMPLATES[key] || key;
    return formatTemplate(tmpl, vars || {});
  }

  function routeLogPatch(route, patchKey, vars) {
    const patch = (ROUTE_PATCHES[route] && ROUTE_PATCHES[route][patchKey]) || null;
    if (!patch) return routeLog(patchKey, vars);
    return formatTemplate(patch, vars || {});
  }

  window.routeLog = routeLog;
  window.routeLogPatch = routeLogPatch;
})();

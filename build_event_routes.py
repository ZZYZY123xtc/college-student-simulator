import pathlib

route_sets = {
    "pg": [
        ("PG_SIDE_01", "保研线：材料排版", "你把材料排版修了一下，显得更清晰。"),
        ("PG_SIDE_02", "保研线：学长提醒", "学长提醒你：简历细节很重要。"),
        ("PG_SIDE_03", "保研线：小道消息", "你听说某校名额有变动。"),
        ("PG_SIDE_04", "保研线：邮件来回", "来回确认材料格式，时间被占用。"),
        ("PG_SIDE_05", "保研线：老师建议", "老师给了你一个改进建议。"),
        ("PG_SIDE_06", "保研线：信息表格", "你整理了目标院校信息表。"),
        ("PG_SIDE_07", "保研线：同伴交流", "同伴分享了经验。"),
        ("PG_SIDE_08", "保研线：材料更新", "你补了一份材料说明。"),
        ("PG_SIDE_09", "保研线：轻微焦虑", "想到进度，你有点紧张。"),
        ("PG_SIDE_10", "保研线：自我复盘", "你复盘了一下优势和不足。"),
        ("PG_SIDE_11", "保研线：学术交流群", "群里讨论热闹。"),
        ("PG_SIDE_12", "保研线：信息核对", "你核对了时间节点。"),
        ("PG_SIDE_13", "保研线：细节改动", "你改了一个小细节。"),
        ("PG_SIDE_14", "保研线：分享资料", "你把资料分享给同学。"),
        ("PG_SIDE_15", "保研线：心态波动", "短暂心态波动。"),
        ("PG_SIDE_16", "保研线：进度稳住", "进度还行，你安心了点。"),
        ("PG_SIDE_17", "保研线：整理简历", "你把简历格式统一。"),
        ("PG_SIDE_18", "保研线：写作润色", "你润色了几句话。"),
        ("PG_SIDE_19", "保研线：轻度拖延", "有点拖延感。"),
        ("PG_SIDE_20", "保研线：阶段自评", "你给自己打了个分。"),
    ],
    "kaoyan": [
        ("KY_SIDE_01", "考研线：单词巩固", "你把高频词复习了一遍。"),
        ("KY_SIDE_02", "考研线：刷题间歇", "刷题中途走神了一会。"),
        ("KY_SIDE_03", "考研线：错题整理", "你整理了错题本。"),
        ("KY_SIDE_04", "考研线：群里打卡", "群里打卡提醒你别偷懒。"),
        ("KY_SIDE_05", "考研线：小型答疑", "同学帮你解了一题。"),
        ("KY_SIDE_06", "考研线：心态波动", "你突然有点焦虑。"),
        ("KY_SIDE_07", "考研线：计划微调", "你调整了学习计划。"),
        ("KY_SIDE_08", "考研线：日程复盘", "你把日程复盘了一下。"),
        ("KY_SIDE_09", "考研线：走神一会", "效率下降了一会。"),
        ("KY_SIDE_10", "考研线：复习顺利", "复习顺利，心态稳定。"),
        ("KY_SIDE_11", "考研线：重点标记", "你标记了重点章节。"),
        ("KY_SIDE_12", "考研线：和研友聊", "研友聊了聊近况。"),
        ("KY_SIDE_13", "考研线：临时小测", "做了个小测验。"),
        ("KY_SIDE_14", "考研线：学习环境", "你换了个学习环境。"),
        ("KY_SIDE_15", "考研线：夜间复习", "晚间复习强度提升。"),
        ("KY_SIDE_16", "考研线：短暂放松", "你短暂放松了一下。"),
        ("KY_SIDE_17", "考研线：资料收集", "你收集了一些资料。"),
        ("KY_SIDE_18", "考研线：笔记补完", "补齐了笔记。"),
        ("KY_SIDE_19", "考研线：节奏稳定", "节奏稳定下来。"),
        ("KY_SIDE_20", "考研线：小小进步", "你感到一点进步。"),
    ],
    "abroad": [
        ("AB_SIDE_01", "出国线：材料排版", "材料排版更整齐了。"),
        ("AB_SIDE_02", "出国线：语言碎片时间", "用零碎时间练了一会。"),
        ("AB_SIDE_03", "出国线：推荐信回顾", "你回顾了推荐信要点。"),
        ("AB_SIDE_04", "出国线：邮件回复", "处理了几封邮件。"),
        ("AB_SIDE_05", "出国线：资料整理", "你把材料分类整理。"),
        ("AB_SIDE_06", "出国线：心态浮动", "对结果有点担心。"),
        ("AB_SIDE_07", "出国线：同行交流", "和同学聊了申请进度。"),
        ("AB_SIDE_08", "出国线：文书润色", "你润色了一段文书。"),
        ("AB_SIDE_09", "出国线：资料缺口", "发现一处材料缺口。"),
        ("AB_SIDE_10", "出国线：进度清单", "你更新了进度清单。"),
        ("AB_SIDE_11", "出国线：口语热身", "口语热身了一会。"),
        ("AB_SIDE_12", "出国线：信息更新", "院校信息有新变化。"),
        ("AB_SIDE_13", "出国线：材料复核", "材料复核一遍。"),
        ("AB_SIDE_14", "出国线：预算核算", "你算了下预算。"),
        ("AB_SIDE_15", "出国线：小成就感", "完成一个小任务。"),
        ("AB_SIDE_16", "出国线：焦虑感", "等消息让人焦虑。"),
        ("AB_SIDE_17", "出国线：日程调整", "你调整了时间安排。"),
        ("AB_SIDE_18", "出国线：准备清单", "清单更清楚了。"),
        ("AB_SIDE_19", "出国线：信息咨询", "问了一个小问题。"),
        ("AB_SIDE_20", "出国线：状态稳定", "你感觉状态还行。"),
    ],
    "gongkao": [
        ("GK_SIDE_01", "考公线：做题习惯", "你又坚持做了一套小题。"),
        ("GK_SIDE_02", "考公线：申论素材", "你整理了一些素材。"),
        ("GK_SIDE_03", "考公线：政策浏览", "你浏览了近期政策。"),
        ("GK_SIDE_04", "考公线：走神一会", "今天走神了一会。"),
        ("GK_SIDE_05", "考公线：错题归纳", "错题归纳更清晰。"),
        ("GK_SIDE_06", "考公线：小结复盘", "你做了小结复盘。"),
        ("GK_SIDE_07", "考公线：同行交流", "同学分享了经验。"),
        ("GK_SIDE_08", "考公线：调整节奏", "你调整了学习节奏。"),
        ("GK_SIDE_09", "考公线：心态起伏", "心态有点起伏。"),
        ("GK_SIDE_10", "考公线：资料更新", "资料更新了一版。"),
        ("GK_SIDE_11", "考公线：小目标完成", "完成一个小目标。"),
        ("GK_SIDE_12", "考公线：刷题疲劳", "刷题有点疲劳。"),
        ("GK_SIDE_13", "考公线：小型总结", "总结后更清晰。"),
        ("GK_SIDE_14", "考公线：时间安排", "时间安排更合理。"),
        ("GK_SIDE_15", "考公线：复盘错题", "复盘错题。"),
        ("GK_SIDE_16", "考公线：静心阅读", "阅读政策文章。"),
        ("GK_SIDE_17", "考公线：计划上墙", "贴了学习计划。"),
        ("GK_SIDE_18", "考公线：同伴打卡", "被同伴打卡提醒。"),
        ("GK_SIDE_19", "考公线：慢慢稳定", "节奏稳定下来。"),
        ("GK_SIDE_20", "考公线：微小进步", "你感到一点进步。"),
    ],
    "qiuzhao": [
        ("QZ_SIDE_01", "秋招线：简历微调", "你改了简历一小段。"),
        ("QZ_SIDE_02", "秋招线：投递清单", "你整理了投递清单。"),
        ("QZ_SIDE_03", "秋招线：刷题笔记", "刷题笔记更清晰了。"),
        ("QZ_SIDE_04", "秋招线：同伴交流", "和同学聊了面经。"),
        ("QZ_SIDE_05", "秋招线：心态起伏", "想到结果有点紧张。"),
        ("QZ_SIDE_06", "秋招线：小目标完成", "完成一个小目标。"),
        ("QZ_SIDE_07", "秋招线：资料整理", "整理了作品/项目资料。"),
        ("QZ_SIDE_08", "秋招线：计划调整", "你调整了时间安排。"),
        ("QZ_SIDE_09", "秋招线：自我复盘", "你复盘了一下表现。"),
        ("QZ_SIDE_10", "秋招线：轻微拖延", "有点拖延感。"),
        ("QZ_SIDE_11", "秋招线：小分享", "你分享了经验给同学。"),
        ("QZ_SIDE_12", "秋招线：节奏稳住", "节奏稳住了。"),
        ("QZ_SIDE_13", "秋招线：资料更新", "更新了资料版本。"),
        ("QZ_SIDE_14", "秋招线：自我鼓励", "你给自己打气。"),
        ("QZ_SIDE_15", "秋招线：状态波动", "状态有点波动。"),
        ("QZ_SIDE_16", "秋招线：效率不错", "这周效率还不错。"),
        ("QZ_SIDE_17", "秋招线：阶段复盘", "阶段复盘了一次。"),
        ("QZ_SIDE_18", "秋招线：小习惯养成", "形成一个小习惯。"),
        ("QZ_SIDE_19", "秋招线：进度提醒", "系统提醒你别拖。"),
        ("QZ_SIDE_20", "秋招线：稳步前进", "稳步推进中。"),
    ],
}

options_by_route = {
    "pg": [
        [("补细节", "{ energy: -2, stress: +1 }", "细节更稳。"), ("对照要求", "{ energy: -3, termGradeBonus: +1 }", "更有条理。"), ("先放一放", "{ mood: +1, stress: -1 }", "缓一口气。")],
        [("请教学长", "{ social: +1, mood: +1 }", "经验很重要。"), ("继续打磨", "{ energy: -2, stress: +1 }", "保持推进。"), ("休息一下", "{ energy: +2, stress: -1 }", "稳住状态。")],
        [("整理清单", "{ energy: -2, stress: +1 }", "进度清晰。"), ("小范围调整", "{ energy: -2, mood: +1 }", "感觉更顺。"), ("暂停一下", "{ mood: +1, stress: -1 }", "不影响大方向。")],
    ],
    "kaoyan": [
        [("继续刷题", "{ energy: -3, stress: +2 }", "小步积累。"), ("整理错题", "{ energy: -2, termGradeBonus: +1 }", "效率更高。"), ("调整状态", "{ mood: +1, stress: -2 }", "稳住心态。")],
        [("补一章", "{ energy: -2, stress: +1 }", "推进一小步。"), ("换种题型", "{ energy: -2, mood: +1 }", "减少疲劳。"), ("短暂休息", "{ energy: +2, stress: -1 }", "缓一口气。")],
        [("复盘计划", "{ energy: -2, stress: +1 }", "节奏更稳。"), ("请教同伴", "{ social: +1, mood: +1 }", "思路更清晰。"), ("先放松", "{ mood: +1, stress: -1 }", "心态回稳。")],
    ],
    "abroad": [
        [("补材料", "{ energy: -2, stress: +1 }", "更完整。"), ("润色文书", "{ energy: -2, mood: +1 }", "更顺眼。"), ("先放缓", "{ mood: +1, stress: -1 }", "稳住节奏。")],
        [("处理邮件", "{ energy: -2, stress: +1 }", "进度推进。"), ("更新清单", "{ energy: -2, termGradeBonus: +1 }", "更有条理。"), ("暂停一下", "{ mood: +1, stress: -1 }", "不影响大方向。")],
        [("问问同学", "{ social: +1, mood: +1 }", "信息更足。"), ("继续准备", "{ energy: -2, stress: +1 }", "保持节奏。"), ("休息会儿", "{ energy: +2, stress: -1 }", "缓一口气。")],
    ],
    "gongkao": [
        [("刷一套题", "{ energy: -3, stress: +2 }", "熟悉题感。"), ("整理素材", "{ energy: -2, termGradeBonus: +1 }", "更有条理。"), ("调整状态", "{ mood: +1, stress: -2 }", "稳住心态。")],
        [("复盘错题", "{ energy: -2, stress: +1 }", "避免重复错。"), ("看下政策", "{ energy: -2, mood: +1 }", "信息更足。"), ("先休息", "{ energy: +2, stress: -1 }", "留点体力。")],
        [("继续练", "{ energy: -2, stress: +1 }", "稳步推进。"), ("请教同伴", "{ social: +1, mood: +1 }", "思路更清楚。"), ("缓一缓", "{ mood: +1, stress: -1 }", "不影响节奏。")],
    ],
    "qiuzhao": [
        [("改简历", "{ energy: -2, stress: +1 }", "更专业。"), ("整理投递", "{ energy: -2, mood: +1 }", "思路更清晰。"), ("先休息", "{ mood: +1, stress: -1 }", "稳住节奏。")],
        [("刷一会题", "{ energy: -3, stress: +2 }", "手感更熟。"), ("整理项目", "{ energy: -2, termGradeBonus: +1 }", "资料更齐。"), ("暂停一下", "{ energy: +2, stress: -1 }", "缓一口气。")],
        [("请教同学", "{ social: +1, mood: +1 }", "经验加成。"), ("继续推进", "{ energy: -2, stress: +1 }", "保持节奏。"), ("放松一下", "{ mood: +1, stress: -1 }", "心态更稳。")],
    ],
}

def route_gates(route, idx):
    if route == "pg":
        return ['gate({ route: "pg", termMin: 7, termMax: 7, weekMin: 1, weekMax: 4 })']
    if route == "qiuzhao":
        return [
            'gate({ route: "qiuzhao", termMin: 7, termMax: 7, weekMin: 4, weekMax: 16 })',
            'gate({ route: "qiuzhao", termMin: 8 })',
        ]
    if route == "abroad":
        return [
            'gate({ route: "abroad", termMin: 7, termMax: 7, weekMin: 1, weekMax: 16 })',
            'gate({ route: "abroad", termMin: 8, termMax: 8, weekMin: 1, weekMax: 9 })',
        ]
    if route == "kaoyan":
        if idx < 12:
            return ['gate({ route: "kaoyan", termMin: 7, termMax: 7, weekMin: 1, weekMax: 12 })']
        return ['gate({ route: "kaoyan", termMin: 8, termMax: 8, weekMin: 1, weekMax: 8 })']
    if route == "gongkao":
        if idx < 14:
            return ['gate({ route: "gongkao", termMin: 7, termMax: 7, weekMin: 1, weekMax: 11 })']
        return ['gate({ route: "gongkao", termMin: 8, termMax: 8, weekMin: 1, weekMax: 3 })']
    return [f'gate({{ route: \"{route}\", termMin: 7 }})']

lines = ["    // ========= 支线随机（扩容） ========="]
for route, items in route_sets.items():
    opts_pool = options_by_route[route]
    for i, (eid, title, desc) in enumerate(items):
        opts = opts_pool[i % len(opts_pool)]
        opt_lines = [f"        {{ text: \"{t}\", effects: {eff}, note: \"{note}\" }}" for t, eff, note in opts]
        options_text = ",\n".join(opt_lines)
        gates = ", ".join(route_gates(route, i))
        block = (
            "    {\n"
            f"      id: \"{eid}\",\n"
            f"      title: \"{title}\",\n"
            f"      text: \"{desc}\",\n"
            f"      tags: [\"route:{route}\"],\n"
            "      weight: 6,\n"
            "      cooldownWeeks: 4,\n"
            f"      gates: [{gates}],\n"
            "      options: [\n"
            f"{options_text}\n"
            "      ]\n"
            "    },"
        )
        lines.append(block)

path = pathlib.Path("event_route_block.txt")
path.write_text("\n".join(lines) + "\n", encoding="utf-8")
print("event_route_block.txt updated")

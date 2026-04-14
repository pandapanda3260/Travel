export const SHOT_PLAN_RUNTIME_HARD_RULES = [
  "narrationHint 必须给出具体表达方向，优先写用户收益、服务闭环、玩法差异或决策理由，不能只写“太值了/直接冲/更省力”这种空泛口号。",
  "旅行攻略类镜头的 narrationHint 要像真人会说的话题点，而不是景点名简单罗列。",
  "narrationHint 要说明“这句该抓什么重点、用什么情绪去讲、是否需要承接上一镜头”，而不是只丢一个形容词。",
  "detail / transition 这类强画面镜头允许留白；不要默认每个镜头都塞 narrationHint。",
  "开场 narrationHint 要有钩子感，收尾 narrationHint 要有收束感或行动感，中段 narrationHint 要把体验亮点或价值点讲具体。",
] as const;

export const PROMPT_GENERATION_RUNTIME_HARD_RULES = [
  "narrationScript 是最终配音/字幕成稿，不是口号集，也不是机械行程单。",
  "每句优先表达一个具体价值：玩法亮点、用户收益、服务省心点、体验感受、决策理由，至少命中一个。",
  "避免空泛口号，如“直接冲”“太出片了”“都逛完了”“这样逛更省力”这类低信息量短句；若使用，必须补足具体信息。",
  "除开场外，不要连续用“第一天/第二天/Day1/Day2”开头，攻略类视频应像真人带看，而不是播报行程。",
  "相邻镜头的句式要有变化，不能连续输出同一种短促口号句。",
  "无台词镜头必须保留空白，不要为了凑数硬写字幕。",
] as const;

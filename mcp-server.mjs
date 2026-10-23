import express from "express";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const root = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.join(root, "data", "resources.json");
const faqPath = path.join(root, "data", "faqs.json");
const data = JSON.parse(await readFile(dataPath, "utf8"));
const faqData = JSON.parse(await readFile(faqPath, "utf8"));
const faqs = Array.isArray(faqData.items) ? faqData.items : [];
const port = Number(process.env.PORT || 10000);
const visionConfidenceThreshold = 0.75;

// Expand common campus-support wording so queries do not depend on one exact phrase.
const synonymGroups = [
  ["想家", "想念家人", "思念家人", "离开家", "第一次离开家", "想爸妈", "想爸爸妈妈"],
  ["焦虑", "紧张", "担心", "慌", "不安", "压力大", "心慌"],
  ["孤独", "孤单", "寂寞", "没人陪", "没有朋友"],
  ["宿舍矛盾", "室友矛盾", "室友冲突", "室友不和", "宿舍关系", "室友作息", "室友太吵", "卫生问题", "被室友排斥"],
  ["睡眠困扰", "睡不着", "失眠", "睡不好", "睡眠", "熬夜"],
  ["社交压力", "交朋友", "不敢和同学说话", "集体活动", "陌生同学", "被评价", "拒绝别人"],
  ["校园欺凌", "霸凌", "被欺负", "被嘲笑", "骚扰", "偷拍", "跟踪", "威胁"],
  ["危机支持", "自伤", "自杀", "不想活", "伤害自己", "伤害他人", "危险", "安全风险", "无法保证安全", "危险物品"],
  ["心理咨询", "心理中心", "找咨询师", "找心理医生", "专业帮助"],
  ["学习压力", "没动力", "拖延", "考试焦虑", "课程听不懂", "学习安排"],
  ["报到适应", "报到", "迎新", "迷路", "新生", "校园适应", "安全感", "第一周计划"]
];

function normalizeText(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[\s，。！？、,.!?；;：“”"'（）()【】[\]《》<>]/g, "");
}

function expandSearchTerms(value = "") {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  const terms = new Set([normalized]);
  for (const group of synonymGroups) {
    const normalizedGroup = group.map(normalizeText);
    if (normalizedGroup.some((alias) => normalized.includes(alias))) {
      normalizedGroup.forEach((alias) => terms.add(alias));
    }
  }
  return [...terms].filter(Boolean);
}

function containsAnyTerm(text, terms) {
  const haystack = normalizeText(text);
  return terms.some((term) => haystack.includes(term));
}

function matches(resource, keyword, category) {
  const categoryMatch = !category || resource.category === category;
  if (!keyword) return categoryMatch;
  const haystack = [
    resource.name,
    resource.category,
    resource.suitable_for,
    resource.how_to_access,
    ...(resource.keywords || [])
  ].join(" ").toLowerCase();
  return categoryMatch && containsAnyTerm(haystack, expandSearchTerms(keyword));
}

function matchesFaq(faq, keyword) {
  if (!keyword) return false;
  return containsAnyTerm(
    [faq.question, faq.answer, ...(faq.keywords || [])].join(" "),
    expandSearchTerms(keyword)
  );
}

function formatResources(resources) {
  if (resources.length === 0) {
    return "暂未找到匹配的校园心理支持资源。请尝试更换关键词，或通过学校官网、校园服务平台查询正式支持渠道。";
  }
  return resources.map((resource, index) => [
    `${index + 1}. ${resource.name}（${resource.category}）`,
    `适用场景：${resource.suitable_for}`,
    `获取方式：${resource.how_to_access}`,
    `安全提示：${resource.safety_note}`
  ].join("\n")).join("\n\n");
}

function formatFaqs(items) {
  if (items.length === 0) return "";
  return [
    "相关常见问答：",
    ...items.map((item, index) => `${index + 1}. 问：${item.question}\n答：${item.answer}`)
  ].join("\n\n");
}

function normalizeHand(value = "") {
  const normalized = normalizeText(value);
  if ([
    "right", "r", "右", "右手", "右臂", "right_hand", "righthand",
    "right_hand_raised", "raised_right_hand", "raise_right_hand", "举右手", "右手举起"
  ].includes(normalized)) {
    return "right";
  }
  if ([
    "left", "l", "左", "左手", "左臂", "left_hand", "lefthand",
    "left_hand_raised", "raised_left_hand", "raise_left_hand", "举左手", "左手举起"
  ].includes(normalized)) {
    return "left";
  }
  if (["none", "无", "没有", "未识别", "unknown", "不确定", "未知"].includes(normalized)) {
    return "unknown";
  }
  return "unknown";
}

function normalizeGesture(value = "raised_hand") {
  const normalized = normalizeText(value);
  if ([
    "raised_hand", "raisedhand", "举手", "举起手", "举手动作", "举手示意",
    "举起右手", "举起左手", "右手举起", "左手举起",
    "right_hand_raised", "left_hand_raised", "raised_right_hand", "raised_left_hand"
  ].includes(normalized)) {
    return "raised_hand";
  }
  if (["pointing", "point", "指向", "指路", "指示"].includes(normalized)) {
    return "pointing";
  }
  return "unknown";
}

function isDirectionQuestion(question = "") {
  const normalized = normalizeText(question);
  const locationTerms = ["寝室", "宿舍", "宿舍楼", "寝室楼"];
  const directionTerms = ["这边", "这里", "这儿", "哪边", "哪里", "在哪", "方向", "怎么走"];
  return locationTerms.some((term) => normalized.includes(term))
    && directionTerms.some((term) => normalized.includes(term));
}

function formatHand(hand) {
  return hand === "right" ? "右" : "左";
}

function buildVisualBridgeReply({ question = "", raisedHand = "unknown", gesture = "raised_hand", confidence = 1 }) {
  const numericConfidence = Number(confidence);
  const safeConfidence = Number.isFinite(numericConfidence) ? numericConfidence : 0;

  if (safeConfidence < visionConfidenceThreshold) {
    return "我暂时不能确定你的动作，请把手放在镜头前并再做一次明显的举手动作。";
  }

  if (!["raised_hand", "pointing"].includes(gesture)) {
    return "我暂时只识别到一个不明确的动作，请再做一次举手或指向动作。";
  }

  const hand = normalizeHand(raisedHand);
  if (hand === "unknown") {
    return "我暂时没有可靠识别到你举的是哪只手，请再试一次。";
  }

  if (isDirectionQuestion(question)) {
    const oppositeHand = hand === "right" ? "left" : "right";
    return `不是的，在你的${formatHand(oppositeHand)}手。`;
  }

  return `我识别到你举起了${formatHand(hand)}手。请再说一下要确认的地点或方向。`;
}

function parseVisualObservation(payload = {}) {
  const question = typeof payload.question === "string" ? payload.question.trim() : "";
  const gesture = normalizeGesture(
    typeof payload.gesture === "string" ? payload.gesture.trim().toLowerCase() : "raised_hand"
  );
  const raisedHand = typeof payload.raised_hand === "string"
    ? payload.raised_hand
    : typeof payload.hand === "string"
      ? payload.hand
      : "unknown";
  const confidence = payload.confidence === undefined ? 1 : Number(payload.confidence);

  return {
    question,
    gesture,
    raisedHand,
    confidence,
    reply: buildVisualBridgeReply({ question, raisedHand, gesture, confidence })
  };
}

function createServer() {
  const server = new McpServer({
    name: "xiaoyingxing-campus-mental-support",
    version: "1.2.0"
  });

  server.registerTool(
    "query_campus_mental_resources",
    {
      description: "查询通用校园心理支持资源和相关常见问答。支持想家、焦虑、孤独、社交压力、宿舍矛盾、睡眠困扰、心理咨询、学习压力、新生报到和危机求助等表达的近义匹配。只返回信息查询与求助指引，不进行心理疾病诊断或治疗。遇到自伤、伤害他人或无法保证安全等情况，应优先建议联系身边可信任的人、学校正式支持渠道或当地紧急服务。",
      inputSchema: {
        keyword: z.string().optional().describe("用户想查询的关键词，例如想家、焦虑、宿舍矛盾或心理咨询"),
        category: z.string().optional().describe("资源类别，例如专业支持、校园支持、自助支持、危机支持或安全支持")
      }
    },
    async ({ keyword = "", category = "" }) => {
      const normalizedKeyword = keyword.trim();
      const resources = data.resources.filter((item) => matches(item, normalizedKeyword, category.trim()));
      // Avoid returning the whole FAQ library for an empty query. Return the most relevant few matches.
      const faqMatches = normalizedKeyword
        ? faqs.filter((item) => matchesFaq(item, normalizedKeyword)).slice(0, 5)
        : [];
      const sections = [];
      if (resources.length > 0) sections.push(formatResources(resources));
      if (faqMatches.length > 0) sections.push(formatFaqs(faqMatches));
      if (sections.length === 0) sections.push(formatResources([]));
      sections.push(
        `匹配资源数量：${resources.length}`,
        `匹配常见问答数量：${faqMatches.length}`,
        `安全提示：${data.notice}`
      );
      return {
        content: [{ type: "text", text: sections.join("\n\n") }]
      };
    }
  );

  server.registerTool(
    "bridge_visual_observation",
    {
      description: "接收外部视觉助手输出的结构化动作结果，并生成简短的校园方向回复。适用于用户打开摄像头、举手或指向后询问寝室/宿舍方向的场景。视觉助手应传入 question、raised_hand、gesture 和 confidence；置信度低于 0.75 时不会给出确定方向。只处理可见动作和相对方向，不进行情绪识别、心理诊断或危机判定。",
      inputSchema: {
        question: z.string().min(1).describe("用户正在询问的问题，例如：寝室在这边吗"),
        raised_hand: z.string().optional().describe("视觉助手识别的手，例如 right、left、右手或左手"),
        hand: z.string().optional().describe("raised_hand 的兼容字段；外部视觉助手可传 right 或 left"),
        gesture: z.string().optional().describe("动作类型，支持 raised_hand 或 pointing"),
        confidence: z.number().min(0).max(1).optional().describe("视觉识别置信度，0 到 1；低于 0.75 时请求用户重试")
      }
    },
    async (payload) => {
      const observation = parseVisualObservation(payload);
      return {
        content: [{ type: "text", text: observation.reply }]
      };
    }
  );

  return server;
}

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "xiaoyingxing-campus-mental-support-mcp", version: "1.2.0" });
});

// 外部视觉助手桥接入口。只保留本次请求的结构化结果，不保存原始图像或视频。
app.post("/api/v1/vision/observation", (req, res) => {
  const payload = req.body && typeof req.body === "object" ? req.body : {};
  const observation = parseVisualObservation(payload);
  res.json({
    ok: true,
    reply: observation.reply,
    observation: {
      question: observation.question,
      gesture: observation.gesture,
      raised_hand: normalizeHand(observation.raisedHand),
      confidence: Number.isFinite(observation.confidence) ? observation.confidence : 0
    }
  });
});

app.post("/mcp", async (req, res) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP request failed:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "MCP server error" },
        id: null
      });
    }
  } finally {
    res.on("close", () => {
      transport.close();
      server.close();
    });
  }
});

app.get("/mcp", (_req, res) => {
  res.status(405).json({ error: "MCP endpoint requires POST" });
});

app.delete("/mcp", (_req, res) => {
  res.status(405).json({ error: "Stateless MCP server does not keep sessions" });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`小盈星 MCP Server 已启动：http://localhost:${port}/mcp`);
});

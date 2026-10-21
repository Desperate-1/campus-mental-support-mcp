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

function createServer() {
  const server = new McpServer({
    name: "xiaoyingxing-campus-mental-support",
    version: "1.1.0"
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

  return server;
}

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "xiaoyingxing-campus-mental-support-mcp", version: "1.1.0" });
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

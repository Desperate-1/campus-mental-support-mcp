import express from "express";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const root = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.join(root, "data", "resources.json");
const data = JSON.parse(await readFile(dataPath, "utf8"));
const port = Number(process.env.PORT || 10000);

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
  return categoryMatch && haystack.includes(keyword.toLowerCase());
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

function createServer() {
  const server = new McpServer({
    name: "xiaoyingxing-campus-mental-support",
    version: "1.0.0"
  });

  server.registerTool(
    "query_campus_mental_resources",
    {
      description: "查询通用校园心理支持资源。适用于想家、焦虑、孤独、社交压力、宿舍矛盾、睡眠困扰、心理咨询和危机求助等场景。只返回信息查询与求助指引，不进行心理疾病诊断或治疗。遇到自伤、伤害他人或无法保证安全等情况，应优先建议联系身边可信任的人、学校正式支持渠道或当地紧急服务。",
      inputSchema: {
        keyword: z.string().optional().describe("用户想查询的关键词，例如想家、焦虑、宿舍矛盾或心理咨询"),
        category: z.string().optional().describe("资源类别，例如专业支持、校园支持、自助支持、危机支持或安全支持")
      }
    },
    async ({ keyword = "", category = "" }) => {
      const resources = data.resources.filter((item) => matches(item, keyword.trim(), category.trim()));
      const text = [
        formatResources(resources),
        `匹配资源数量：${resources.length}`,
        `安全提示：${data.notice}`
      ].join("\n\n");
      return {
        content: [{ type: "text", text }]
      };
    }
  );

  return server;
}

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "xiaoyingxing-campus-mental-support-mcp", version: "1.0.0" });
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

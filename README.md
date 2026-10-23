# 校园心理支持资源查询插件（通用版）

这是给“小盈星——新生心理适应与校园支持助手”使用的无鉴权 MCP Server。

当前版本还会读取 `data/faqs.json` 中的常见问答。用户输入关键词时，工具会返回最多 5 条相关问答，并对想家、室友矛盾、睡眠、社交压力等常见说法进行近义匹配。

当前还提供一个轻量级视觉桥接：外部视觉助手只需把动作识别结果（例如“举起右手”）转换成结构化 JSON，再调用 `bridge_visual_observation` 工具或视觉桥接 HTTP 入口。服务不接收、不保存原始图像和视频。

## 通用版范围

- 不包含学校名称、校址、电话、个人信息或账号信息。
- 不编造具体学校的心理中心、热线和预约入口。
- 返回通用资源类型、适用场景和安全提示。
- 不进行心理疾病诊断、治疗或危机处置。

## MCP 接入

MCP 入口：

```text
https://你的部署域名/mcp
```

健康检查：

```text
https://你的部署域名/health
```

在灵心的插件类型中选择 `MCP Server`，鉴权方式选择“不需要鉴权”，请求头留空。MCP 会自动读取 `query_campus_mental_resources` 和 `bridge_visual_observation` 两个工具，不需要手动填写工具的输入参数或输出参数。

## 配置到智能体的完整过程

下面的流程适合比赛演示。它把“看摄像头”和“生成最终回复”拆成两个环节：外部视觉助手负责判断用户举的是哪只手，灵心智能体通过 MCP 工具负责根据结构化结果回答。

### 第一步：准备并部署 MCP Server

1. 确认仓库中包含以下文件：

   ```text
   package.json
   mcp-server.mjs
   data/resources.json
   data/faqs.json
   ```

2. 将 `校园心理支持资源插件` 文件夹上传到 GitHub。
3. 在 Render 创建 **New → Web Service**，连接这个 GitHub 仓库。
4. 如果插件不在仓库根目录，把 `Root Directory` 设置为 `校园心理支持资源插件`。
5. 填写以下配置：

   ```text
   Runtime: Node
   Build Command: npm install
   Start Command: npm start
   ```

6. 部署完成后打开：

   ```text
   https://你的服务名.onrender.com/health
   ```

   返回 `ok: true` 后，说明服务已经启动。灵心中最终填写的 MCP 地址必须带上 `/mcp`：

   ```text
   https://你的服务名.onrender.com/mcp
   ```

### 第二步：把 MCP Server 添加到灵心

1. 打开灵心平台的智能体编辑或调试页面。
2. 进入插件配置，选择插件类型 **MCP Server**。
3. 将鉴权方式设为 **不需要鉴权**。
4. 将 MCP 地址填为 Render 地址加 `/mcp`，例如：

   ```text
   https://campus-support-demo.onrender.com/mcp
   ```

5. 请求头保持为空，保存并刷新工具列表。
6. 确认工具列表中出现：

   ```text
   query_campus_mental_resources
   bridge_visual_observation
   ```

如果只能看到旧的资源查询工具，先重新部署 Render，再在灵心中删除旧配置并重新添加 MCP 地址。

### 第三步：配置智能体说明

把下面这段放进智能体的角色设定、行为规范或工具使用说明中。它规定了什么时候调用视觉桥接工具，以及什么时候不能猜测摄像头内容。

```text
你是校园新生支持助手。

当外部视觉助手已经提供以下结构化信息时，可以调用 bridge_visual_observation：
- question：用户的原始问题
- raised_hand 或 hand：right/left，表示用户举起的手
- gesture：raised_hand 或 pointing
- confidence：0 到 1 的视觉识别置信度

调用 bridge_visual_observation 时，原样传入用户问题和视觉助手给出的动作结果。
如果用户询问“寝室/宿舍在这边吗”“宿舍在哪边”等方向问题，工具会根据左右手生成简短回复。
如果 confidence 低于 0.75，应该让用户重新做出明显动作。
没有外部视觉助手提供的结构化结果时，不要根据“用户打开了摄像头”自行推断用户举了哪只手，也不要声称已经看到了画面。
视觉桥接只处理举手、指向和左右方向，不进行情绪识别、心理诊断或危机判断。
```

### 第四步：连接外部视觉助手

灵心的 MCP 工具只接收结构化字段，摄像头画面的识别由外部视觉助手完成。外部视觉助手需要完成以下动作：

1. 读取用户同意提供的摄像头画面。
2. 判断用户是否举手或指向。
3. 判断是左手还是右手。
4. 读取用户的文字或语音问题。
5. 生成结构化结果，再交给灵心智能体。

推荐发送的结构如下：

```json
{
  "question": "寝室在这边吗",
  "raised_hand": "right",
  "gesture": "raised_hand",
  "confidence": 0.96
}
```

这时灵心智能体调用：

```text
bridge_visual_observation(
  question="寝室在这边吗",
  raised_hand="right",
  gesture="raised_hand",
  confidence=0.96
)
```

工具返回：

```text
不是的，在你的左手。
```

外部视觉助手如果采用 HTTP 方式，可以请求：

```http
POST https://你的服务名.onrender.com/api/v1/vision/observation
Content-Type: application/json
```

请求体使用上面的 JSON。HTTP 返回中的 `reply` 可以作为下一条智能体消息内容，或者作为智能体调用 MCP 工具时的结构化输入。

### 第五步：在灵心调试窗口验证

建议按下面顺序测试：

1. 不打开摄像头，只输入“寝室在这边吗”。智能体不应声称识别到了手势。
2. 打开摄像头，举起右手并输入“寝室在这边吗”。视觉助手提交 `raised_hand: right` 后，回复应为“不是的，在你的左手。”。
3. 举起左手并重复提问，回复应为“不是的，在你的右手。”。
4. 将 `confidence` 改为 `0.50`，智能体应要求用户重新做出明显动作。
5. 传入 `gesture: pointing`，确认指向动作也可以触发方向回复。
6. 只提供图片但没有左右手和置信度字段，智能体应继续询问或要求视觉助手补充结构化结果。

### 第六步：演示时的最短操作路径

比赛现场可以按这个顺序演示：

1. 打开灵心智能体调试页面。
2. 打开摄像头并允许页面使用摄像头。
3. 学生举起右手，说“寝室在这边吗”。
4. 外部视觉助手输出右手、举手动作和置信度。
5. 灵心调用 `bridge_visual_observation`。
6. 智能体回答：“不是的，在你的左手。”

如果灵心页面本身不能把摄像头帧直接提供给外部视觉助手，就需要让外部视觉助手单独运行在浏览器或本地桥接程序中，再通过 HTTP 接口提交结构化结果。

### 视觉桥接工具

工具名：`bridge_visual_observation`

输入示例：

```json
{
  "question": "寝室在这边吗",
  "raised_hand": "right",
  "gesture": "raised_hand",
  "confidence": 0.96
}
```

当视觉助手识别到右手举起，且问题包含寝室/宿舍方向时，工具返回：

```text
不是的，在你的左手。
```

识别置信度低于 `0.75` 时，工具会要求用户重新做出明显动作，不会直接给出方向结论。

灵心侧的智能体说明建议写成：只有外部视觉助手已经给出 `raised_hand`、`pointing`、左右手和置信度等结构化结果时，才调用这个工具；没有这些字段时先继续文字对话，不要根据“打开了摄像头”自行推断动作。

### 外部视觉助手 HTTP 桥接

视觉助手也可以直接调用：

```http
POST /api/v1/vision/observation
Content-Type: application/json
```

请求体与 MCP 工具参数相同。返回结果包含 `reply` 和标准化后的动作字段，适合视觉助手先识别、再把文字结果交给灵心智能体继续对话。

## 旧版 REST 接口

`server.mjs` 仍保留原来的 REST API 代码，方便对照和本地参考；Render 的启动命令现在运行 `mcp-server.mjs`，实际接入使用 MCP 入口。

### 健康检查

```http
GET /api/v1/health
```

### 查询资源

```http
GET /api/v1/resources
GET /api/v1/resources?keyword=想家
GET /api/v1/resources?category=专业支持
```

返回结果提供 `result` 字符串、`count` 数字和 `notice` 安全提示，适合不支持复杂数组对象结构的 HTTP 工具平台。

### 查询单个资源

```http
GET /api/v1/resources/campus-counseling-center
```

接口不需要鉴权。平台配置时，基础地址填写部署后的域名，例如：

```text
https://你的部署域名
```

请求路径填写 `/api/v1/resources`。

## 本地预览

```bash
npm start
```

本地地址：`http://localhost:8787`

本地地址只能用于预览。要让灵心平台调用，需要将 MCP Server 部署到可公网访问的 HTTPS 地址。

## 使用 Render 部署

1. 将本文件夹内的 `package.json`、`mcp-server.mjs` 和 `data/` 上传到一个 GitHub 仓库，确保 `data/faqs.json` 一并上传。
2. 登录 Render，选择 **New → Web Service**，连接这个仓库。
3. 如果这些文件位于仓库根目录，`Root Directory` 留空；如果仓库外层还有文件夹，则把它填为 `校园心理支持资源插件`。
4. 填写：
   - Runtime：`Node`
   - Build Command：`npm install`
   - Start Command：`npm start`
   - Instance Type：测试阶段可选 `Free`
5. 部署完成后，Render 会生成一个 `https://你的服务名.onrender.com` 地址。
6. 用下面的地址检查接口：

```text
https://你的服务名.onrender.com/api/v1/health
```

返回 `ok: true` 后，把 `https://你的服务名.onrender.com` 填入灵心插件的基础地址。

对于 MCP 插件，最终应填写完整地址：

```text
https://你的服务名.onrender.com/mcp
```

免费服务长时间没有请求时会自动休眠，第一次访问可能需要等待约一分钟，适合比赛演示和测试，不适合承载紧急求助服务。

## 接入安全建议

插件只返回资源信息或视觉桥接结果，不保存用户对话，不接收姓名、学号、手机号或其他身份信息，也不保存原始图像或视频。视觉桥接只处理动作、方向和置信度等结构化结果，不进行情绪识别、心理疾病诊断或危机判定。遇到自伤、他伤或无法保证安全的情况，应优先引导用户到安全地点并联系身边可信任的人、学校正式支持渠道或当地紧急服务。

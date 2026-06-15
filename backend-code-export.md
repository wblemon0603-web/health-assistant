# 健康饮食助手 - 后端完整代码导出

> 导出时间：2026-06-15
> 技术栈：Next.js 14 App Router + TypeScript + Supabase (PostgreSQL) + Coze AI

---

## 📋 问题诊断报告（已修复）

### 问题现象
- 手机生产环境发送消息时，**用户消息和饮食记录不写入数据库**
- chat_history 表的 id 有大量 gap（16 → 77 → 95），说明 `INSERT` 语句执行但**行未持久化**
- 前端 `session_id` 与后端生成的 `session_id` 不一致

### 根因分析
| # | 根因 | 影响 |
|---|------|------|
| 1 | **前端没传 session_id** → `callChatApi()` 只传了 `{ message, image_url }`，后端每次都生成新的 `sess_${Date.now()}` | session_id 不一致导致历史消息查不到 |
| 2 | **Supabase RLS（行级安全）策略** → 表开启了 RLS 但没给 anon key 配 INSERT 权限 | INSERT 被静默拒绝，但序列仍自增，产生 id gap |
| 3 | **`getSupabaseClient()` 只用了 ANON_KEY** → 没优先使用 SERVICE_ROLE_KEY | 绕过 RLS 才能正常写入 |

### 修复点
1. **前端**：`callChatApi()` 补上 `session_id`（见 `app.js` 第 262 行）
2. **后端**：`getSupabaseClient()` 优先使用 `COZE_SUPABASE_SERVICE_ROLE_KEY`（绕过 RLS）
3. **Supabase 控制台**：在 `chat_history`、`daily_food_log`、`user_profile`、`meal_history` 表上禁用 RLS 或配置正确策略

---

## 1. src/app/api/chat/route.ts
> 智能对话接口：接收用户消息 → 写入数据库 → 调用 AI → 写入助手回复 → 返回结果
> POST /api/chat

```typescript
import { NextRequest, NextResponse } from "next/server";
import { chatWithAI } from "@/lib/chat-service";
import { insertChatMessage } from "@/lib/db-service";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, image_url, session_id } = body as {
      message?: string;
      image_url?: string;
      session_id?: string;
    };

    if (!message) {
      return NextResponse.json(
        { error: "参数 message 不能为空" },
        { status: 400 }
      );
    }

    // 【修复前】session_id 为空时每次都生成新的，导致与前端 session_id 不一致
    // 【修复后】前端必须传 session_id，保持前后端同一个会话 ID
    const finalSessionId = session_id || `sess_${Date.now()}`;

    // Save user message
    const userMessageId = await insertChatMessage(
      "user",
      message,
      finalSessionId,
      image_url
    );

    // Call AI (AI 会自动调用 log_food / save_profile 等工具，写入饮食记录和用户画像)
    const result = await chatWithAI(message, image_url, finalSessionId);

    // Save assistant message
    const assistantMessageId = await insertChatMessage(
      "assistant",
      result.reply,
      result.session_id
    );

    return NextResponse.json({
      reply: result.reply,
      used_tools: result.usedTools,
      session_id: result.session_id,
      user_message_id: userMessageId,
      assistant_message_id: assistantMessageId,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "未知错误";
    console.error("Chat API error:", errorMessage);
    return NextResponse.json(
      { error: `对话失败: ${errorMessage}` },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}
```

---

## 2. src/app/api/messages/save/route.ts
> 手动保存单条消息（通常不需要，因为 /api/chat 已自动保存）
> POST /api/messages/save

```typescript
import { NextRequest, NextResponse } from "next/server";
import { insertChatMessage } from "@/lib/db-service";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { role, content, session_id, image_url } = body as {
      role?: string;
      content?: string;
      session_id?: string;
      image_url?: string;
    };

    // 参数校验
    if (!role || (role !== "user" && role !== "assistant")) {
      return NextResponse.json(
        { success: false, error: "参数 role 必须是 user 或 assistant" },
        { status: 400 }
      );
    }
    if (!content) {
      return NextResponse.json(
        { success: false, error: "参数 content 不能为空" },
        { status: 400 }
      );
    }
    if (!session_id) {
      return NextResponse.json(
        { success: false, error: "参数 session_id 不能为空" },
        { status: 400 }
      );
    }

    const messageId = await insertChatMessage(role, content, session_id, image_url);

    return NextResponse.json({
      success: true,
      message_id: messageId,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "未知错误";
    console.error("Save message error:", errorMessage);
    return NextResponse.json(
      { success: false, error: `保存消息失败: ${errorMessage}` },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}
```

---

## 3. src/app/api/messages/history/route.ts
> 按 session_id 查询最近 N 条消息，按时间正序返回
> GET /api/messages/history?session_id=xxx&limit=50

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getChatHistory } from "@/lib/db-service";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("session_id");
    const limitStr = searchParams.get("limit");
    const limit = limitStr ? Math.min(parseInt(limitStr, 10), 100) : 50;

    if (!sessionId) {
      return NextResponse.json(
        { error: "参数 session_id 不能为空" },
        { status: 400 }
      );
    }

    const messages = await getChatHistory(sessionId, limit);

    return NextResponse.json({ messages });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "未知错误";
    console.error("Get history error:", errorMessage);
    return NextResponse.json(
      { error: `查询历史消息失败: ${errorMessage}` },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}
```

---

## 4. src/app/api/food-logs/route.ts
> 查询指定日期的饮食记录
> GET /api/food-logs?date=YYYY-MM-DD

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getFoodLogsByDate } from "@/lib/db-service";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: "参数 date 格式不正确，应为 YYYY-MM-DD" },
        { status: 400 }
      );
    }

    const logs = await getFoodLogsByDate(date);
    const totalCalories = logs.reduce((sum, log) => sum + (log.calories || 0), 0);
    const targetCalories = 1750;

    return NextResponse.json({
      date,
      target_calories: targetCalories,
      total_calories: totalCalories,
      remaining_calories: targetCalories - totalCalories,
      is_over_budget: totalCalories > targetCalories,
      logs,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "未知错误";
    console.error("Get food logs error:", errorMessage);
    return NextResponse.json(
      { error: `查询饮食记录失败: ${errorMessage}` },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}
```

---

## 5. src/lib/chat-service.ts
> AI 对话与工具调用核心逻辑

```typescript
import { LLMClient, Config } from "coze-coding-dev-sdk";
import {
  insertFoodLog,
  getUserProfile,
  saveProfile,
  getFoodLogsByDate,
} from "./db-service";
import { searchWeb } from "./search-service";

const SYSTEM_PROMPT = `你是一个健康饮食助手。用户信息：身高183cm、体重72kg、目标70kg、有脂肪肝。
- TDEE 约 2150 kcal，每日目标摄入 1750 kcal
- 优先推荐：高蛋白、低脂、高纤维食物
- 默认城市：北京

你的能力：
1. 食物热量估算 - 估算食物的热量和营养成分
2. 饮食记录 - 当用户提到吃了什么时，必须立即记录
3. 热量缺口计算 - 计算当日累计摄入 vs 1750kcal 目标
4. 餐厅推荐 - 搜索附近健康餐厅
5. 运动方案推荐 - 当热量超标时推荐运动方案
6. 用户画像推断 - 从对话中自动提取并存储用户偏好

今天是 ${new Date().toISOString().split("T")[0]}。

【重要规则】
1. 用户提到吃了什么时，必须立即调用 log_food 记录，不要问"需要帮你记录吗"
2. 如果用户没说明份量，按常见份量估算（如：牛肉=100g，米饭=1碗150g，苹果=1个200g）
3. 如果用户没说明餐次，根据上下文推断（早上=早餐，中午=午餐，晚上=晚餐）
4. 记录饮食时，日期用今天日期：${new Date().toISOString().split("T")[0]}

工具调用格式（在回复中包含以下 JSON 代码块）：

记录饮食：
\`\`\`json
{"tool": "log_food", "params": {"date": "YYYY-MM-DD", "meal_type": "breakfast/lunch/dinner/snack", "food_items": [{"name": "食物名", "calories": 数字, "protein": 数字, "fat": 数字, "carbs": 数字, "amount": "份量"}], "calories": 总热量}}
\`\`\`

搜索餐厅：
\`\`\`json
{"tool": "search_restaurant", "params": {"query": "搜索关键词", "city": "城市"}}
\`\`\`

网页搜索：
\`\`\`json
{"tool": "web_search", "params": {"query": "搜索关键词"}}
\`\`\`

保存用户画像：
\`\`\`json
{"tool": "save_profile", "params": {"key": "画像键", "value": "画像值"}}
\`\`\`

请在回复中先给出工具调用 JSON，然后再给出文字回复。`;

interface ToolCall {
  tool: string;
  params: Record<string, unknown>;
}

/**
 * 执行解析出的工具调用并返回结果
 */
async function executeToolCall(toolCall: ToolCall): Promise<unknown> {
  const { tool, params } = toolCall;

  try {
    switch (tool) {
      case "log_food": {
        const { date, meal_type, food_items, calories } = params as {
          date: string;
          meal_type: string;
          food_items: Array<{
            name: string;
            calories: number;
            protein: number;
            fat: number;
            carbs: number;
            amount: string;
          }>;
          calories: number;
        };
        const result = await insertFoodLog(date, meal_type, food_items, calories);
        console.log(
          `[Tool] log_food executed: date=${date}, calories=${calories}, id=${result?.id}`
        );
        return result;
      }

      case "search_restaurant": {
        const { query, city } = params as { query: string; city: string };
        const searchQuery = `${city || "北京"} ${query} 健康餐厅推荐`;
        const results = await searchWeb(searchQuery);
        return results;
      }

      case "web_search": {
        const { query } = params as { query: string };
        const results = await searchWeb(query);
        return results;
      }

      case "save_profile": {
        const { key, value } = params as { key: string; value: string };
        const result = await saveProfile(key, value);
        return result;
      }

      default:
        console.warn(`[Tool] Unknown tool: ${tool}`);
        return { error: `Unknown tool: ${tool}` };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Tool] ${tool} failed:`, msg);
    return { error: msg };
  }
}

/**
 * 从 AI 回复中解析 JSON 工具调用代码块
 */
function parseToolCalls(text: string): ToolCall[] {
  const toolCalls: ToolCall[] = [];
  const regex = /```json\s*\n?([\s\S]*?)\n?\s*```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.tool && parsed.params) {
        toolCalls.push(parsed as ToolCall);
      }
    } catch {
      // Not valid JSON, skip
    }
  }
  return toolCalls;
}

/**
 * 从对话中提取用户画像并保存
 */
async function extractAndSaveProfile(userMessage: string): Promise<void> {
  const profileKeywords: Record<string, string[]> = {
    allergy: ["过敏", "不能吃", "忌口"],
    taste_preference: ["口味", "偏好", "喜欢", "爱吃"],
    exercise_habit: ["运动", "锻炼", "健身", "跑步", "游泳"],
    disease: ["疾病", "病史", "诊断", "脂肪肝", "糖尿病", "高血压"],
    goal: ["目标", "想要", "希望", "减重", "增肌"],
  };

  for (const [key, keywords] of Object.entries(profileKeywords)) {
    if (keywords.some((kw) => userMessage.includes(kw))) {
      try {
        const config = new Config();
        const client = new LLMClient(config);
        const response = await client.invoke(
          [
            {
              role: "system",
              content: `从用户消息中提取"${key}"相关信息，只返回提取的值，不要其他内容。如果无法提取，返回空字符串。`,
            },
            { role: "user", content: userMessage },
          ],
          { model: "doubao-seed-1-8-251228" }
        );
        const value = response.content?.trim();
        if (value && value.length > 0 && value.length < 200) {
          await saveProfile(key, value);
        }
      } catch {
        // Silently fail - profile extraction is best-effort
      }
    }
  }
}

/**
 * 从回复文本中清理掉 JSON 工具调用代码块，只保留可读文字
 */
function cleanToolCallsFromReply(text: string): string {
  return text
    .replace(/```json\s*\n?[\s\S]*?\n?\s*```/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * AI 对话主函数：调用 LLM → 解析工具调用 → 执行工具 → 返回清理后的回复
 */
export async function chatWithAI(
  message: string,
  imageUrl?: string,
  sessionId?: string
): Promise<{ reply: string; usedTools: string[]; session_id: string }> {
  const sid = sessionId || `sess_${Date.now()}`;
  const usedTools: string[] = [];

  // 获取用户画像，作为上下文补充
  let profileContext = "";
  try {
    const profiles = await getUserProfile();
    if (Object.keys(profiles).length > 0) {
      profileContext = `\n\n已知用户画像：${JSON.stringify(profiles)}`;
    }
  } catch {
    // Continue without profile
  }

  // 构建消息数组
  const messages: Array<{
    role: "system" | "user" | "assistant";
    content:
      | string
      | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  }> = [{ role: "system", content: SYSTEM_PROMPT + profileContext }];

  // 添加用户消息（支持图片）
  if (imageUrl) {
    messages.push({
      role: "user",
      content: [
        { type: "text", text: message },
        { type: "image_url", image_url: { url: imageUrl } },
      ],
    });
  } else {
    messages.push({ role: "user", content: message });
  }

  // 调用 LLM
  const config = new Config();
  const client = new LLMClient(config);
  const response = await client.invoke(messages, {
    model: "doubao-seed-1-8-251228",
  });
  const fullReply = response.content || "";

  // 解析并执行工具调用
  const toolCalls = parseToolCalls(fullReply);
  for (const toolCall of toolCalls) {
    try {
      const result = await executeToolCall(toolCall);
      if (result && typeof result === "object" && "error" in result) {
        usedTools.push(`${toolCall.tool}(failed)`);
      } else {
        usedTools.push(toolCall.tool);
      }
    } catch {
      usedTools.push(`${toolCall.tool}(failed)`);
    }
  }

  // 从回复文本中清理掉 JSON 代码块
  const cleanReply = cleanToolCallsFromReply(fullReply);

  // 异步提取用户画像（不阻塞回复）
  extractAndSaveProfile(message).catch(() => {});

  return {
    reply: cleanReply || fullReply,
    usedTools,
    session_id: sid,
  };
}
```

---

## 6. src/lib/db-service.ts
> 所有数据库 CRUD 操作

```typescript
import { getSupabaseClient } from "@/storage/database/supabase-client";

// ============================================================
// Food Log - 每日饮食记录
// ============================================================

export async function insertFoodLog(
  date: string,
  mealType: string,
  foodItems: Array<{
    name: string;
    calories: number;
    protein: number;
    fat: number;
    carbs: number;
    amount: string;
  }>,
  calories: number
) {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("daily_food_log")
    .insert({
      date,
      meal_type: mealType,
      food_items: foodItems,
      calories,
    })
    .select("id")
    .single();

  if (error) {
    console.error("DEBUG-DB insertFoodLog error:", error.message);
    throw error;
  }
  console.log("DEBUG-DB insertFoodLog success:", JSON.stringify(data));
  return data;
}

export async function getFoodLogsByDate(date: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("daily_food_log")
    .select("*")
    .eq("date", date)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

// ============================================================
// Meal History - 餐食推荐历史
// ============================================================

export async function insertMealHistory(date: string, recommendation: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("meal_history")
    .insert({ date, recommendation })
    .select("id")
    .single();

  if (error) throw error;
  return data;
}

export async function getMealHistoryByDate(date: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("meal_history")
    .select("*")
    .eq("date", date)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

// ============================================================
// User Profile - 用户画像（key-value）
// ============================================================

export async function getUserProfile(): Promise<Record<string, string>> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("user_profile")
    .select("key, value");

  if (error) throw error;

  const profiles: Record<string, string> = {};
  for (const item of data || []) {
    profiles[item.key] = item.value;
  }
  return profiles;
}

export async function saveProfile(key: string, value: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("user_profile")
    .upsert({ key, value }, { onConflict: "key" })
    .select("id")
    .single();

  if (error) throw error;
  return data;
}

// ============================================================
// Chat History - 聊天记录
// ============================================================

export async function insertChatMessage(
  role: string,
  content: string,
  sessionId: string,
  imageUrl?: string
) {
  const supabase = getSupabaseClient();
  const insertData: Record<string, unknown> = {
    role,
    content,
    session_id: sessionId,
  };
  if (imageUrl) {
    insertData.image_url = imageUrl;
  }

  const { data, error } = await supabase
    .from("chat_history")
    .insert(insertData)
    .select("id")
    .single();

  if (error) {
    console.error(
      "DEBUG-DB insertChatMessage error:",
      error.message,
      "data:",
      JSON.stringify(insertData)
    );
    throw error;
  }

  console.log(
    "DEBUG-DB insertChatMessage success: id=" + data.id + " role=" + role
  );
  return data.id;
}

export async function getChatHistory(
  sessionId: string,
  limit: number = 50
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("chat_history")
    .select("role, content, image_url, timestamp")
    .eq("session_id", sessionId)
    .order("timestamp", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return data || [];
}
```

---

## 7. src/lib/search-service.ts
> 网页搜索服务

```typescript
import { SearchClient, Config } from "coze-coding-dev-sdk";

export async function searchWeb(query: string): Promise<string> {
  const config = new Config();
  const client = new SearchClient(config);

  try {
    const response = await client.search(query);
    return response.content || "搜索结果为空";
  } catch (error) {
    console.error("Search error:", error);
    return "搜索暂时不可用，请稍后再试";
  }
}
```

---

## 8. src/storage/database/supabase-client.ts
> **⭐ 关键文件：Supabase 客户端配置**
>
> 【修复点】必须优先使用 `COZE_SUPABASE_SERVICE_ROLE_KEY`，否则 RLS 会静默拒绝 INSERT

```typescript
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Client as CozeClient } from "coze_workload_identity";

let _supabaseInstance: SupabaseClient | null = null;

// ============================================================
// 获取 Supabase URL
// 优先级：环境变量 > Coze workload identity
// ============================================================
function getSupabaseUrl(): string {
  if (process.env.COZE_SUPABASE_URL) {
    return process.env.COZE_SUPABASE_URL;
  }
  try {
    const client = new CozeClient();
    const envVars = client.get_project_env_vars();
    client.close();
    for (const envVar of envVars) {
      if (envVar.key === "COZE_SUPABASE_URL") {
        return envVar.value;
      }
    }
  } catch (error) {
    console.error(
      "Failed to get SUPABASE_URL from coze_workload_identity:",
      error
    );
  }
  throw new Error(
    "COZE_SUPABASE_URL not found in environment variables or coze_workload_identity"
  );
}

// ============================================================
// 获取 Supabase ANON KEY（公开访问用，受 RLS 限制）
// ============================================================
function getSupabaseAnonKey(): string {
  if (process.env.COZE_SUPABASE_ANON_KEY) {
    return process.env.COZE_SUPABASE_ANON_KEY;
  }
  try {
    const client = new CozeClient();
    const envVars = client.get_project_env_vars();
    client.close();
    for (const envVar of envVars) {
      if (envVar.key === "COZE_SUPABASE_ANON_KEY") {
        return envVar.value;
      }
    }
  } catch (error) {
    console.error(
      "Failed to get SUPABASE_ANON_KEY from coze_workload_identity:",
      error
    );
  }
  throw new Error(
    "COZE_SUPABASE_ANON_KEY not found in environment variables or coze_workload_identity"
  );
}

// ============================================================
// 获取 Supabase SERVICE ROLE KEY（服务器内部用，绕过 RLS）⭐
// ============================================================
function getSupabaseServiceRoleKey(): string | null {
  if (process.env.COZE_SUPABASE_SERVICE_ROLE_KEY) {
    return process.env.COZE_SUPABASE_SERVICE_ROLE_KEY;
  }
  try {
    const client = new CozeClient();
    const envVars = client.get_project_env_vars();
    client.close();
    for (const envVar of envVars) {
      if (envVar.key === "COZE_SUPABASE_SERVICE_ROLE_KEY") {
        return envVar.value;
      }
    }
  } catch {
    // Service role key is optional - but highly recommended!
  }
  return null;
}

// ============================================================
// 【修复】获取 Supabase 客户端（单例模式，优先使用 SERVICE_ROLE_KEY ⭐）
// ============================================================
export function getSupabaseClient(): SupabaseClient {
  if (_supabaseInstance) {
    return _supabaseInstance;
  }

  const url = getSupabaseUrl();
  const serviceRoleKey = getSupabaseServiceRoleKey();

  // ⭐ 关键修复：优先使用 SERVICE_ROLE_KEY 绕过 RLS
  if (serviceRoleKey) {
    console.log("[DB] Using SERVICE_ROLE_KEY (bypasses RLS)");
    _supabaseInstance = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } else {
    // ⚠️ fallback：如果没配置 service_role key，使用 anon key（受 RLS 限制）
    console.warn(
      "[DB] SERVICE_ROLE_KEY not configured, falling back to ANON_KEY (may be blocked by RLS!)"
    );
    const anonKey = getSupabaseAnonKey();
    _supabaseInstance = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  return _supabaseInstance;
}
```

---

## 9. 数据库表结构（Supabase SQL）

> 在 Supabase Dashboard → SQL Editor 执行以下脚本创建表

```sql
-- ========================================================
-- chat_history - 聊天记录表
-- ========================================================
CREATE TABLE IF NOT EXISTS chat_history (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  role VARCHAR(10) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  image_url TEXT,
  session_id VARCHAR(64) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_history_session_id
  ON chat_history(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_history_timestamp
  ON chat_history(timestamp);

-- 开启 RLS（可选，如果用 service_role key 则自动绕过）
ALTER TABLE chat_history ENABLE ROW LEVEL SECURITY;


-- ========================================================
-- daily_food_log - 每日饮食记录表
-- ========================================================
CREATE TABLE IF NOT EXISTS daily_food_log (
  id BIGSERIAL PRIMARY KEY,
  date VARCHAR(10) NOT NULL,
  meal_type VARCHAR(20) NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
  food_items JSONB NOT NULL,
  calories INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_food_log_date
  ON daily_food_log(date);

ALTER TABLE daily_food_log ENABLE ROW LEVEL SECURITY;


-- ========================================================
-- meal_history - 餐食推荐历史表
-- ========================================================
CREATE TABLE IF NOT EXISTS meal_history (
  id BIGSERIAL PRIMARY KEY,
  date VARCHAR(10) NOT NULL,
  recommendation TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meal_history_date
  ON meal_history(date);

ALTER TABLE meal_history ENABLE ROW LEVEL SECURITY;


-- ========================================================
-- user_profile - 用户画像表（key-value）
-- ========================================================
CREATE TABLE IF NOT EXISTS user_profile (
  id BIGSERIAL PRIMARY KEY,
  key VARCHAR(100) UNIQUE NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_profile ENABLE ROW LEVEL SECURITY;
```

---

## 10. 环境变量配置（Coze）

在扣子（Coze）平台配置以下环境变量：

| 变量名 | 说明 | 必填 |
|--------|------|------|
| `COZE_SUPABASE_URL` | Supabase 项目 URL，形如 `https://xxx.supabase.co` | ✅ 是 |
| `COZE_SUPABASE_ANON_KEY` | Supabase anon key（公开用） | ✅ 是 |
| `COZE_SUPABASE_SERVICE_ROLE_KEY` | **⭐ Supabase service_role key（写入必须）** | ⭐ 强烈建议 |

**service_role key 的获取方式**：
1. 登录 Supabase Dashboard → 你的项目 → Settings → API
2. 找到 "service_role" + "Project API Keys" 部分
3. 复制以 `ey...` 开头的长字符串
4. 在 Coze 平台的环境变量中设置 `COZE_SUPABASE_SERVICE_ROLE_KEY`

---

## 11. API 接口速查

| 接口 | 方法 | 请求体 | 说明 |
|------|------|--------|------|
| `/api/chat` | POST | `{ message, image_url?, session_id }` | 智能对话（自动保存消息） |
| `/api/messages/save` | POST | `{ role, content, session_id, image_url? }` | 手动保存单条消息 |
| `/api/messages/history` | GET | `?session_id=xxx&limit=50` | 查询历史消息 |
| `/api/food-logs` | GET | `?date=YYYY-MM-DD` | 查询饮食记录（含热量统计） |

---

## 12. 调试建议

### 排查"消息不写入数据库"
```
1. 打开 Supabase Dashboard → Table Editor → chat_history
   → 刷新发送消息后，看表中是否出现新行

2. 打开 Supabase Dashboard → Logs Explorer → Postgres logs
   → 搜索 "INSERT" 或 "RLS"，看是否有拒绝信息

3. 如果 id 有 gap 但看不到新行 → 确认已配置 COZE_SUPABASE_SERVICE_ROLE_KEY
   → 或在 SQL Editor 执行：
     ALTER TABLE chat_history DISABLE ROW LEVEL SECURITY;
     ALTER TABLE daily_food_log DISABLE ROW LEVEL SECURITY;

4. 浏览器 Console 中观察：
   [DEBUG-DB insertChatMessage success: id=xxx role=user]
   如果看到 error 日志，说明写入失败
```

### 排查"查询历史消息为空"
```
1. 确认前端传的 session_id 和数据库中的一致
   → 浏览器 Console 检查 "session_id: sess_xxx"
   → 数据库中 SELECT * FROM chat_history WHERE session_id = 'sess_xxx';

2. 如果数据库有数据但前端查不到 → 可能是 Supabase RLS 拒绝了 SELECT
   → 同样需要 service_role key，或者禁用 RLS
```

import { ENV } from "./env";

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type FileContent = {
  type: "file_url";
  file_url: {
    url: string;
    mime_type?: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4" ;
  };
};

export type MessageContent = string | TextContent | ImageContent | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = {
  type: "function";
  function: {
    name: string;
  };
};

export type ToolChoice =
  | ToolChoicePrimitive
  | ToolChoiceByName
  | ToolChoiceExplicit;

export type InvokeParams = {
  messages: Message[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string | Array<TextContent | ImageContent | FileContent>;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

type EmbeddingItem = {
  embedding: number[];
  index: number;
};

type EmbeddingResult = {
  data: EmbeddingItem[];
};

let embeddingsEndpointUnsupported = false;
let loggedProviderMode = false;

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type OutputSchema = JsonSchema;

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ensureArray = (
  value: MessageContent | MessageContent[]
): MessageContent[] => (Array.isArray(value) ? value : [value]);

const normalizeContentPart = (
  part: MessageContent
): TextContent | ImageContent | FileContent => {
  if (typeof part === "string") {
    return { type: "text", text: part };
  }

  if (part.type === "text") {
    return part;
  }

  if (part.type === "image_url") {
    return part;
  }

  if (part.type === "file_url") {
    return part;
  }

  throw new Error("Unsupported message content part");
};

const normalizeMessage = (message: Message) => {
  const { role, name, tool_call_id } = message;

  if (role === "tool" || role === "function") {
    const content = ensureArray(message.content)
      .map(part => (typeof part === "string" ? part : JSON.stringify(part)))
      .join("\n");

    return {
      role,
      name,
      tool_call_id,
      content,
    };
  }

  const contentParts = ensureArray(message.content).map(normalizeContentPart);

  // If there's only text content, collapse to a single string for compatibility
  if (contentParts.length === 1 && contentParts[0].type === "text") {
    return {
      role,
      name,
      content: contentParts[0].text,
    };
  }

  return {
    role,
    name,
    content: contentParts,
  };
};

const normalizeToolChoice = (
  toolChoice: ToolChoice | undefined,
  tools: Tool[] | undefined
): "none" | "auto" | ToolChoiceExplicit | undefined => {
  if (!toolChoice) return undefined;

  if (toolChoice === "none" || toolChoice === "auto") {
    return toolChoice;
  }

  if (toolChoice === "required") {
    if (!tools || tools.length === 0) {
      throw new Error(
        "tool_choice 'required' was provided but no tools were configured"
      );
    }

    if (tools.length > 1) {
      throw new Error(
        "tool_choice 'required' needs a single tool or specify the tool name explicitly"
      );
    }

    return {
      type: "function",
      function: { name: tools[0].function.name },
    };
  }

  if ("name" in toolChoice) {
    return {
      type: "function",
      function: { name: toolChoice.name },
    };
  }

  return toolChoice;
};

const shouldUseForgeProvider = () =>
  !ENV.forceOpenAIDirect &&
  Boolean((ENV.forgeApiUrl && ENV.forgeApiUrl.trim().length > 0) || (ENV.forgeApiKey && ENV.forgeApiKey.trim().length > 0));

const resolveApiUrl = () =>
  shouldUseForgeProvider() && ENV.forgeApiUrl && ENV.forgeApiUrl.trim().length > 0
    ? `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/chat/completions`
    : "https://api.openai.com/v1/chat/completions";

const resolveEmbeddingsApiUrl = () =>
  shouldUseForgeProvider() && ENV.forgeApiUrl && ENV.forgeApiUrl.trim().length > 0
    ? `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/embeddings`
    : "https://api.openai.com/v1/embeddings";

const resolveApiKey = () => {
  if (shouldUseForgeProvider() && ENV.forgeApiKey) return ENV.forgeApiKey;
  return ENV.openaiApiKey;
};

const assertApiKey = () => {
  if (!resolveApiKey()) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
};

const normalizeResponseFormat = ({
  responseFormat,
  response_format,
  outputSchema,
  output_schema,
}: {
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
}):
  | { type: "json_schema"; json_schema: JsonSchema }
  | { type: "text" }
  | { type: "json_object" }
  | undefined => {
  const explicitFormat = responseFormat || response_format;
  if (explicitFormat) {
    if (
      explicitFormat.type === "json_schema" &&
      !explicitFormat.json_schema?.schema
    ) {
      throw new Error(
        "responseFormat json_schema requires a defined schema object"
      );
    }
    return explicitFormat;
  }

  const schema = outputSchema || output_schema;
  if (!schema) return undefined;

  if (!schema.name || !schema.schema) {
    throw new Error("outputSchema requires both name and schema");
  }

  return {
    type: "json_schema",
    json_schema: {
      name: schema.name,
      schema: schema.schema,
      ...(typeof schema.strict === "boolean" ? { strict: schema.strict } : {}),
    },
  };
};

function looksLikeQuotaError(status: number, body: string) {
  if (status === 429 || status === 402) return true;
  const normalized = String(body || "").toLowerCase();
  return (
    status === 412 ||
    normalized.includes("usage exhausted") ||
    normalized.includes("insufficient_quota") ||
    normalized.includes("quota") ||
    normalized.includes("\"code\":9")
  );
}

// ─────────────────────────────────────────
// Phase 6 (LLM consolidation): FE no longer talks to OpenAI/Anthropic
// directly. All LLM calls go through BE endpoints under /api/wizard,
// /api/document-ai, /api/collaboration/ai which delegate to the RAG
// service. The helpers below remain as exports so the surviving legacy
// fallback files (protocolContext.ts, unifiedQuery.ts, the residual
// invokeLLM sites in documentAIRouter.ts) still compile, but they
// throw at call time so any code path that reaches them surfaces
// loudly rather than silently calling api.openai.com.
// ─────────────────────────────────────────

const _DEPRECATION_MESSAGE =
  "[FE LLM deprecated] invokeLLM() was called but the FE no longer holds an LLM key. " +
  "Route this prompt through a /api/* BE endpoint (wizard, document-ai, collaboration/ai). " +
  "See plan: Phase 6 of LLM consolidation.";

export async function invokeLLM(_params: InvokeParams): Promise<InvokeResult> {
  // Phase 6: original 120-line implementation removed; FE no longer calls
  // OpenAI directly. Use the BE endpoints under /api/wizard, /api/document-ai,
  // /api/collaboration/ai instead.
  throw new Error(_DEPRECATION_MESSAGE);
}

export async function invokeEmbeddings(_input: string[], _model = "text-embedding-3-small"): Promise<number[][]> {
  // Phase 6: original implementation removed. Embeddings are produced
  // by the RAG service during /api/trial-documents/upload ingestion.
  throw new Error(
    "[FE embeddings deprecated] invokeEmbeddings() was called but the FE no longer holds an OpenAI key. " +
      "Embeddings are produced by the RAG service during /api/trial-documents/upload ingestion."
  );
}

// ─── Shared enums ───────────────────────────────────────────────────────────

export type CompanyStatus = "prospect" | "customer";
export type UrgencyLevel = "hot" | "watch" | "stable" | "stale";
export type InteractionType = "meeting" | "email" | "call" | "demo" | "support_call";

export const URGENCY_RANK: Record<UrgencyLevel, number> = {
  hot: 1,
  watch: 2,
  stable: 3,
  stale: 4,
};

// ─── Application-level domain types (TRD §2.2) ───────────────────────────────

export interface Contact {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
}

export interface Interaction {
  id: number;
  contactName: string | null;
  contactId: string | null;
  date: string;
  type: InteractionType;
  notes: string;
  urgency: UrgencyLevel | null;
  createdAt: string;
}

export interface Company {
  id: string;
  name: string;
  industry: string | null;
  status: CompanyStatus;
  size: number | null;
  contacts: Contact[];
}

export interface CompanyScore {
  urgency: UrgencyLevel;
  urgencyRank: number;
  updatedAt: string;
}

// The combined shape served to the dashboard
export interface CompanyWithScore extends Company {
  score: CompanyScore;
  lastInteraction: Interaction | null;
  lastContactDate: string | null;
}

// Expanded card detail (lazy-loaded on expand).
// NOTE: TRD §2.2 only declared aiBrief + blocker, but insight_service's prompt
// (TRD §3.5) emits a third `next_action` section — adding it here since the
// UI needs it and the omission looks like an oversight, not a decision.
export interface CompanyDetail extends CompanyWithScore {
  interactions: Interaction[];
  aiBrief: string;
  blocker: string;
  nextAction: string;
}

// ─── API request / response types (TRD §5.2) ─────────────────────────────────

export interface PrioritiesResponse {
  companies: CompanyWithScore[];
  stats: {
    total: number;
    prospects: number;
    customers: number;
    needAttention: number; // count of 'hot' + 'watch'
  };
}

export interface CompaniesResponse {
  companies: (Company & { contacts: Contact[] })[];
}

export interface InsightSSEData {
  type: "token" | "section_start" | "done" | "error";
  content: string | null;
  section?: "brief" | "blocker" | "next_action";
}

export interface DraftSSEData {
  type: "token" | "done" | "error";
  content: string | null;
}

export interface CreateInteractionRequest {
  companyId: string;
  contactName: string | null;
  contactId: string | null;
  date: string; // ISO date "YYYY-MM-DD"
  type: InteractionType;
  notes: string;
  urgency: UrgencyLevel;
}

export interface InteractionCreatedResponse {
  success: true;
  interactionId: number;
}

export interface CreateCompanyRequest {
  name: string;
  industry: string | null;
  status: CompanyStatus;
  size: number | null;
}

export interface CompanyCreatedResponse {
  success: true;
  companyId: string;
  name: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  message: string;
  session_history: ChatMessage[];
}

export interface ChatSSEData {
  type: "token" | "tool_call" | "tool_result" | "done" | "error";
  content: string | null;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: unknown;
}

export interface ErrorResponse {
  error: string;
  code: "llm_timeout" | "db_error" | "invalid_input" | "agent_error" | "internal";
  detail?: string;
}

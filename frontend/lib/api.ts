import { mockCompanies, mockInteractionsByCompany } from "@/lib/mock-data";
import { URGENCY_RANK } from "@/types";
import type {
  ChatRequest,
  ChatSSEData,
  Company,
  CompaniesResponse,
  CompanyCreatedResponse,
  CompanyWithScore,
  CreateCompanyRequest,
  CreateInteractionRequest,
  DraftSSEData,
  ErrorResponse,
  Interaction,
  InsightSSEData,
  InteractionCreatedResponse,
  PrioritiesResponse,
  UrgencyLevel,
} from "@/types";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/**
 * Backend Stage 2–4 (dashboard/insight/CRUD endpoints) don't exist yet — only
 * POST /api/chat is live. This flag gates the dashboard-facing functions below
 * to an in-memory mock store built from real seed data (lib/mock-data.ts).
 * Flip to false (and delete the mock branches) once those endpoints ship —
 * every function's real-fetch implementation is already written alongside
 * its mock counterpart.
 */
const USE_MOCK_DASHBOARD_API = true;

// ─── Error class (TRD §5.4) ───────────────────────────────────────────────────

export class APIError extends Error {
  code: string;
  detail: string | undefined;
  constructor(body: ErrorResponse) {
    super(body.error);
    this.code = body.code;
    this.detail = body.detail;
  }
}

// ─── SSE stream reader (generic, TRD §5.4) ────────────────────────────────────

async function* readSSEStream<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const json = line.slice(6).trim();
        if (json && json !== "[DONE]") {
          yield JSON.parse(json) as T;
        }
      }
    }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── In-memory mock store ─────────────────────────────────────────────────────
// Mutable copies so createInteraction/createCompany visibly affect subsequent
// fetchPriorities()/fetchCompanies() calls within the session.

const mockCompanyStore: Company[] = mockCompanies.map((c) => ({ ...c, contacts: [...c.contacts] }));
const mockInteractionStore: Record<string, Interaction[]> = Object.fromEntries(
  Object.entries(mockInteractionsByCompany).map(([id, list]) => [id, [...list]]),
);
let mockInteractionIdCounter = 10_000;
let mockCompanyIdCounter = 100;

function buildPrioritiesFromStore(): PrioritiesResponse {
  const companies: CompanyWithScore[] = mockCompanyStore.map((company) => {
    const interactions = mockInteractionStore[company.id] ?? [];
    const lastInteraction = interactions[0] ?? null;
    const urgency: UrgencyLevel = lastInteraction?.urgency ?? "stale";
    return {
      ...company,
      score: {
        urgency,
        urgencyRank: URGENCY_RANK[urgency],
        updatedAt: lastInteraction?.createdAt ?? new Date().toISOString(),
      },
      lastInteraction,
      lastContactDate: lastInteraction?.date ?? null,
    };
  });
  companies.sort((a, b) => a.score.urgencyRank - b.score.urgencyRank);

  return {
    companies,
    stats: {
      total: companies.length,
      prospects: companies.filter((c) => c.status === "prospect").length,
      customers: companies.filter((c) => c.status === "customer").length,
      needAttention: companies.filter((c) => c.score.urgency === "hot" || c.score.urgency === "watch").length,
    },
  };
}

// ─── GET /api/priorities ──────────────────────────────────────────────────────

export async function fetchPriorities(): Promise<PrioritiesResponse> {
  if (USE_MOCK_DASHBOARD_API) {
    await sleep(300);
    return buildPrioritiesFromStore();
  }
  const res = await fetch(`${BASE_URL}/api/priorities`);
  if (!res.ok) throw new APIError(await res.json());
  return res.json();
}

// ─── GET /api/companies ───────────────────────────────────────────────────────

export async function fetchCompanies(): Promise<CompaniesResponse> {
  if (USE_MOCK_DASHBOARD_API) {
    await sleep(150);
    return { companies: mockCompanyStore };
  }
  const res = await fetch(`${BASE_URL}/api/companies`);
  if (!res.ok) throw new APIError(await res.json());
  return res.json();
}

// ─── POST /api/interactions ───────────────────────────────────────────────────

export async function createInteraction(
  payload: CreateInteractionRequest,
): Promise<InteractionCreatedResponse> {
  if (USE_MOCK_DASHBOARD_API) {
    await sleep(250);
    const interaction: Interaction = {
      id: mockInteractionIdCounter++,
      contactName: payload.contactName,
      contactId: payload.contactId,
      date: payload.date,
      type: payload.type,
      notes: payload.notes,
      urgency: payload.urgency,
      createdAt: new Date().toISOString(),
    };
    const existing = mockInteractionStore[payload.companyId] ?? [];
    mockInteractionStore[payload.companyId] = [interaction, ...existing];
    return { success: true, interactionId: interaction.id };
  }
  const res = await fetch(`${BASE_URL}/api/interactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new APIError(await res.json());
  return res.json();
}

// ─── POST /api/companies ──────────────────────────────────────────────────────

export async function createCompany(payload: CreateCompanyRequest): Promise<CompanyCreatedResponse> {
  if (USE_MOCK_DASHBOARD_API) {
    await sleep(250);
    const id = `C${String(mockCompanyIdCounter++).padStart(3, "0")}`;
    mockCompanyStore.push({
      id,
      name: payload.name,
      industry: payload.industry,
      status: payload.status,
      size: payload.size,
      contacts: [],
    });
    mockInteractionStore[id] = [];
    return { success: true, companyId: id, name: payload.name };
  }
  const res = await fetch(`${BASE_URL}/api/companies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new APIError(await res.json());
  return res.json();
}

// ─── GET /api/company/:id/insight (SSE) ───────────────────────────────────────

function daysSince(dateStr: string): number {
  const diffMs = Date.now() - new Date(`${dateStr}T00:00:00Z`).getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function buildMockInsightSections(company: CompanyWithScore): { brief: string; blocker: string; nextAction: string } {
  const last = company.lastInteraction;
  if (!last) {
    return {
      brief: `${company.name} was added as a ${company.status} but has no logged interactions yet. There's no history to summarise.`,
      blocker: "No outreach has happened yet.",
      nextAction: "Schedule an initial discovery call to open the relationship.",
    };
  }
  const who = last.contactName ?? "your contact";
  const days = daysSince(last.date);
  return {
    brief: `${company.name} last had a ${last.type} with ${who} on ${last.date} (${days} days ago). At the time, the interaction was marked ${last.urgency ?? "unspecified"}: "${last.notes}"`,
    blocker:
      company.score.urgency === "hot"
        ? `A time-sensitive item with ${who} hasn't been followed up on since ${last.date}.`
        : company.score.urgency === "watch"
          ? `An open question or slow response from ${who} is stalling progress.`
          : company.score.urgency === "stale"
            ? `No meaningful contact in ${days} days — the relationship is going cold.`
            : "No blocker — there's a clear next step with a known timeline.",
    nextAction: `Reach out to ${who} referencing the ${last.date} ${last.type} — pick up where that conversation left off.`,
  };
}

async function* streamMockSections(
  sections: { key: "brief" | "blocker" | "next_action"; text: string }[],
): AsyncGenerator<InsightSSEData> {
  for (const { key, text } of sections) {
    yield { type: "section_start", content: null, section: key === "next_action" ? "next_action" : key };
    for (const word of text.split(" ")) {
      await sleep(15);
      yield { type: "token", content: word + " " };
    }
  }
  yield { type: "done", content: null };
}

export async function* streamInsight(companyId: string): AsyncGenerator<InsightSSEData> {
  if (USE_MOCK_DASHBOARD_API) {
    const { companies } = buildPrioritiesFromStore();
    const company = companies.find((c) => c.id === companyId);
    if (!company) {
      yield { type: "error", content: "Company not found" };
      return;
    }
    const { brief, blocker, nextAction } = buildMockInsightSections(company);
    yield* streamMockSections([
      { key: "brief", text: brief },
      { key: "blocker", text: blocker },
      { key: "next_action", text: nextAction },
    ]);
    return;
  }
  const res = await fetch(`${BASE_URL}/api/company/${companyId}/insight`);
  yield* readSSEStream<InsightSSEData>(res.body!);
}

// ─── GET /api/company/:id/draft (SSE) ─────────────────────────────────────────

function buildMockDraft(company: CompanyWithScore): string {
  const last = company.lastInteraction;
  const who = last?.contactName ?? "there";
  const subject = `Subject: Following up — ${company.name}`;
  const body = last
    ? `Hi ${who},\n\nWanted to follow up on our ${last.type} on ${last.date}. ${last.notes}\n\nLet me know if now's a good time to pick things back up — happy to work around your schedule.\n\nBest,\nYou`
    : `Hi ${who},\n\nI wanted to reach out and introduce myself — I think there's a good fit between ${company.name} and what we offer. Would you be open to a short call this week?\n\nBest,\nYou`;
  return `${subject}\n\n${body}`;
}

export async function* streamDraft(companyId: string): AsyncGenerator<DraftSSEData> {
  if (USE_MOCK_DASHBOARD_API) {
    const { companies } = buildPrioritiesFromStore();
    const company = companies.find((c) => c.id === companyId);
    if (!company) {
      yield { type: "error", content: "Company not found" };
      return;
    }
    const draft = buildMockDraft(company);
    for (const word of draft.split(" ")) {
      await sleep(12);
      yield { type: "token", content: word + " " };
    }
    yield { type: "done", content: null };
    return;
  }
  const res = await fetch(`${BASE_URL}/api/company/${companyId}/draft`);
  yield* readSSEStream<DraftSSEData>(res.body!);
}

// ─── POST /api/chat (SSE) — real backend, wired today ─────────────────────────

export async function* streamChat(payload: ChatRequest): AsyncGenerator<ChatSSEData> {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok || !res.body) {
    yield { type: "error", content: `Chat request failed (${res.status})` };
    return;
  }
  yield* readSSEStream<ChatSSEData>(res.body);
}

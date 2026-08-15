"""LangGraph pipeline chat agent.

Uses langchain.agents.create_agent (the current, non-deprecated prebuilt
ReAct agent — create_react_agent from langgraph.prebuilt still works but is
deprecated as of langgraph 1.x). The LLM sequences tool calls itself; there
is no hand-written intent classifier or retry loop. SQL errors come back to
the model as tool-result strings (see tools.py) and it corrects itself on
the next turn, bounded by AGENT_RECURSION_LIMIT.
"""

import logging
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from functools import lru_cache

from langchain_core.messages import (
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    HumanMessage,
    SystemMessage,
)
from langchain_openai import ChatOpenAI
from langgraph.errors import GraphRecursionError

from config.settings import settings
from schemas.api import ChatMessage
from services.ai.tools import ALL_TOOLS

logger = logging.getLogger(__name__)

AGENT_SYSTEM_PROMPT = """
You are a pipeline intelligence agent for a small business CRM.

Your job is to:
1. Answer questions about the user's customer and prospect relationships — accurately, grounded in real data.
2. Log new interactions when the user describes what happened ("just spoke with Tom...").
3. Add new companies and contacts when the user asks.

RULES:
- Call get_db_schema once before your first query_database call in a conversation.
- You ONLY call query_database with SELECT statements. Never attempt to modify or delete data via that tool.
- For writes, use ONLY insert_interaction, insert_company, or insert_contact.
- If you are unsure of a company_id, query the companies table first (use ILIKE for fuzzy name matching — company and contact names in user messages rarely match the DB exactly).
- Company names in the database are often written as a single word with no
  spaces (e.g. "UrbanFleet", "PixelCraft Studio" is two words but
  "BrightPath Consulting" style varies) — so if an ILIKE search on the
  full name as the user typed it returns zero rows, retry using just the
  most distinctive single word from the name before concluding it doesn't
  exist. Example: "urban fleet" -> no rows -> retry with '%urban%'.
- If a date is not explicitly stated for a new interaction, use today ({today}).
- After inserting an interaction, tell the user: "Logged." plus a short summary of what changed.
- Only tell the user a query returned no results after you've tried at least
  one broader retry per the rule above. Do NOT hallucinate data.
- Scope your SQL query to the minimum needed. If the user asks about one company, filter by company_id.

Today's date: {today}
""".strip()


def _build_llm() -> ChatOpenAI:
    return ChatOpenAI(
        model=settings.llm_model,
        api_key=settings.openrouter_api_key,
        base_url=settings.openrouter_base_url,
        temperature=settings.llm_temperature,
        timeout=settings.llm_timeout_agent_seconds,
        max_retries=2,
        default_headers={
            "HTTP-Referer": "http://localhost:3000",
            "X-Title": "Micro CRM",
        },
    )


@lru_cache(maxsize=1)
def get_agent():
    from langchain.agents import create_agent

    return create_agent(_build_llm(), ALL_TOOLS, system_prompt=None, name="pipeline_agent")


def _history_to_messages(history: list[ChatMessage]) -> list[BaseMessage]:
    truncated = history[-(settings.agent_max_history_turns * 2) :]
    messages: list[BaseMessage] = []
    for msg in truncated:
        if msg.role == "user":
            messages.append(HumanMessage(content=msg.content))
        else:
            messages.append(AIMessage(content=msg.content))
    return messages


async def run_agent(message: str, session_history: list[ChatMessage]) -> AsyncIterator[dict]:
    """Yields SSE envelope dicts: {type, content, ...}. Caller does SSE framing."""
    agent = get_agent()
    system_prompt = AGENT_SYSTEM_PROMPT.format(today=datetime.now(UTC).date().isoformat())

    messages: list[BaseMessage] = [
        SystemMessage(content=system_prompt),
        *_history_to_messages(session_history),
        HumanMessage(content=message),
    ]

    config = {"recursion_limit": settings.agent_recursion_limit}

    try:
        async for mode, data in agent.astream(
            {"messages": messages}, config=config, stream_mode=["messages", "updates"]
        ):
            if mode == "messages":
                chunk, _meta = data
                if isinstance(chunk, AIMessageChunk) and chunk.text:
                    yield {"type": "token", "content": str(chunk.text)}

            elif mode == "updates":
                for node_name, node_update in data.items():
                    if node_name == "model":
                        for msg in node_update.get("messages", []):
                            for tc in getattr(msg, "tool_calls", None) or []:
                                yield {
                                    "type": "tool_call",
                                    "content": {"tool_name": tc["name"], "input": tc["args"]},
                                }
                    elif node_name == "tools":
                        for msg in node_update.get("messages", []):
                            yield {
                                "type": "tool_result",
                                "content": {"tool_name": msg.name, "result": msg.content},
                            }

    except GraphRecursionError:
        yield {"type": "error", "content": "I got stuck working that out — try rephrasing your question."}
    except Exception:
        logger.exception("agent stream failed")
        yield {"type": "error", "content": "Something went wrong — please try again."}
    finally:
        yield {"type": "done", "content": None}

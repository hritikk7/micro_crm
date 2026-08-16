from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Database
    database_url: str
    db_echo: bool = False
    db_pool_size: int = 5

    # LLM / OpenRouter
    openrouter_api_key: str
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    llm_model: str = "google/gemini-flash-1.5"
    llm_temperature: float = 0.0
    llm_timeout_agent_seconds: int = 60
    llm_timeout_insight_seconds: int = 25

    # Agent behaviour
    agent_recursion_limit: int = 12
    agent_max_history_turns: int = 10
    query_row_limit: int = 200

    # App
    cors_origins: list[str] = ["http://localhost:3000"]
    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

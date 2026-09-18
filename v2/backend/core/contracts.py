from typing import Literal
from pydantic import BaseModel, Field


class ChatInput(BaseModel):
    content: str = Field(min_length=1, max_length=40_000)
    model: str | None = None
    enabled_tools: list[str] = Field(default_factory=list)


class ToolArguments(BaseModel):
    resource_id: int
    query: str | None = Field(default=None, max_length=8_000)


class ToolDecision(BaseModel):
    type: Literal["assistant", "tool_call"]
    response: str = ""
    tool: str | None = None
    arguments: dict = Field(default_factory=dict)

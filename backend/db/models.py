"""SQLAlchemy 2.0 declarative models.

Source of truth for table shape is db/schema.sql — these models must be
kept in sync with it manually (no migrations / no Base.metadata.create_all
in this slice).

Async-safety rules followed here:
  - lazy="selectin" on relationships we actually read (eager, one extra
    query, safe under async).
  - lazy="raise" on relationships we don't read by default — the SQLAlchemy
    default (lazy="select") triggers an implicit lazy-load on attribute
    access, which raises MissingGreenlet under asyncio if it fires outside
    an active session context (e.g. mid-SSE-stream after the session that
    loaded the row has been closed).
"""

from datetime import date as date_
from datetime import datetime

from sqlalchemy import (
    TIMESTAMP,
    BigInteger,
    CheckConstraint,
    Date,
    ForeignKey,
    Integer,
    Text,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Company(Base):
    __tablename__ = "companies"
    __table_args__ = (
        CheckConstraint("status IN ('prospect', 'customer')", name="companies_status_check"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    industry: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    size: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )

    contacts: Mapped[list["Contact"]] = relationship(
        back_populates="company", cascade="all, delete-orphan", lazy="selectin"
    )
    interactions: Mapped[list["Interaction"]] = relationship(
        back_populates="company",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="Interaction.date.desc()",
    )
    score: Mapped["CompanyScore | None"] = relationship(
        back_populates="company", uselist=False, lazy="selectin"
    )


class Contact(Base):
    __tablename__ = "contacts"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str | None] = mapped_column(Text)
    email: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )

    company: Mapped["Company"] = relationship(back_populates="contacts", lazy="raise")


class Interaction(Base):
    __tablename__ = "interactions"
    __table_args__ = (
        CheckConstraint(
            "type IN ('meeting', 'email', 'call', 'demo', 'support_call')",
            name="interactions_type_check",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id"), nullable=False)
    contact_name: Mapped[str | None] = mapped_column(Text)
    contact_id: Mapped[str | None] = mapped_column(ForeignKey("contacts.id"))
    date: Mapped[date_] = mapped_column(Date, nullable=False)
    type: Mapped[str] = mapped_column(Text, nullable=False)
    notes: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )

    company: Mapped["Company"] = relationship(back_populates="interactions", lazy="raise")


class CompanyScore(Base):
    __tablename__ = "company_scores"
    __table_args__ = (
        CheckConstraint(
            "urgency IN ('hot', 'watch', 'stable', 'stale')", name="company_scores_urgency_check"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    company_id: Mapped[str] = mapped_column(
        ForeignKey("companies.id"), unique=True, nullable=False
    )
    urgency: Mapped[str] = mapped_column(Text, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    recommended_action: Mapped[str] = mapped_column(Text, nullable=False)
    ai_brief: Mapped[str | None] = mapped_column(Text)
    blocker: Mapped[str | None] = mapped_column(Text)
    priority_rank: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    scored_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )
    insight_scored_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    invalidated_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    interaction_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    company: Mapped["Company"] = relationship(back_populates="score", lazy="raise")

from sqlalchemy import Column, Index, String, Text
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


class Document(Base):
    __tablename__ = "documents"

    id = Column(String, primary_key=True)          # S3 key relative to prefix
    vault_id = Column(String, nullable=False)
    s3_key = Column(String, nullable=False)
    title = Column(String, nullable=False, default="")
    path = Column(String, nullable=False, default="")
    source_type = Column(String, nullable=False, default="authored")
    updated = Column(String, nullable=False, default="")
    author = Column(String, nullable=False, default="")
    tags = Column(String, nullable=False, default="")   # JSON array stored as text
    checksum = Column(String, nullable=False, default="")
    body_text = Column(Text, nullable=False, default="")  # plain text for FTS


# FTS index created in migration (tsvector generated column + GIN index)
Index("ix_documents_vault_id", Document.vault_id)

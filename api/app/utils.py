import hashlib


def compute_checksum(raw: str) -> str:
    """Return a short sha256 checksum string for a document's raw content."""
    return "sha256:" + hashlib.sha256(raw.encode()).hexdigest()[:12]

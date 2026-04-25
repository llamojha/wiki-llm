from fastapi import APIRouter, HTTPException

from app import tree as tree_mod
from app.config import get_settings
from app.models import TreeNode, VaultSummary

router = APIRouter(prefix="/vaults", tags=["vaults"])


def _vault() -> VaultSummary:
    cfg = get_settings()
    return VaultSummary(
        id=cfg.vault_id,
        name=cfg.vault_id,
        bucket=cfg.vault_bucket,
        prefix=cfg.vault_prefix,
        region=cfg.vault_region,
    )


@router.get("", response_model=list[VaultSummary])
def list_vaults() -> list[VaultSummary]:
    return [_vault()]


@router.get("/{vault_id}/tree", response_model=list[TreeNode])
def get_tree(vault_id: str) -> list[TreeNode]:
    if vault_id != get_settings().vault_id:
        raise HTTPException(status_code=404, detail="Vault not found")
    return tree_mod.get_tree()

"""東京新電機様の Zoho CRM 専用クライアント。使い方は `python -m tsd_crm --help`。"""

from .client import CRMClient, GuardError, ZohoAPIError

__all__ = ["CRMClient", "GuardError", "ZohoAPIError"]

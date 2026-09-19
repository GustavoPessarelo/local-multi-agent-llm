from __future__ import annotations

import csv
from hmac import compare_digest

from django.conf import settings
from django.http import JsonResponse


def read_users() -> dict[str, str]:
    path = settings.AUTH_CSV_PATH
    if not path.is_file():
        return {}
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        return {
            str(row.get("usuario", "")).strip(): str(row.get("senha", ""))
            for row in csv.DictReader(source)
            if str(row.get("usuario", "")).strip()
        }


def valid_credentials(username: str, password: str) -> bool:
    stored = read_users().get(username)
    return stored is not None and compare_digest(stored, password)


class CsvSessionAuthMiddleware:
    PUBLIC_PATHS = {"/api/health", "/api/auth/login", "/api/auth/session"}

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if (
            request.path.startswith("/api/")
            and request.path not in self.PUBLIC_PATHS
            and not settings.TESTING
            and not request.session.get("local_username")
        ):
            return JsonResponse({"error": "Autenticação necessária."}, status=401)
        return self.get_response(request)

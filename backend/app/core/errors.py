"""fixes94: API errors that the UI shows translated.

`api_error` is for messages that include values (names, ids, limits). It
sends `detail = {code, message, params}`: `code` is a row in the localization
table (category "error", see app/error_localization.py CODED_ERRORS), the
frontend shows t(code) with `{params}` filled in, and `message` is the
rendered English text for any other API client.

Fixed messages stay plain `HTTPException(status, "English text")` — the
frontend looks them up by `error_key(text)`.
"""
from fastapi import HTTPException


def api_error(status_code: int, code: str, message: str, **params: object) -> HTTPException:
    """`message` is the English template with `{name}` placeholders, the
    same template as CODED_ERRORS[code]."""
    values = {k: "" if v is None else str(v) for k, v in params.items()}
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message.format(**values), "params": values},
    )

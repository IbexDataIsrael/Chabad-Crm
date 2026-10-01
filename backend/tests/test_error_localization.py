"""fixes94: every API error a user can see is in the localization table.

Parses the backend source (not a regex): any HTTPException / api_error /
validator ValueError whose message isn't in app.error_localization fails
here, so a new message can't bypass the translations page.
"""
import ast
import pathlib

from app.error_localization import CODED_ERRORS, PLAIN_ERRORS, error_key
from app.seed import LOCALIZATION

APP = pathlib.Path(__file__).resolve().parents[1] / "app"
# The Instinct API answers an external machine client, not our UI.
EXCLUDED = ("routers/instinct/", "crm_manifest.py")
TABLE_KEYS = {row[1] for row in LOCALIZATION}
PLAIN_KEYS = {error_key(en) for en, _ in PLAIN_ERRORS}


def _calls():
    for path in sorted(APP.rglob("*.py")):
        rel = path.relative_to(APP).as_posix()
        if rel.startswith(EXCLUDED) or rel in EXCLUDED:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                name = node.func.id if isinstance(node.func, ast.Name) else (
                    node.func.attr if isinstance(node.func, ast.Attribute) else None
                )
                if name != "ValueError":  # validators handled below
                    yield rel, node, name
            if (
                isinstance(node, ast.Raise)
                and isinstance(node.exc, ast.Call)
                and getattr(node.exc.func, "id", None) == "ValueError"
                and rel in ("schemas.py", "routers/logs.py")
            ):
                yield rel, node.exc, "ValueError"


def _detail(node):
    for kw in node.keywords:
        if kw.arg == "detail":
            return kw.value
    return node.args[1] if len(node.args) > 1 else None


def test_every_plain_error_message_is_in_the_table():
    missing, dynamic = [], []
    for rel, node, name in _calls():
        if name == "HTTPException":
            d = _detail(node)
        elif name == "ValueError":
            d = node.args[0] if node.args else None
        else:
            continue
        where = f"{rel}:{node.lineno}"
        if isinstance(d, ast.Constant) and isinstance(d.value, str):
            if error_key(d.value) not in PLAIN_KEYS:
                missing.append(f"{where} {d.value!r}")
        elif isinstance(d, ast.JoinedStr):
            dynamic.append(f"{where} {ast.unparse(d)[:80]}")
    assert not missing, "add to app/error_localization.py PLAIN_ERRORS:\n" + "\n".join(missing)
    assert not dynamic, "use app.core.errors.api_error for messages with values:\n" + "\n".join(dynamic)


def test_every_api_error_code_matches_the_registry():
    problems = []
    for rel, node, name in _calls():
        if name != "api_error" or len(node.args) < 3:
            continue
        code, template = node.args[1], node.args[2]
        where = f"{rel}:{node.lineno}"
        if not (isinstance(code, ast.Constant) and code.value in CODED_ERRORS):
            problems.append(f"{where} unknown code {ast.unparse(code)}")
            continue
        if not (isinstance(template, ast.Constant) and template.value == CODED_ERRORS[code.value][0]):
            problems.append(f"{where} template differs from CODED_ERRORS[{code.value!r}]")
    assert not problems, "\n".join(problems)


def test_auth_error_codes_are_in_the_table():
    missing = []
    for rel, node, name in _calls():
        if name == "auth_error" and len(node.args) > 1:
            code = node.args[1]
            if isinstance(code, ast.Constant) and code.value not in TABLE_KEYS:
                missing.append(f"{rel}:{node.lineno} {code.value}")
    assert not missing, "\n".join(missing)


def test_error_rows_reach_the_seed_and_placeholders_match():
    for en, _ in PLAIN_ERRORS:
        assert error_key(en) in TABLE_KEYS
        assert error_key(en) != "error."  # a message must slug to something
    import re

    ph = re.compile(r"\{(\w+)\}")
    for code, (en, he) in CODED_ERRORS.items():
        assert code in TABLE_KEYS
        assert set(ph.findall(en)) == set(ph.findall(he)), code


def test_slug_examples():
    """Same examples as frontend/lib/errorText.test.ts — keeps both sides equal."""
    assert error_key("Email already registered") == "error.email_already_registered"
    assert error_key("An assigned task can't be available — return it to the pool instead") == (
        "error.an_assigned_task_can_t_be_available_return_it_to_the_pool_instead"
    )
    assert error_key("page_size must be 20, 50 or 100") == "error.page_size_must_be_20_50_or_100"

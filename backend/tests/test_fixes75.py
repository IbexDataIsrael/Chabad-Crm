"""fixes75: user-delete cleanup, logs, password resets, login messages,
errors-admin emails, welcome email on email edit."""
import pytest

from app import models
from tests.test_fixes74 import (  # noqa: F401 — fixtures re-used
    _activist_with_contact,
    _task,
    org_id,
    setup,
)


# --- §11: deleting a user cleans up its bindings ------------------------------
def test_delete_user_with_tasks_and_bindings(client, admin_headers, setup, db_session, org_id):
    user = _activist_with_contact(db_session, org_id, "del75")
    other = _activist_with_contact(db_session, org_id, "keep75")
    open_task = _task(client, admin_headers, setup, names=("1",), volunteer_user_id=user.id)
    done_task = _task(client, admin_headers, setup, names=("2",), volunteer_user_id=user.id)
    client.put(f"/api/tasks/{done_task['id']}", json={"status": "COMPLETED"}, headers=admin_headers)

    # Direct report-number + area bindings, for both activists.
    for u in (user, other):
        r = client.put(
            f"/api/users/{u.id}",
            json={"shliach": {"report_number_ids": [setup["rns"]["3"]], "area_ids": []}},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
    sh = (
        db_session.query(models.ContactShliach)
        .filter_by(user_id=user.id, is_display=True)
        .one()
    )
    contact_id = sh.contact_id
    # History rows pointing at the user.
    paper = models.TaskPaperEntry(
        organization_id=org_id, task_id=open_task["id"], performer_user_id=user.id,
        entered_by_user_id=user.id,
    )
    db_session.add(paper)
    db_session.commit()
    paper_id = paper.id

    user_id, other_id = user.id, other.id
    r = client.delete(f"/api/users/{user_id}", headers=admin_headers)
    assert r.status_code == 204, r.text
    db_session.expire_all()

    assert db_session.get(models.User, user_id) is None
    t_open = db_session.get(models.Task, open_task["id"])
    assert t_open.volunteer_user_id is None and t_open.status == "AVAILABLE"
    t_done = db_session.get(models.Task, done_task["id"])
    assert t_done.volunteer_user_id is None and t_done.status == "COMPLETED"

    current = (
        db_session.query(models.ContactShliach)
        .filter_by(contact_id=contact_id, is_display=True)
        .one()
    )
    assert current.user_id is None
    assert current.report_numbers == [] and current.areas == []
    # The retired version still shows what they had.
    retired = (
        db_session.query(models.ContactShliach)
        .filter_by(contact_id=contact_id, is_display=False)
        .all()
    )
    assert any(v.report_numbers for v in retired)

    # The binding feature itself still works for everyone else.
    other_sh = (
        db_session.query(models.ContactShliach)
        .filter_by(user_id=other_id, is_display=True)
        .one()
    )
    assert [r.report_number_id for r in other_sh.report_numbers] == [setup["rns"]["3"]]

    kept = db_session.get(models.TaskPaperEntry, paper_id)
    assert kept is not None
    assert kept.performer_user_id is None and kept.entered_by_user_id is None


# --- §10: login email changed from the contact form → welcome email ----------
def test_contact_form_email_edit_sends_welcome(client, admin_headers, monkeypatch):
    from tests.test_fixes14 import _mk_shliach

    sent = []
    monkeypatch.setattr(
        "app.routers.contacts.send_shliach_welcome",
        lambda *a, **kw: sent.append(kw.get("to")),
    )
    contact = _mk_shliach(client, admin_headers, "c75old@example.com").json()
    sent.clear()  # creation's own welcome

    # Unchanged email -> nothing sent.
    r = client.put(f"/api/contacts/{contact['id']}", json={"notes": "x"}, headers=admin_headers)
    assert r.status_code == 200, r.text
    assert sent == []

    r = client.put(
        f"/api/contacts/{contact['id']}", json={"email": "c75new@example.com"}, headers=admin_headers
    )
    assert r.status_code == 200, r.text
    assert sent == ["c75new@example.com"]

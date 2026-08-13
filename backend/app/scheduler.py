"""Background reminder scheduler for significant dates.

Periodically scans `significant_date_reminders` and emails due reminders. Birthdays
and yahrzeits recur yearly, so each reminder fires once per occurrence: we compute
the next occurrence of the date, subtract `offset_minutes`, apply `remind_at_time`,
and send when that moment has passed and we haven't already sent for this occurrence.

If APScheduler isn't installed, scheduling is a no-op (the app still runs).
"""
import datetime
import logging

from sqlalchemy.orm import Session

from app import models, picklist_utils
from app.config import settings
from app.core.email import send_email
from app.database import SessionLocal

logger = logging.getLogger("app.scheduler")


def _next_occurrence(date: datetime.datetime, now: datetime.datetime) -> datetime.date:
    """Next yearly recurrence (month/day) of `date` on or after `now`'s date."""
    today = now.date()
    try:
        candidate = date.replace(year=today.year).date()
    except ValueError:  # Feb 29 in a non-leap year
        candidate = datetime.date(today.year, date.month, 28)
    if candidate < today:
        try:
            candidate = date.replace(year=today.year + 1).date()
        except ValueError:
            candidate = datetime.date(today.year + 1, date.month, 28)
    return candidate


def _fire_at(
    reminder: models.SignificantDateReminder, occurrence: datetime.date
) -> datetime.datetime:
    t = reminder.remind_at_time or datetime.time(9, 0)
    base = datetime.datetime.combine(occurrence, t)
    return base - datetime.timedelta(minutes=reminder.offset_minutes or 0)


def _recipients(db: Session, sd: models.SignificantDate) -> list[str]:
    """Assigned user(s) and covering shliach(s) of the mekuravim on this date.

    fixes19: the shliach↔apartment bridge is gone — a shliach covers the
    mekurav when their covered areas include the area of the mekurav's
    apartment's building."""
    emails: set[str] = set()
    for link in sd.mekuravim:
        contact = link.mekurav.contact
        if contact.assigned_user and contact.assigned_user.email:
            emails.add(contact.assigned_user.email)
        apartment_id = link.mekurav.apartment_id
        if apartment_id is not None:
            rows = (
                db.query(models.User.email)
                .join(
                    models.ContactShliach,
                    models.ContactShliach.user_id == models.User.id,
                )
                .join(
                    models.ContactShliachArea,
                    models.ContactShliachArea.contact_shliach_id
                    == models.ContactShliach.id,
                )
                .join(
                    models.Building,
                    models.Building.area_id == models.ContactShliachArea.area_id,
                )
                .join(
                    models.Apartment,
                    models.Apartment.building_id == models.Building.id,
                )
                .filter(
                    models.Apartment.id == apartment_id,
                    models.User.email.isnot(None),
                    # fixes45: a retired shliach version's copied-forward
                    # area link must not resurrect a since-removed coverage
                    # assignment.
                    models.ContactShliach.is_display.is_(True),
                )
                .all()
            )
            emails.update(e[0] for e in rows if e[0])
    return sorted(emails)


def _body(db: Session, sd: models.SignificantDate) -> str:
    names = ", ".join(
        " ".join(filter(None, [m.mekurav.contact.last_name, m.mekurav.contact.name]))
        for m in sd.mekuravim
    )
    special_date_type = picklist_utils.get_values(
        db, sd.organization_id, "significant_dates", sd.id, ["significant_date.type"]
    )["significant_date.type"]
    title = sd.special_date_title or special_date_type or "תאריך חשוב"
    when = sd.special_date.strftime("%d/%m")
    hebrew = f" ({sd.hebrew_date})" if sd.hebrew_date else ""
    return (
        f"תזכורת: {title} עבור {names}\n"
        f"תאריך: {when}{hebrew}\n\n"
        "נשלח אוטומטית ממערכת ה-CRM."
    )


def scan_reminders() -> int:
    """Send any due reminders. Returns the number of emails dispatched."""
    now = datetime.datetime.now()
    sent = 0
    db = SessionLocal()
    try:
        reminders = (
            db.query(models.SignificantDateReminder)
            .filter(models.SignificantDateReminder.channel == "email")
            .all()
        )
        for reminder in reminders:
            sd = reminder.significant_date
            if sd is None or not sd.is_set_reminder:
                continue
            occurrence = _next_occurrence(sd.special_date, now)
            fire_at = _fire_at(reminder, occurrence)
            if now < fire_at:
                continue
            # Already sent for this occurrence?
            if reminder.last_sent_at and reminder.last_sent_at >= fire_at:
                continue
            recipients = _recipients(db, sd)
            if recipients:
                send_email(", ".join(recipients), "תזכורת — מיני CRM", _body(db, sd))
                sent += 1
            reminder.last_sent_at = now
        db.commit()
    except Exception:  # never let the scheduler thread die
        logger.exception("reminder scan failed")
        db.rollback()
    finally:
        db.close()
    return sent


_scheduler = None


def start_scheduler() -> None:
    """Start the periodic reminder scan, if APScheduler is available."""
    global _scheduler
    if _scheduler is not None:
        return
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
    except ImportError:
        logger.warning("APScheduler not installed — reminder scheduler disabled")
        return
    _scheduler = BackgroundScheduler(daemon=True)
    _scheduler.add_job(
        scan_reminders,
        "interval",
        seconds=settings.reminder_scan_interval_seconds,
        next_run_time=datetime.datetime.now() + datetime.timedelta(seconds=10),
    )
    _scheduler.start()
    logger.info("reminder scheduler started")


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None

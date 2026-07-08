"""One-time data patch (fixes10 §2.3): backfill contact ownership for one org.

Finds the organization's earliest admin user and sets
`contacts.assigned_user_id = <admin guid>` on ALL of the org's contacts (the
imported records predate automatic assignment). Dry-run by default.

Run inside the backend container:
    python -m scripts.patch_assign_org1 --org-id 1 [--commit]
"""
import argparse
import sys

from app import models
from app.database import SessionLocal


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--org-id", type=int, required=True)
    ap.add_argument("--commit", action="store_true", help="persist (default: dry-run)")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        org = db.get(models.Organization, args.org_id)
        if org is None:
            print(f"ERROR: organization {args.org_id} not found")
            return 1
        admin = (
            db.query(models.User)
            .filter(
                models.User.organization_id == org.id,
                models.User.role == "admin",
            )
            .order_by(models.User.created_at)
            .first()
        )
        if admin is None:
            print(f"ERROR: org {org.id} has no admin user to assign to")
            return 1

        total = (
            db.query(models.Contact)
            .filter(models.Contact.organization_id == org.id)
            .count()
        )
        updated = (
            db.query(models.Contact)
            .filter(
                models.Contact.organization_id == org.id,
                (models.Contact.assigned_user_id.is_(None))
                | (models.Contact.assigned_user_id != admin.guid),
            )
            .update(
                {models.Contact.assigned_user_id: admin.guid},
                synchronize_session=False,
            )
        )
        print(
            f"org {org.id} — {org.name} ({'COMMIT' if args.commit else 'DRY-RUN'}): "
            f"assigning admin '{admin.full_name}' <{admin.email or admin.username}> "
            f"(guid {admin.guid}) to {updated} of {total} contacts"
        )
        if args.commit:
            db.commit()
            print("COMMITTED.")
        else:
            db.rollback()
            print("Dry-run only — nothing was written. Re-run with --commit.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())

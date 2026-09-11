"""fixes61 §2 — users.is_manual

An activist tracked in the system with no login of their own: email is
optional for them and no welcome email is sent. Distinct from `is_active`,
which means "login currently enabled/disabled" for an account that does have
one.

Revision ID: a1f2b3c4d5e6
Revises: 9c1d2e3f4a5b
Create Date: 2026-09-11 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1f2b3c4d5e6'
down_revision: Union[str, Sequence[str], None] = '9c1d2e3f4a5b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'users',
        sa.Column(
            'is_manual',
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'is_manual')

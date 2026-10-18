import hashlib
import json
import os
import secrets
import shutil

from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

from fastapi import (
    FastAPI,
    Depends,
    File,
    Header,
    HTTPException,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from pydantic import BaseModel, Field

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
    func,
    inspect,
    text,
    or_,
)

from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    Session,
    mapped_column,
    relationship,
)


# ============================================================
# CONFIGURATION
# ============================================================

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg://envia:envia_dev_password@localhost:5432/envia",
)

UPLOAD_DIR = Path(
    os.getenv("UPLOAD_DIR", "/data/uploads")
)

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

FRONTEND_ORIGINS = os.getenv(
    "FRONTEND_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173",
).split(",")


# ============================================================
# DATABASE
# ============================================================

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
)


class Base(DeclarativeBase):
    pass


# ============================================================
# MODELS
# ============================================================

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )

    username: Mapped[str] = mapped_column(
        String(100),
        unique=True,
        index=True,
        nullable=False,
    )

    password_hash: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    display_name: Mapped[str] = mapped_column(
        String(150),
        nullable=False,
    )

    role: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        default="citizen",
    )

    active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    last_login_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        nullable=True,
    )

    events: Mapped[list["Event"]] = relationship(
        back_populates="creator",
    )

    activities: Mapped[list["ActivityLog"]] = relationship(
        back_populates="user",
    )


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )

    created_by_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey(
            "users.id",
            ondelete="SET NULL",
        ),
        nullable=True,
        index=True,
    )

    category: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    subcategory: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
    )

    description: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    latitude: Mapped[float] = mapped_column(
        Float,
        nullable=False,
    )

    longitude: Mapped[float] = mapped_column(
        Float,
        nullable=False,
    )

    priority: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        default="medium",
    )

    status: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        default="pending",
    )

    source: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="field",
    )

    reporter: Mapped[Optional[str]] = mapped_column(
        String(150),
        nullable=True,
    )

    region: Mapped[Optional[str]] = mapped_column(
        String(150),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    history_entries: Mapped[list["EventHistory"]] = relationship(
        back_populates="event", cascade="all, delete-orphan", order_by="EventHistory.at"
    )

    creator: Mapped[Optional["User"]] = relationship(
        back_populates="events",
    )

    media: Mapped[list["Media"]] = relationship(
        back_populates="event",
        cascade="all, delete-orphan",
    )


class Media(Base):
    __tablename__ = "media"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )

    event_id: Mapped[int] = mapped_column(
        ForeignKey(
            "events.id",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )

    filename: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    url: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
    )

    media_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )

    event: Mapped["Event"] = relationship(
        back_populates="media",
    )


class EventHistory(Base):
    __tablename__ = "event_history"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(30))
    at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    event: Mapped["Event"] = relationship(back_populates="history_entries")


class ClientOperation(Base):
    """Persistent idempotency receipts shared by Web and Mobile."""
    __tablename__ = "client_operations"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(64))
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    media_id: Mapped[Optional[int]] = mapped_column(ForeignKey("media.id", ondelete="CASCADE"), nullable=True)


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )

    event_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey(
            "events.id",
            ondelete="SET NULL",
        ),
        nullable=True,
    )

    title: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
    )

    message: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    severity: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        default="medium",
    )

    status: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        default="open",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )


class CollectionPoint(Base):
    __tablename__ = "collection_points"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )

    name: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
    )

    city: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
    )

    latitude: Mapped[float] = mapped_column(
        Float,
        nullable=False,
    )

    longitude: Mapped[float] = mapped_column(
        Float,
        nullable=False,
    )

    point_type: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="active",
    )

    info: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )


class SystemSetting(Base):
    __tablename__ = "system_settings"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    key: Mapped[str] = mapped_column(
        String(150),
        unique=True,
        index=True,
        nullable=False,
    )

    value: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    description: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )

    user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey(
            "users.id",
            ondelete="SET NULL",
        ),
        nullable=True,
        index=True,
    )

    action: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    target_type: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
    )

    target_id: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
    )

    description: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    user: Mapped[Optional["User"]] = relationship(
        back_populates="activities",
    )


# ============================================================
# DATABASE MIGRATION
# ============================================================

def ensure_database_schema():
    """
    Migration légère pour les anciennes installations ENVIA.

    IMPORTANT :
    cette fonction ne supprime aucune donnée.
    """

    inspector = inspect(engine)
    tables = inspector.get_table_names()

    # Les tables principales seront créées par create_all().
    # On ajoute uniquement les colonnes qui peuvent manquer
    # dans une ancienne version.
    if "users" in tables:
        user_columns = {
            column["name"]
            for column in inspector.get_columns("users")
        }

        with engine.begin() as conn:

            if "created_at" not in user_columns:
                conn.execute(
                    text(
                        """
                        ALTER TABLE users
                        ADD COLUMN created_at TIMESTAMP
                        """
                    )
                )

                conn.execute(
                    text(
                        """
                        UPDATE users
                        SET created_at = CURRENT_TIMESTAMP
                        WHERE created_at IS NULL
                        """
                    )
                )

            if "last_login_at" not in user_columns:
                conn.execute(
                    text(
                        """
                        ALTER TABLE users
                        ADD COLUMN last_login_at TIMESTAMP
                        """
                    )
                )

    inspector = inspect(engine)
    tables = inspector.get_table_names()

    if "events" in tables:

        event_columns = {
            column["name"]
            for column in inspector.get_columns("events")
        }

        if "created_by_id" not in event_columns:

            with engine.begin() as conn:
                conn.execute(
                    text(
                        """
                        ALTER TABLE events
                        ADD COLUMN created_by_id INTEGER
                        """
                    )
                )

                try:
                    conn.execute(
                        text(
                            """
                            ALTER TABLE events
                            ADD CONSTRAINT fk_events_created_by
                            FOREIGN KEY (created_by_id)
                            REFERENCES users(id)
                            ON DELETE SET NULL
                            """
                        )
                    )
                except Exception:
                    # La contrainte peut déjà exister dans certaines
                    # installations.
                    pass


# ============================================================
# CREATE TABLES + MIGRATIONS
# ============================================================


# ENVIA terrain: restricted nesting sites and image-assisted classification.
class TurtleNest(Base):
    __tablename__ = "turtle_nests"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_by_id: Mapped[int] = mapped_column(Integer, nullable=False)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    accuracy_m: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(30), default="unverified")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

Base.metadata.create_all(engine)

ensure_database_schema()

# Une seconde passe permet de créer les tables nouvellement ajoutées
# après les éventuelles migrations.
Base.metadata.create_all(engine)

# Compatibility with older Web clients and stored priority values.
with engine.begin() as conn:
    conn.execute(text("UPDATE events SET priority = 'medium' WHERE priority = 'normal'"))


# ============================================================
# CONSTANTES
# ============================================================

VALID_ROLES = {
    "citizen",
    "ecogarde",
    "expert",
    "admin",
}

VALID_STATUSES = {
    "pending",
    "to_validate",
    "validated",
    "rejected",
    "processed",
    "closed",
}

VALID_PRIORITIES = {
    "low",
    "medium",
    "high",
    "critical",
}

ALLOWED_TRANSITIONS = {
    "pending": {
        "to_validate",
        "rejected",
    },
    "to_validate": {
        "validated",
        "rejected",
    },
    "validated": {
        "processed",
        "rejected",
    },
    "processed": {
        "closed",
    },
    "rejected": {
        "to_validate",
    },
    "closed": set(),
}


DEFAULT_CATEGORIES = [
    {
        "id": "waste",
        "label": "Déchets",
        "icon": "♻",
    },
    {
        "id": "marine_pollution",
        "label": "Pollution marine",
        "icon": "🌊",
    },
    {
        "id": "water",
        "label": "Eau",
        "icon": "💧",
    },
    {
        "id": "marine_biodiversity",
        "label": "Biodiversité marine",
        "icon": "🐠",
    },
    {
        "id": "terrestrial_biodiversity",
        "label": "Biodiversité terrestre",
        "icon": "🌿",
    },
    {
        "id": "fire",
        "label": "Incendie",
        "icon": "🔥",
    },
    {
        "id": "climate",
        "label": "Climat",
        "icon": "☁",
    },
    {
        "id": "habitat",
        "label": "Habitat",
        "icon": "🏠",
    },
    {
        "id": "shark",
        "label": "Requin",
        "icon": "🦈",
    },
]


DEFAULT_SETTINGS = {
    "platform_name": "ENVIA Djibouti",
    "platform_description": (
        "Plateforme nationale de collecte et de suivi "
        "des observations environnementales."
    ),
    "country": "Djibouti",

    "validation_required": "true",

    "notifications_enabled": "true",

    "ai_enabled": "true",
    "ai_human_validation": "true",

    "map_provider": "OpenStreetMap",
    "map_center_lat": "11.572",
    "map_center_lng": "43.145",
    "map_zoom": "10",

    "session_duration_hours": "12",

    "allow_citizen_reports": "true",
    "allow_ecogarde_reports": "true",

    "categories": json.dumps(
        DEFAULT_CATEGORIES,
        ensure_ascii=False,
    ),

    "priority_options": json.dumps(
        [
            "low",
            "medium",
            "high",
            "critical",
        ]
    ),
}


# ============================================================
# PASSWORDS
# ============================================================

def legacy_hash_password(password: str) -> str:
    return hashlib.sha256(
        password.encode("utf-8")
    ).hexdigest()


def hash_password(password: str) -> str:
    """
    PBKDF2-HMAC-SHA256.
    Format:
        pbkdf2_sha256$iterations$salt$hash
    """

    iterations = 310_000

    salt = secrets.token_hex(16)

    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        iterations,
    )

    encoded = digest.hex()

    return (
        f"pbkdf2_sha256$"
        f"{iterations}$"
        f"{salt}$"
        f"{encoded}"
    )


def verify_password(
    password: str,
    stored_hash: str,
) -> tuple[bool, bool]:

    if stored_hash.startswith(
        "pbkdf2_sha256$"
    ):

        try:
            _, iterations, salt, expected = (
                stored_hash.split("$")
            )

            iterations = int(iterations)

            digest = hashlib.pbkdf2_hmac(
                "sha256",
                password.encode("utf-8"),
                salt.encode("utf-8"),
                iterations,
            )

            valid = secrets.compare_digest(
                digest.hex(),
                expected,
            )

            return valid, False

        except Exception:
            return False, False

    # Ancien format SHA-256.
    expected = legacy_hash_password(password)

    if secrets.compare_digest(
        expected,
        stored_hash,
    ):
        return True, True

    return False, False


# ============================================================
# SEED
# ============================================================

def seed_data():

    with Session(engine) as db:

        users = [
            (
                "admin",
                "admin123",
                "Administrateur ENVIA",
                "admin",
            ),
            (
                "expert",
                "expert123",
                "Expert environnement",
                "expert",
            ),
            (
                "ecogarde",
                "eco123",
                "Écogarde terrain",
                "ecogarde",
            ),
            (
                "citoyen",
                "citoyen123",
                "Citoyen ENVIA",
                "citizen",
            ),
        ]

        for username, password, display_name, role in users:

            existing = (
                db.query(User)
                .filter(
                    User.username == username
                )
                .first()
            )

            if not existing:

                db.add(
                    User(
                        username=username,
                        password_hash=hash_password(
                            password
                        ),
                        display_name=display_name,
                        role=role,
                        active=True,
                    )
                )

        db.commit()


def seed_system_settings():

    with Session(engine) as db:

        for key, value in DEFAULT_SETTINGS.items():

            existing = (
                db.query(SystemSetting)
                .filter(
                    SystemSetting.key == key
                )
                .first()
            )

            if not existing:

                description = None

                if key == "platform_name":
                    description = (
                        "Nom affiché de la plateforme."
                    )

                elif key == "validation_required":
                    description = (
                        "Active le processus de validation humaine."
                    )

                elif key == "ai_enabled":
                    description = (
                        "Active ou désactive les fonctions IA."
                    )

                elif key == "ai_human_validation":
                    description = (
                        "Impose une validation humaine "
                        "avant utilisation opérationnelle "
                        "des résultats IA."
                    )

                elif key == "session_duration_hours":
                    description = (
                        "Durée de validité des nouvelles sessions."
                    )

                db.add(
                    SystemSetting(
                        key=key,
                        value=value,
                        description=description,
                    )
                )

        db.commit()


def seed_collection_points():

    with Session(engine) as db:

        if db.query(CollectionPoint).count() > 0:
            return

        points = [
            CollectionPoint(
                name="Point ENVIA Djibouti",
                city="Djibouti",
                latitude=11.572,
                longitude=43.145,
                point_type="collecte",
                status="active",
                info="Point de collecte ENVIA.",
            ),
            CollectionPoint(
                name="Point Balbala",
                city="Balbala",
                latitude=11.588,
                longitude=43.127,
                point_type="collecte",
                status="active",
                info="Point terrain Balbala.",
            ),
        ]

        db.add_all(points)
        db.commit()


seed_data()
seed_system_settings()
seed_collection_points()


# ============================================================
# FASTAPI
# ============================================================

app = FastAPI(
    title="ENVIA Djibouti API",
    version="3.0.0",
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.mount(
    "/uploads",
    StaticFiles(directory=str(UPLOAD_DIR)),
    name="uploads",
)


# ============================================================
# SESSIONS
# ============================================================

SESSIONS: dict[str, dict] = {}


def get_setting(
    db: Session,
    key: str,
    default: str,
) -> str:

    setting = (
        db.query(SystemSetting)
        .filter(SystemSetting.key == key)
        .first()
    )

    if not setting:
        return default

    return setting.value


def get_session_duration_hours(
    db: Session,
) -> int:

    raw = get_setting(
        db,
        "session_duration_hours",
        "12",
    )

    try:
        value = int(raw)
        return max(1, min(value, 720))
    except Exception:
        return 12


# ============================================================
# PYDANTIC MODELS
# ============================================================

class LoginIn(BaseModel):
    username: str
    password: str


class EventCreate(BaseModel):
    category: str
    subcategory: Optional[str] = None
    description: str = Field(min_length=1, max_length=4000)
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    priority: str = "medium"
    source: str = "field"
    reporter: Optional[str] = None
    region: Optional[str] = None


class EventUpdate(BaseModel):
    category: Optional[str] = None
    subcategory: Optional[str] = None
    description: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    region: Optional[str] = None


class AIIn(BaseModel):
    description: str


class UserCreateIn(BaseModel):
    username: str = Field(
        min_length=3,
        max_length=100,
    )

    password: str = Field(
        min_length=6,
        max_length=200,
    )

    display_name: str = Field(
        min_length=2,
        max_length=150,
    )

    role: str = "citizen"

    active: bool = True


class UserUpdateIn(BaseModel):
    display_name: Optional[str] = Field(
        default=None,
        min_length=2,
        max_length=150,
    )

    role: Optional[str] = None

    active: Optional[bool] = None


class PasswordResetIn(BaseModel):
    password: str = Field(
        min_length=6,
        max_length=200,
    )


class SettingsUpdateIn(BaseModel):
    values: dict[str, str]


class AlertOut(BaseModel):
    id: int
    event_id: Optional[int]
    title: str
    message: str
    severity: str
    status: str
    created_at: datetime


# ============================================================
# AUTH HELPERS
# ============================================================

def extract_token(
    authorization: Optional[str],
) -> Optional[str]:

    if not authorization:
        return None

    if not authorization.lower().startswith(
        "bearer "
    ):
        return None

    return authorization[7:].strip()


def user_from_token(
    token: Optional[str],
    db: Session,
) -> Optional[User]:

    if not token:
        return None

    session_data = SESSIONS.get(token)

    if not session_data:
        return None

    expires_at = session_data.get(
        "expires_at"
    )

    if not expires_at:
        return None

    if datetime.now(timezone.utc) > expires_at:
        SESSIONS.pop(token, None)
        return None

    user_id = session_data.get("user_id")

    if not user_id:
        return None

    user = (
        db.query(User)
        .filter(User.id == user_id)
        .first()
    )

    if not user:
        SESSIONS.pop(token, None)
        return None

    if not user.active:
        SESSIONS.pop(token, None)
        return None

    return user


def require_user(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(
        lambda: Session(engine)
    ),
) -> User:

    token = extract_token(authorization)

    user = user_from_token(
        token,
        db,
    )

    if not user:
        raise HTTPException(
            status_code=401,
            detail="Authentification requise.",
        )

    return user


def require_roles(*roles):

    def dependency(
        user: User = Depends(require_user),
    ):

        if user.role not in roles:
            raise HTTPException(
                status_code=403,
                detail="Accès refusé.",
            )

        return user

    return dependency


def invalidate_user_sessions(
    user_id: int,
):

    tokens_to_remove = [
        token
        for token, session_data
        in SESSIONS.items()
        if session_data.get("user_id") == user_id
    ]

    for token in tokens_to_remove:
        SESSIONS.pop(token, None)


# ============================================================
# ACTIVITY
# ============================================================

def log_activity(
    db: Session,
    user: Optional[User],
    action: str,
    target_type: Optional[str] = None,
    target_id: Optional[int] = None,
    description: Optional[str] = None,
):

    db.add(
        ActivityLog(
            user_id=user.id if user else None,
            action=action,
            target_type=target_type,
            target_id=target_id,
            description=description,
        )
    )


# ============================================================
# EVENT ACCESS
# ============================================================

def is_field_user(
    user: User,
) -> bool:

    return user.role in {
        "citizen",
        "ecogarde",
    }


def can_access_event(
    user: User,
    event: Event,
) -> bool:

    if user.role in {
        "expert",
        "admin",
    }:
        return True

    return event.created_by_id == user.id


def get_event_or_404(
    db: Session,
    event_id: int,
) -> Event:

    event = (
        db.query(Event)
        .filter(Event.id == event_id)
        .first()
    )

    if not event:
        raise HTTPException(
            status_code=404,
            detail="Observation introuvable.",
        )

    return event


def ensure_event_access(
    user: User,
    event: Event,
):

    if not can_access_event(
        user,
        event,
    ):
        raise HTTPException(
            status_code=403,
            detail="Vous ne pouvez pas consulter cette observation.",
        )


# ============================================================
# SERIALIZERS
# ============================================================

def user_dict(
    user: User,
):

    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "role": user.role,
        "active": user.active,
        "created_at": user.created_at,
        "last_login_at": user.last_login_at,
    }


def operation_receipt(db: Session, user: User, scope: str, key: Optional[str], fingerprint: str):
    if not key:
        return None, None
    if len(key) > 180:
        raise HTTPException(status_code=400, detail="Clé de synchronisation invalide.")
    receipt_id = hashlib.sha256(f"{user.id}:{scope}:{key}".encode()).hexdigest()
    # Serialize concurrent retries across API processes in PostgreSQL.
    if engine.dialect.name == "postgresql":
        lock_id = int.from_bytes(bytes.fromhex(receipt_id[:16]), "big", signed=True)
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_id})
    receipt = db.get(ClientOperation, receipt_id)
    if receipt and receipt.fingerprint != fingerprint:
        raise HTTPException(status_code=409, detail="Cette clé correspond déjà à un autre envoi.")
    return receipt_id, receipt


def media_dict(media: Media):
    return {"id": media.id, "filename": media.filename, "url": media.url, "media_type": media.media_type}


def event_dict(
    event: Event,
):

    return {
        "id": event.id,
        "created_by_id": event.created_by_id,
        "history": [{"status": h.status, "at": h.at} for h in event.history_entries]
            or [{"status": "pending", "at": event.created_at}]
            + ([{"status": event.status, "at": event.updated_at}] if event.status != "pending" else []),
        "category": event.category,
        "subcategory": event.subcategory,
        "description": event.description,
        "latitude": event.latitude,
        "longitude": event.longitude,
        "priority": event.priority,
        "status": event.status,
        "source": event.source,
        "reporter": event.reporter,
        "region": event.region,
        "created_at": event.created_at,
        "updated_at": event.updated_at,
        "media": [
            {
                "id": media.id,
                "filename": media.filename,
                "url": media.url,
                "media_type": media.media_type,
            }
            for media in event.media
        ],
    }


# ============================================================
# HEALTH
# ============================================================

@app.get("/health")
def health():

    return {
        "status": "ok",
        "service": "ENVIA Djibouti API",
        "version": "3.0.0",
    }


# ============================================================
# AUTH
# ============================================================

@app.post("/api/v1/auth/login")
def login(
    payload: LoginIn,
):

    with Session(engine) as db:

        user = (
            db.query(User)
            .filter(
                func.lower(User.username)
                == payload.username.lower()
            )
            .first()
        )

        if not user:
            raise HTTPException(
                status_code=401,
                detail="Identifiants invalides.",
            )

        if not user.active:
            raise HTTPException(
                status_code=403,
                detail="Ce compte est désactivé.",
            )

        valid, legacy = verify_password(
            payload.password,
            user.password_hash,
        )

        if not valid:
            raise HTTPException(
                status_code=401,
                detail="Identifiants invalides.",
            )

        if legacy:
            user.password_hash = hash_password(
                payload.password
            )

        now = datetime.now(timezone.utc)

        user.last_login_at = now

        token = secrets.token_urlsafe(48)

        duration = get_session_duration_hours(
            db
        )

        expires_at = now + timedelta(
            hours=duration
        )

        SESSIONS[token] = {
            "user_id": user.id,
            "expires_at": expires_at,
        }

        log_activity(
            db,
            user,
            "login",
            "user",
            user.id,
            "Connexion utilisateur.",
        )

        db.commit()

        return {
            "token": token,
            "expires_at": expires_at,
            "user": user_dict(user),
        }


@app.post("/api/v1/auth/logout")
def logout(authorization: Optional[str] = Header(default=None)):
    token = extract_token(authorization)
    if token:
        SESSIONS.pop(token, None)
    return {"ok": True}


@app.get("/api/v1/auth/me")
def auth_me(
    user: User = Depends(require_user),
):

    return user_dict(user)


# ============================================================
# CATEGORIES
# ============================================================

@app.get("/api/v1/categories")
def categories(
    user: User = Depends(require_user),
):

    with Session(engine) as db:

        raw = get_setting(
            db,
            "categories",
            json.dumps(DEFAULT_CATEGORIES),
        )

        try:
            return json.loads(raw)
        except Exception:
            return DEFAULT_CATEGORIES


# ============================================================
# EVENTS - LIST
# ============================================================

@app.get("/api/v1/events")
def list_events(
    user: User = Depends(require_user),
):

    with Session(engine) as db:

        query = db.query(Event)

        if user.role in {
            "citizen",
            "ecogarde",
        }:
            query = query.filter(
                Event.created_by_id == user.id
            )

        events = (
            query
            .order_by(Event.created_at.desc())
            .all()
        )

        return [
            event_dict(event)
            for event in events
        ]


# ============================================================
# EVENT DETAIL
# ============================================================

@app.get("/api/v1/events/{event_id}")
def get_event(
    event_id: int,
    user: User = Depends(require_user),
):

    with Session(engine) as db:

        event = get_event_or_404(
            db,
            event_id,
        )

        ensure_event_access(
            user,
            event,
        )

        return event_dict(event)


# ============================================================
# CREATE EVENT
# ============================================================

@app.post("/api/v1/events")
def create_event(
    payload: EventCreate,
    user: User = Depends(require_user),
    idempotency_key: Optional[str] = Header(default=None),
):

    if user.role not in {
        "citizen",
        "ecogarde",
    }:
        raise HTTPException(
            status_code=403,
            detail="Seuls les agents terrain peuvent créer une observation.",
        )

    if payload.priority == "normal":
        payload.priority = "medium"
    if payload.priority not in VALID_PRIORITIES:
        raise HTTPException(
            status_code=400,
            detail="Priorité invalide.",
        )

    with Session(engine) as db:
        fingerprint = hashlib.sha256(json.dumps(payload.model_dump(), sort_keys=True).encode()).hexdigest()
        receipt_id, receipt = operation_receipt(db, user, "event", idempotency_key, fingerprint)
        if receipt:
            return event_dict(get_event_or_404(db, receipt.event_id))

        event = Event(
            created_by_id=user.id,
            category=payload.category,
            subcategory=payload.subcategory,
            description=payload.description,
            latitude=payload.latitude,
            longitude=payload.longitude,
            priority=payload.priority,
            status="pending",
            source=payload.source,
            reporter=user.display_name,
            region=payload.region,
        )

        db.add(event)
        db.flush()
        db.add(EventHistory(event_id=event.id, status="pending", at=event.created_at))
        if receipt_id:
            db.add(ClientOperation(id=receipt_id, fingerprint=fingerprint, event_id=event.id))

        log_activity(
            db,
            user,
            "create_event",
            "event",
            event.id,
            f"Création de l'observation #{event.id}.",
        )

        db.commit()
        db.refresh(event)

        return event_dict(event)


# ============================================================
# UPDATE EVENT
# ============================================================

@app.patch("/api/v1/events/{event_id}")
def update_event(
    event_id: int,
    payload: EventUpdate,
    user: User = Depends(
        require_roles(
            "expert",
            "admin",
        )
    ),
):

    with Session(engine) as db:

        event = get_event_or_404(
            db,
            event_id,
        )

        changes = payload.model_dump(
            exclude_unset=True
        )

        if changes.get("priority") == "normal":
            changes["priority"] = "medium"
        if "priority" in changes:

            if changes["priority"] not in VALID_PRIORITIES:
                raise HTTPException(
                    status_code=400,
                    detail="Priorité invalide.",
                )

        if "status" in changes:

            new_status = changes["status"]

            if new_status not in VALID_STATUSES:
                raise HTTPException(
                    status_code=400,
                    detail="Statut invalide.",
                )

            allowed = ALLOWED_TRANSITIONS.get(
                event.status,
                set(),
            )

            if (
                new_status != event.status
                and new_status not in allowed
            ):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Transition interdite : "
                        f"{event.status} -> {new_status}"
                    ),
                )

        old_status = event.status
        if not event.history_entries:
            db.add(EventHistory(event_id=event.id, status="pending", at=event.created_at))
            if old_status != "pending":
                db.add(EventHistory(event_id=event.id, status=old_status, at=event.updated_at))
        for field, value in changes.items():

            if hasattr(event, field):
                setattr(
                    event,
                    field,
                    value,
                )

        event.updated_at = datetime.now(
            timezone.utc
        )

        if event.status != old_status:
            db.add(EventHistory(event_id=event.id, status=event.status, at=event.updated_at))

        log_activity(
            db,
            user,
            "update_event",
            "event",
            event.id,
            f"Modification de l'observation #{event.id}.",
        )

        db.commit()
        db.refresh(event)

        return event_dict(event)


# ============================================================
# DELETE EVENT
# ============================================================

@app.delete("/api/v1/events/{event_id}")
def delete_event(
    event_id: int,
    user: User = Depends(
        require_roles("admin")
    ),
):

    with Session(engine) as db:

        event = get_event_or_404(
            db,
            event_id,
        )

        event_id_value = event.id

        db.delete(event)

        log_activity(
            db,
            user,
            "delete_event",
            "event",
            event_id_value,
            f"Suppression de l'observation #{event_id_value}.",
        )

        db.commit()

        return {
            "message": "Observation supprimée.",
            "id": event_id_value,
        }


# ============================================================
# MEDIA
# ============================================================

@app.post("/api/v1/events/{event_id}/media")
def upload_media(
    event_id: int,
    file: UploadFile = File(...),
    user: User = Depends(require_user),
    idempotency_key: Optional[str] = Header(default=None),
):
    with Session(engine) as db:
        event = get_event_or_404(db, event_id)
        ensure_event_access(user, event)
        content = file.file.read(20 * 1024 * 1024 + 1)
        if len(content) > 20 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Le média dépasse 20 Mo.")
        media_type = file.content_type or "application/octet-stream"
        fingerprint = hashlib.sha256(content + (file.filename or "file").encode() + media_type.encode()).hexdigest()
        receipt_id, receipt = operation_receipt(db, user, f"media:{event_id}", idempotency_key, fingerprint)
        if receipt:
            return media_dict(db.get(Media, receipt.media_id))
        safe_name = f"{secrets.token_hex(12)}_{Path(file.filename or 'file').name}"
        destination = UPLOAD_DIR / safe_name
        destination.write_bytes(content)
        try:
            media = Media(event_id=event.id, filename=safe_name, url=f"/uploads/{safe_name}", media_type=media_type)
            db.add(media)
            db.flush()
            if receipt_id:
                db.add(ClientOperation(id=receipt_id, fingerprint=fingerprint, event_id=event.id, media_id=media.id))
            log_activity(db, user, "upload_media", "event", event.id, f"Ajout d'un média à l'observation #{event.id}.")
            db.commit()
            db.refresh(media)
            return media_dict(media)
        except Exception:
            destination.unlink(missing_ok=True)
            raise


# ============================================================
# AI
# ============================================================

@app.post("/api/v1/ai/analyze")
def ai_analyze(
    payload: AIIn,
    user: User = Depends(
        require_roles(
            "expert",
            "admin",
        )
    ),
):

    with Session(engine) as db:

        enabled = get_setting(
            db,
            "ai_enabled",
            "true",
        ).lower() == "true"

        if not enabled:
            raise HTTPException(
                status_code=403,
                detail="Les fonctions IA sont désactivées dans les paramètres.",
            )

    description = payload.description.lower()

    detected_category = "waste"

    if any(
        word in description
        for word in [
            "requin",
            "shark",
        ]
    ):
        detected_category = "shark"

    elif any(
        word in description
        for word in [
            "incendie",
            "feu",
            "brûl",
        ]
    ):
        detected_category = "fire"

    elif any(
        word in description
        for word in [
            "pollution",
            "hydrocarbure",
            "huile",
        ]
    ):
        detected_category = "marine_pollution"

    elif any(
        word in description
        for word in [
            "eau",
            "rivière",
            "source",
        ]
    ):
        detected_category = "water"

    elif any(
        word in description
        for word in [
            "corail",
            "poisson",
            "tortue",
            "dauphin",
        ]
    ):
        detected_category = "marine_biodiversity"

    elif any(
        word in description
        for word in [
            "arbre",
            "forêt",
            "animal",
            "oiseaux",
        ]
    ):
        detected_category = "terrestrial_biodiversity"

    return {
        "category": detected_category,
        "priority": "medium",
        "confidence": 0.72,
        "human_validation_required": True,
        "message": (
            "Analyse indicative. "
            "Une validation humaine reste nécessaire "
            "avant traitement opérationnel."
        ),
    }


# ============================================================
# ALERTS
# ============================================================

@app.get("/api/v1/alerts")
def list_alerts(
    user: User = Depends(
        require_roles(
            "expert",
            "admin",
        )
    ),
):

    with Session(engine) as db:

        alerts = (
            db.query(Alert)
            .order_by(
                Alert.created_at.desc()
            )
            .all()
        )

        return [
            {
                "id": alert.id,
                "event_id": alert.event_id,
                "title": alert.title,
                "message": alert.message,
                "severity": alert.severity,
                "status": alert.status,
                "created_at": alert.created_at,
            }
            for alert in alerts
        ]


@app.post("/api/v1/alerts/{alert_id}/close")
def close_alert(
    alert_id: int,
    user: User = Depends(
        require_roles(
            "expert",
            "admin",
        )
    ),
):

    with Session(engine) as db:

        alert = (
            db.query(Alert)
            .filter(Alert.id == alert_id)
            .first()
        )

        if not alert:
            raise HTTPException(
                status_code=404,
                detail="Alerte introuvable.",
            )

        alert.status = "closed"

        log_activity(
            db,
            user,
            "close_alert",
            "alert",
            alert.id,
            f"Fermeture de l'alerte #{alert.id}.",
        )

        db.commit()

        return {
            "message": "Alerte fermée."
        }


# ============================================================
# COLLECTION POINTS
# ============================================================

@app.get("/api/v1/collection-points")
def collection_points(
    user: User = Depends(
        require_roles(
            "ecogarde",
            "expert",
            "admin",
        )
    ),
):

    with Session(engine) as db:

        points = (
            db.query(CollectionPoint)
            .order_by(
                CollectionPoint.name
            )
            .all()
        )

        return [
            {
                "id": point.id,
                "name": point.name,
                "city": point.city,
                "latitude": point.latitude,
                "longitude": point.longitude,
                "point_type": point.point_type,
                "status": point.status,
                "info": point.info,
            }
            for point in points
        ]


# ============================================================
# STATISTICS
# ============================================================

@app.get("/api/v1/statistics")
def statistics(
    user: User = Depends(
        require_roles(
            "expert",
            "admin",
        )
    ),
):

    with Session(engine) as db:

        total = db.query(Event).count()

        pending = (
            db.query(Event)
            .filter(
                Event.status == "pending"
            )
            .count()
        )

        to_validate = (
            db.query(Event)
            .filter(
                Event.status == "to_validate"
            )
            .count()
        )

        validated = (
            db.query(Event)
            .filter(
                Event.status == "validated"
            )
            .count()
        )

        processed = (
            db.query(Event)
            .filter(
                Event.status == "processed"
            )
            .count()
        )

        closed = (
            db.query(Event)
            .filter(
                Event.status == "closed"
            )
            .count()
        )

        rejected = (
            db.query(Event)
            .filter(
                Event.status == "rejected"
            )
            .count()
        )

        categories = (
            db.query(
                Event.category,
                func.count(Event.id),
            )
            .group_by(Event.category)
            .all()
        )

        priorities = (
            db.query(
                Event.priority,
                func.count(Event.id),
            )
            .group_by(Event.priority)
            .all()
        )

        return {
            "total": total,
            "by_category": {category: count for category, count in categories},
            "by_priority": {priority: count for priority, count in priorities},
            "by_status": {"pending": pending, "to_validate": to_validate, "validated": validated, "processed": processed, "closed": closed, "rejected": rejected},
            "pending": pending,
            "to_validate": to_validate,
            "validated": validated,
            "processed": processed,
            "closed": closed,
            "rejected": rejected,
            "categories": {
                category: count
                for category, count in categories
            },
            "priorities": {
                priority: count
                for priority, count in priorities
            },
        }


# ============================================================
# EXPORT
# ============================================================

@app.get("/api/v1/data/export")
def export_data(
    user: User = Depends(
        require_roles(
            "expert",
            "admin",
        )
    ),
):

    with Session(engine) as db:

        events = (
            db.query(Event)
            .order_by(Event.created_at.desc())
            .all()
        )

        return {
            "exported_at": datetime.now(
                timezone.utc
            ),
            "count": len(events),
            "events": [
                event_dict(event)
                for event in events
            ],
        }


# ============================================================
# ADMIN — USERS
# ============================================================

@app.get("/api/v1/users")
def list_users(
    search: Optional[str] = None,
    role: Optional[str] = None,
    active: Optional[bool] = None,
    user: User = Depends(
        require_roles("admin")
    ),
):

    with Session(engine) as db:

        query = db.query(User)

        if search:
            search_value = (
                f"%{search.strip().lower()}%"
            )

            query = query.filter(
                or_(
                    func.lower(
                        User.username
                    ).like(search_value),

                    func.lower(
                        User.display_name
                    ).like(search_value),
                )
            )

        if role:
            if role not in VALID_ROLES:
                raise HTTPException(
                    status_code=400,
                    detail="Rôle invalide.",
                )

            query = query.filter(
                User.role == role
            )

        if active is not None:
            query = query.filter(
                User.active == active
            )

        users = (
            query
            .order_by(
                User.created_at.desc()
            )
            .all()
        )

        return [
            user_dict(item)
            for item in users
        ]


@app.get("/api/v1/users/{user_id}")
def get_user(
    user_id: int,
    user: User = Depends(
        require_roles("admin")
    ),
):

    with Session(engine) as db:

        target = (
            db.query(User)
            .filter(User.id == user_id)
            .first()
        )

        if not target:
            raise HTTPException(
                status_code=404,
                detail="Utilisateur introuvable.",
            )

        return user_dict(target)


@app.post("/api/v1/users")
def create_user(
    payload: UserCreateIn,
    user: User = Depends(
        require_roles("admin")
    ),
):

    if payload.role not in VALID_ROLES:
        raise HTTPException(
            status_code=400,
            detail="Rôle invalide.",
        )

    with Session(engine) as db:

        existing = (
            db.query(User)
            .filter(
                func.lower(User.username)
                == payload.username.lower()
            )
            .first()
        )

        if existing:
            raise HTTPException(
                status_code=409,
                detail="Ce nom d'utilisateur existe déjà.",
            )

        target = User(
            username=payload.username.strip(),
            password_hash=hash_password(
                payload.password
            ),
            display_name=payload.display_name.strip(),
            role=payload.role,
            active=payload.active,
        )

        db.add(target)
        db.flush()

        log_activity(
            db,
            user,
            "create_user",
            "user",
            target.id,
            (
                f"Création du compte "
                f"{target.username} "
                f"avec le rôle {target.role}."
            ),
        )

        db.commit()
        db.refresh(target)

        return user_dict(target)


@app.patch("/api/v1/users/{user_id}")
def update_user(
    user_id: int,
    payload: UserUpdateIn,
    user: User = Depends(
        require_roles("admin")
    ),
):

    with Session(engine) as db:

        target = (
            db.query(User)
            .filter(User.id == user_id)
            .first()
        )

        if not target:
            raise HTTPException(
                status_code=404,
                detail="Utilisateur introuvable.",
            )

        changes = payload.model_dump(
            exclude_unset=True
        )

        new_role = changes.get(
            "role",
            target.role,
        )

        new_active = changes.get(
            "active",
            target.active,
        )

        if new_role not in VALID_ROLES:
            raise HTTPException(
                status_code=400,
                detail="Rôle invalide.",
            )

        # Empêche un administrateur de supprimer
        # le dernier administrateur actif.
        if target.role == "admin":

            if new_role != "admin":

                active_admins = (
                    db.query(User)
                    .filter(
                        User.role == "admin",
                        User.active == True,
                    )
                    .count()
                )

                if active_admins <= 1:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "Impossible de retirer le rôle "
                            "du dernier administrateur actif."
                        ),
                    )

            if new_active is False:

                active_admins = (
                    db.query(User)
                    .filter(
                        User.role == "admin",
                        User.active == True,
                    )
                    .count()
                )

                if active_admins <= 1:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "Impossible de désactiver "
                            "le dernier administrateur actif."
                        ),
                    )

        if (
            target.id == user.id
            and new_active is False
        ):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Vous ne pouvez pas désactiver "
                    "votre propre compte."
                ),
            )

        if "display_name" in changes:
            target.display_name = (
                changes["display_name"].strip()
            )

        target.role = new_role
        target.active = new_active

        if not target.active:
            invalidate_user_sessions(
                target.id
            )

        log_activity(
            db,
            user,
            "update_user",
            "user",
            target.id,
            (
                f"Modification du compte "
                f"{target.username}."
            ),
        )

        db.commit()
        db.refresh(target)

        return user_dict(target)


# ============================================================
# ADMIN — ACTIVATE
# ============================================================

@app.post("/api/v1/users/{user_id}/activate")
def activate_user(
    user_id: int,
    user: User = Depends(
        require_roles("admin")
    ),
):

    with Session(engine) as db:

        target = (
            db.query(User)
            .filter(User.id == user_id)
            .first()
        )

        if not target:
            raise HTTPException(
                status_code=404,
                detail="Utilisateur introuvable.",
            )

        target.active = True

        log_activity(
            db,
            user,
            "activate_user",
            "user",
            target.id,
            (
                f"Activation du compte "
                f"{target.username}."
            ),
        )

        db.commit()
        db.refresh(target)

        return user_dict(target)


# ============================================================
# ADMIN — DEACTIVATE
# ============================================================

@app.post("/api/v1/users/{user_id}/deactivate")
def deactivate_user(
    user_id: int,
    user: User = Depends(
        require_roles("admin")
    ),
):

    with Session(engine) as db:

        target = (
            db.query(User)
            .filter(User.id == user_id)
            .first()
        )

        if not target:
            raise HTTPException(
                status_code=404,
                detail="Utilisateur introuvable.",
            )

        if target.id == user.id:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Vous ne pouvez pas désactiver "
                    "votre propre compte."
                ),
            )

        if target.role == "admin":

            active_admins = (
                db.query(User)
                .filter(
                    User.role == "admin",
                    User.active == True,
                )
                .count()
            )

            if active_admins <= 1:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Impossible de désactiver "
                        "le dernier administrateur actif."
                    ),
                )

        target.active = False

        invalidate_user_sessions(
            target.id
        )

        log_activity(
            db,
            user,
            "deactivate_user",
            "user",
            target.id,
            (
                f"Désactivation du compte "
                f"{target.username}."
            ),
        )

        db.commit()
        db.refresh(target)

        return user_dict(target)


# ============================================================
# ADMIN — RESET PASSWORD
# ============================================================

@app.post("/api/v1/users/{user_id}/reset-password")
def reset_password(
    user_id: int,
    payload: PasswordResetIn,
    user: User = Depends(
        require_roles("admin")
    ),
):

    with Session(engine) as db:

        target = (
            db.query(User)
            .filter(User.id == user_id)
            .first()
        )

        if not target:
            raise HTTPException(
                status_code=404,
                detail="Utilisateur introuvable.",
            )

        target.password_hash = hash_password(
            payload.password
        )

        invalidate_user_sessions(
            target.id
        )

        log_activity(
            db,
            user,
            "reset_password",
            "user",
            target.id,
            (
                f"Réinitialisation du mot de passe "
                f"du compte {target.username}."
            ),
        )

        db.commit()

        return {
            "message": (
                "Mot de passe réinitialisé. "
                "Les sessions existantes ont été invalidées."
            )
        }


# ============================================================
# ADMIN — DELETE USER
# ============================================================

@app.delete("/api/v1/users/{user_id}")
def delete_user(
    user_id: int,
    user: User = Depends(
        require_roles("admin")
    ),
):

    with Session(engine) as db:

        target = (
            db.query(User)
            .filter(User.id == user_id)
            .first()
        )

        if not target:
            raise HTTPException(
                status_code=404,
                detail="Utilisateur introuvable.",
            )

        if target.id == user.id:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Vous ne pouvez pas supprimer "
                    "votre propre compte."
                ),
            )

        if target.role == "admin":

            admin_count = (
                db.query(User)
                .filter(
                    User.role == "admin"
                )
                .count()
            )

            if admin_count <= 1:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Impossible de supprimer "
                        "le dernier administrateur."
                    ),
                )

        username = target.username
        target_id = target.id

        invalidate_user_sessions(
            target_id
        )

        db.delete(target)

        log_activity(
            db,
            user,
            "delete_user",
            "user",
            target_id,
            (
                f"Suppression du compte "
                f"{username}."
            ),
        )

        db.commit()

        return {
            "message": "Utilisateur supprimé.",
            "id": target_id,
        }


# ============================================================
# ADMIN — SETTINGS
# ============================================================

@app.get("/api/v1/settings")
def get_settings(
    user: User = Depends(
        require_roles("admin")
    ),
):

    with Session(engine) as db:

        settings = (
            db.query(SystemSetting)
            .order_by(SystemSetting.key)
            .all()
        )

        return {
            setting.key: {
                "value": setting.value,
                "description": setting.description,
                "updated_at": setting.updated_at,
            }
            for setting in settings
        }


@app.patch("/api/v1/settings")
def update_settings(
    payload: SettingsUpdateIn,
    user: User = Depends(
        require_roles("admin")
    ),
):

    with Session(engine) as db:

        allowed_boolean_keys = {
            "validation_required",
            "notifications_enabled",
            "ai_enabled",
            "ai_human_validation",
            "allow_citizen_reports",
            "allow_ecogarde_reports",
        }

        allowed_integer_keys = {
            "session_duration_hours",
            "map_zoom",
        }

        allowed_float_keys = {
            "map_center_lat",
            "map_center_lng",
        }

        for key, value in payload.values.items():

            if key in allowed_boolean_keys:

                if value.lower() not in {
                    "true",
                    "false",
                }:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Valeur booléenne invalide "
                            f"pour {key}."
                        ),
                    )

            elif key in allowed_integer_keys:

                try:
                    number = int(value)

                    if key == "session_duration_hours":
                        if number < 1 or number > 720:
                            raise ValueError()

                    if key == "map_zoom":
                        if number < 1 or number > 22:
                            raise ValueError()

                except Exception:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Valeur numérique invalide "
                            f"pour {key}."
                        ),
                    )

            elif key in allowed_float_keys:

                try:
                    float(value)
                except Exception:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Valeur numérique invalide "
                            f"pour {key}."
                        ),
                    )

            elif key == "categories":

                try:
                    categories_value = json.loads(
                        value
                    )

                    if not isinstance(
                        categories_value,
                        list,
                    ):
                        raise ValueError()

                except Exception:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "Le paramètre categories "
                            "doit contenir un JSON valide."
                        ),
                    )

            elif key == "priority_options":

                try:
                    priorities = json.loads(
                        value
                    )

                    if not isinstance(
                        priorities,
                        list,
                    ):
                        raise ValueError()

                except Exception:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "priority_options doit "
                            "contenir un JSON valide."
                        ),
                    )

            elif key in {
                "platform_name",
                "platform_description",
                "country",
                "map_provider",
            }:

                pass

            else:

                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Paramètre système inconnu : {key}"
                    ),
                )

            setting = (
                db.query(SystemSetting)
                .filter(
                    SystemSetting.key == key
                )
                .first()
            )

            if setting:

                setting.value = str(value)

            else:

                db.add(
                    SystemSetting(
                        key=key,
                        value=str(value),
                    )
                )

        log_activity(
            db,
            user,
            "update_settings",
            "system",
            None,
            "Modification des paramètres système ENVIA.",
        )

        db.commit()

        settings = (
            db.query(SystemSetting)
            .order_by(SystemSetting.key)
            .all()
        )

        return {
            setting.key: {
                "value": setting.value,
                "description": setting.description,
                "updated_at": setting.updated_at,
            }
            for setting in settings
        }


# ============================================================
# ADMIN — ACTIVITY
# ============================================================

@app.get("/api/v1/activity")
def activity(
    limit: int = 100,
    search: Optional[str] = None,
    user_id: Optional[int] = None,
    action: Optional[str] = None,
    user: User = Depends(
        require_roles("admin")
    ),
):

    limit = max(
        1,
        min(limit, 500),
    )

    with Session(engine) as db:

        query = (
            db.query(ActivityLog)
            .order_by(
                ActivityLog.created_at.desc()
            )
        )

        if user_id is not None:

            query = query.filter(
                ActivityLog.user_id == user_id
            )

        if action:

            query = query.filter(
                ActivityLog.action == action
            )

        if search:

            value = (
                f"%{search.lower()}%"
            )

            query = query.filter(
                or_(
                    func.lower(
                        ActivityLog.action
                    ).like(value),

                    func.lower(
                        ActivityLog.description
                    ).like(value),
                )
            )

        logs = query.limit(limit).all()

        result = []

        for item in logs:

            activity_user = None

            if item.user_id:

                activity_user = (
                    db.query(User)
                    .filter(
                        User.id == item.user_id
                    )
                    .first()
                )

            result.append(
                {
                    "id": item.id,
                    "user_id": item.user_id,
                    "username": (
                        activity_user.username
                        if activity_user
                        else None
                    ),
                    "display_name": (
                        activity_user.display_name
                        if activity_user
                        else None
                    ),
                    "action": item.action,
                    "target_type": item.target_type,
                    "target_id": item.target_id,
                    "description": item.description,
                    "created_at": item.created_at,
                }
            )

        return result

def get_db():
    with Session(engine) as db:
        yield db

# ---- ENVIA Terrain V2 endpoints ----
class NestCreate(BaseModel):
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    accuracy_m: Optional[float] = Field(default=None, ge=0, le=10000)
    notes: str = Field(default="", max_length=1000)

@app.post("/api/v1/turtle-nests", status_code=201)
def create_turtle_nest(payload: NestCreate, user: User = Depends(require_roles("ecogarde", "expert")), db: Session = Depends(get_db)):
    # Never return coordinates to the reporting ecoguard.
    nest = TurtleNest(created_by_id=user.id, latitude=payload.latitude, longitude=payload.longitude,
                      accuracy_m=payload.accuracy_m, notes=payload.notes, status="unverified")
    db.add(nest)
    db.commit()
    db.refresh(nest)
    return {"id": nest.id, "status": nest.status, "message": "Point confidentiel enregistré"}

@app.get("/api/v1/turtle-nests")
def list_turtle_nests(user: User = Depends(require_roles("expert")), db: Session = Depends(get_db)):
    return [{"id": n.id, "latitude": n.latitude, "longitude": n.longitude,
             "accuracy_m": n.accuracy_m, "status": n.status, "notes": n.notes,
             "created_at": n.created_at.isoformat()} for n in db.query(TurtleNest).all()]

@app.get("/api/v1/map/validated")
def validated_map(user: User = Depends(require_user), db: Session = Depends(get_db)):
    # No pending/rejected reports and no nesting data in this endpoint.
    return [{"id": e.id, "category": e.category, "description": e.description,
             "latitude": e.latitude, "longitude": e.longitude, "status": e.status}
            for e in db.query(Event).filter(Event.status.in_(["validated", "processed", "closed"])).all()]

@app.post("/api/v1/ai/analyze-photo")
async def analyze_photo(file: UploadFile = File(...), user: User = Depends(require_roles("ecogarde", "expert"))):
    import base64
    import urllib.request
    from fastapi.concurrency import run_in_threadpool
    key = os.getenv("OPENAI_API_KEY", "")
    if not key:
        raise HTTPException(503, "Analyse IA non configurée. Photo à conserver pour validation humaine.")
    if file.content_type not in ("image/jpeg", "image/png", "image/webp"):
        raise HTTPException(400, "Format photo non pris en charge")
    raw = await file.read(8 * 1024 * 1024 + 1)
    if len(raw) > 8 * 1024 * 1024 or not raw:
        raise HTTPException(413, "Photo vide ou trop volumineuse (maximum 8 Mo)")
    categories = ["waste", "marine_pollution", "water", "marine_biodiversity", "terrestrial_biodiversity", "fire", "climate", "habitat", "shark"]
    request_body = {"model": os.getenv("ENVIA_VISION_MODEL", "gpt-4.1-mini"),
       "messages": [{"role": "system", "content": "Analyse une photographie environnementale. Ne déduis ni toxicité, ni infraction, ni espèce non identifiable. Réponds exclusivement en JSON avec category parmi " + ", ".join(categories) + ", description en français (une ou deux phrases factuelles), uncertain (booléen)."},
        {"role": "user", "content": [{"type": "text", "text": "Décris uniquement les éléments visibles sur cette photo."}, {"type": "image_url", "image_url": {"url": "data:" + file.content_type + ";base64," + base64.b64encode(raw).decode()}}]}], "response_format": {"type": "json_object"}, "max_tokens": 250}
    def call():
        req = urllib.request.Request("https://api.openai.com/v1/chat/completions", data=json.dumps(request_body).encode(), headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.load(response)
    try:
        result = await run_in_threadpool(call)
        obj = json.loads(result["choices"][0]["message"]["content"])
        if obj.get("category") not in categories or not isinstance(obj.get("description"), str):
            raise ValueError("Réponse IA invalide")
        return {"category": obj["category"], "description": obj["description"][:4000], "uncertain": bool(obj.get("uncertain", True)), "requires_expert_validation": True}
    except Exception:
        raise HTTPException(503, "Analyse indisponible. Conservez la photo et faites vérifier par un expert.")

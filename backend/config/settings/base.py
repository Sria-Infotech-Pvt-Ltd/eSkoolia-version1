from pathlib import Path
import os
import socket
import struct
import random
from datetime import timedelta
from dotenv import load_dotenv
from urllib.parse import parse_qs, unquote, urlparse

try:
    import dj_database_url
except ImportError:  # pragma: no cover - optional dependency fallback
    dj_database_url = None


def _resolve_via_fallback_dns(hostname: str, dns_server: str = "8.8.8.8") -> str | None:
    """
    Try to resolve *hostname* using the system DNS first.
    If system DNS raises gaierror (e.g. corporate DNS refuses .neon.tech),
    fall back to a raw UDP A-record query against *dns_server* (Google DNS).
    Returns the first IPv4 address found, or None on any failure.
    libpq supports the ``hostaddr`` connection parameter which bypasses
    DNS entirely while keeping the ``host`` value for SSL CN/SAN verification.
    """
    try:
        return socket.gethostbyname(hostname)
    except socket.gaierror:
        pass  # system DNS failed — try public resolver

    try:
        txid = random.randint(0, 65535)
        header = struct.pack(">HHHHHH", txid, 0x0100, 1, 0, 0, 0)
        question = b""
        for label in hostname.encode().split(b"."):
            question += bytes([len(label)]) + label
        question += b"\x00"
        question += struct.pack(">HH", 1, 1)  # QTYPE A, QCLASS IN

        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(3)
        sock.sendto(header + question, (dns_server, 53))
        data, _ = sock.recvfrom(512)
        sock.close()

        ancount = struct.unpack(">H", data[6:8])[0]
        # Skip the question section that follows the 12-byte header
        offset = 12
        while offset < len(data) and data[offset] != 0:
            if data[offset] & 0xC0 == 0xC0:
                offset += 2
                break
            offset += data[offset] + 1
        else:
            offset += 1  # root label
        offset += 4  # QTYPE + QCLASS

        for _ in range(ancount):
            if offset >= len(data):
                break
            # Name: may be a pointer or inline labels
            if data[offset] & 0xC0 == 0xC0:
                offset += 2
            else:
                while offset < len(data) and data[offset] != 0:
                    offset += data[offset] + 1
                offset += 1  # root label
            if offset + 10 > len(data):
                break
            rtype, _rclass, _ttl, rdlen = struct.unpack(">HHIH", data[offset : offset + 10])
            offset += 10
            if rtype == 1 and rdlen == 4:  # A record
                return ".".join(str(b) for b in data[offset : offset + 4])
            offset += rdlen
    except Exception:
        pass
    return None

load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

BASE_DIR = Path(__file__).resolve().parent.parent.parent

SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "change-me")
# Feature flag to enable schema-based multi-tenancy (off by default)
MULTI_TENANCY_ENABLED = os.getenv("MULTI_TENANCY_ENABLED", "False").lower() == "true"
DEBUG = os.getenv("DJANGO_DEBUG", "False").lower() == "true"
# REST API — never redirect POST/PUT/PATCH requests by appending a slash.
# Django's APPEND_SLASH=True is designed for HTML sites; for a pure API it
# turns a missing trailing-slash into a 500 RuntimeError on non-GET requests.
APPEND_SLASH = False
ALLOWED_HOSTS = [host.strip() for host in os.getenv("DJANGO_ALLOWED_HOSTS", "127.0.0.1,localhost").split(",")]
# Allow any VS Code / GitHub dev-tunnel host so port-forwarded testing works.
ALLOWED_HOSTS += [".devtunnels.ms", ".githubpreview.dev"]
# Production + local staging subdomain routing: springdale.eskoolia.com / springdale.eskoolia.local
ALLOWED_HOSTS += [".eskoolia.com", ".eskoolia.local"]
# Local LAN access for testing from other devices on the network.
ALLOWED_HOSTS += ["192.168.0.230", "192.168.0.195"]

# Silence django-tenants warning about auto_create_schema=False; schema
# provisioning is handled explicitly by management commands in this project.
SILENCED_SYSTEM_CHECKS = ["tenancy.W005"]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "channels",
    "corsheaders",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "drf_spectacular",
    "django_filters",
    "auditlog",
    "apps.core",
    "apps.transport",
    "apps.tenancy",
    "apps.users",
    "apps.admissions",
    "apps.access_control",
    "apps.super_admin",
    "apps.students",
    "apps.academics",
    "apps.attendance",
    "apps.fees",
    "apps.exams",
    "apps.finance",
    "apps.hr",
    "apps.master",
    "apps.library",
    "apps.behaviour",
    "apps.chat",
    "apps.communication",
    "apps.competitions",
    "apps.reports",
    "apps.teacher_portal",
    "apps.parent_portal",
    "apps.dashboard",
    "apps.notes",
    "apps.todos",
    "apps.calls_queue",
    "apps.settings",
    "apps.assistant",
]

# Guarded django-tenants integration
if MULTI_TENANCY_ENABLED:
    try:
        import django_tenants  # noqa: F401
    except Exception:
        # Do not hard-fail at import time; provide a clear runtime error later
        pass

# NOTE: When MULTI_TENANCY_ENABLED is False the project behaves exactly
# as before. The guarded logic below will only be applied when the flag
# is enabled in the environment so changes are reversible and incremental.

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "apps.tenancy.middleware.TenantContextMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

# When enabled we will validate and (optionally) insert the
# TenantMainMiddleware. This must run first when tenant routing is active.
def _validate_tenancy_middleware_order(middleware_list):
    # Only called when MULTI_TENANCY_ENABLED is True
    tenant_main = "apps.tenancy.middleware.TenantMainMiddleware"
    auth_mw = "django.contrib.auth.middleware.AuthenticationMiddleware"
    if tenant_main in middleware_list:
        tenant_index = middleware_list.index(tenant_main)
        if auth_mw in middleware_list and tenant_index > middleware_list.index(auth_mw):
            raise RuntimeError(
                f"{tenant_main} must appear before {auth_mw} when multi-tenancy is enabled"
            )

# Guarded setting extensions for tenant-aware authentication and schema switching.
# These are only applied at runtime when MULTI_TENANCY_ENABLED is True.
if MULTI_TENANCY_ENABLED:
    tenant_main_middleware = "apps.tenancy.middleware.TenantMainMiddleware"

    # Insert TenantMainMiddleware FIRST so tenant resolution happens before
    # auth/session-dependent logic. This enables request-level schema switching.
    if tenant_main_middleware not in MIDDLEWARE:
        MIDDLEWARE.insert(0, tenant_main_middleware)
        # Move SecurityMiddleware back to second position (after TenantMainMiddleware)
        if "django.middleware.security.SecurityMiddleware" in MIDDLEWARE:
            security_idx = MIDDLEWARE.index("django.middleware.security.SecurityMiddleware")
            if security_idx != 1:
                MIDDLEWARE.pop(security_idx)
                MIDDLEWARE.insert(1, "django.middleware.security.SecurityMiddleware")

    # Define default SHARED_APPS and TENANT_APPS placeholders. These
    # should be reviewed and adjusted during the next phases.
    SHARED_APPS = [
        "django_tenants",
        "apps.tenancy",
        "django.contrib.admin",
        "django.contrib.auth",
        "django.contrib.contenttypes",
        "django.contrib.sessions",
        "django.contrib.messages",
        "django.contrib.staticfiles",
        # Framework/infra apps - no tenant-specific data of their own.
        "channels",
        "corsheaders",
        "rest_framework",
        "rest_framework_simplejwt.token_blacklist",
        "drf_spectacular",
        "django_filters",
        # Keeping the User model shared (rather than a separate table per
        # tenant schema) preserves the existing login/permission model this
        # codebase already runs on - one global account per person, scoped
        # to a school via request.user.school_id (see CLAUDE.md's tenancy
        # policy) - not a separate account per school.
        "apps.users",
        "apps.access_control",
        # Cross-school management surface - must run in the public schema
        # to manage every tenant (see CLAUDE.md: apps/tenancy/super_admin/,
        # apps/super_admin/ are the "genuine multi-tenant admin surfaces").
        "apps.super_admin",
        # Global/static reference data - already listed as tenant-agnostic
        # in apps.tenancy.context.PUBLIC_PATH_PREFIXES (/api/v1/master/,
        # /api/master/).
        "apps.master",
    ]

    TENANT_APPS = [
        # Per-school operational data (academic years, classes, subjects,
        # transport, inventory, holidays) - moved out of SHARED_APPS: its
        # own Vehicle model needs a foreign key into hr.Staff (a tenant
        # app), which a shared/public-schema table cannot hold (there's no
        # single hr_staff for it to point to once there's more than one
        # school). Verified nothing in the shared apps depends on apps.core
        # in the other direction.
        "apps.core",
        # Transport (moved out of apps.core); per-school data, FKs into hr.Staff / students.
        "apps.transport",
        # tenant specific apps
        "apps.students",
        "apps.admissions",
        "apps.attendance",
        "apps.academics",
        "apps.fees",
        "apps.hr",
        "apps.library",
        "apps.exams",
        "apps.finance",
        "apps.behaviour",
        "apps.chat",
        "apps.communication",
        "apps.competitions",
        "apps.reports",
        "apps.teacher_portal",
        "apps.parent_portal",
        "apps.dashboard",
        "apps.notes",
        "apps.todos",
        "apps.calls_queue",
        # Per-school configuration (fee structure, notification
        # preferences, etc.), not global platform settings.
        "apps.settings",
        # Per-school audit trail, matching the same isolation principle as
        # the school's own data rather than a combined cross-school log.
        "auditlog",
        "apps.assistant",
    ]

    # Basic static validations
    try:
        _validate_tenancy_middleware_order(MIDDLEWARE)
    except RuntimeError:
        # Raise loudly during startup to avoid misconfigured deployments
        raise

    # Prevent accidental duplication between shared and tenant app lists
    duplicate_apps = set(SHARED_APPS) & set(TENANT_APPS)
    if duplicate_apps:
        raise RuntimeError(f"Apps duplicated in SHARED_APPS and TENANT_APPS: {duplicate_apps}")

    # Recompose INSTALLED_APPS for django-tenants: SHARED_APPS run in every
    # schema (including public); TENANT_APPS run only in each tenant's own
    # schema. Without this, django-tenants' migrate_schemas command and its
    # per-schema app registry never see SHARED_APPS/TENANT_APPS at all - it
    # only reads INSTALLED_APPS, so any app not folded in here would be
    # silently missing (no migrations, no models) the moment this flag is on.
    INSTALLED_APPS = list(SHARED_APPS) + [app for app in TENANT_APPS if app not in SHARED_APPS]

    # Note: database engine override happens below after DATABASES is defined
    TENANT_MODEL = "tenancy.SchoolTenant"
    TENANT_DOMAIN_MODEL = "tenancy.Domain"
    # django-tenants' own AppConfig.ready() hard-requires its own router to
    # be present (raises ImproperlyConfigured otherwise) - and it already
    # does exactly what apps.tenancy.routers.TenantSyncRouter was trying to
    # do, correctly, by reading SHARED_APPS/TENANT_APPS directly rather than
    # a separately-maintained (and already out of sync - missing "master")
    # hardcoded app-label set.
    DATABASE_ROUTERS = ["django_tenants.routers.TenantSyncRouter"]
else:
    # When MULTI_TENANCY_ENABLED is False, ensure DATABASE_ROUTERS is empty
    # to maintain monolithic behavior without any tenant routing interference.
    DATABASE_ROUTERS = []
    # django_tenants registers a post_delete signal that calls get_tenant_model()
    # which reads settings.TENANT_MODEL. Define a safe fallback so it doesn't
    # raise AttributeError on every model delete (e.g. session cleanup in admin).
    TENANT_MODEL = "tenancy.SchoolTenant"
    TENANT_DOMAIN_MODEL = "tenancy.Domain"

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels.layers.InMemoryChannelLayer",
    }
}

DB_ENGINE = os.getenv("DB_ENGINE", "django.db.backends.sqlite3")
# Normalize accidental quoted env values, e.g. DATABASE_URL="postgres://..."
DATABASE_URL = os.getenv("DATABASE_URL", "").strip().strip("\"").strip("'")

if DATABASE_URL:
    parsed_db_url = urlparse(DATABASE_URL)
    query_params = parse_qs(parsed_db_url.query or "")
    resolved_sslmode = (query_params.get("sslmode", [""])[0] or os.getenv("DB_SSLMODE", "")).strip()

    # If local DNS can't resolve the DB host (e.g. corporate DNS blocks .neon.tech),
    # fall back to Google DNS (8.8.8.8) and inject the resolved IP as ``hostaddr``.
    # libpq connects to the IP directly while still using ``host`` for SSL CN/SAN
    # verification — so TLS remains fully secure with no admin rights needed.
    _db_host = parsed_db_url.hostname or ""
    _resolved_hostaddr: str | None = None
    if _db_host:
        _fallback_ip = _resolve_via_fallback_dns(_db_host)
        # Only inject hostaddr when system DNS actually failed (fallback used)
        try:
            socket.gethostbyname(_db_host)
        except socket.gaierror:
            _resolved_hostaddr = _fallback_ip

    if dj_database_url is not None:
        default_db = dj_database_url.parse(DATABASE_URL, conn_max_age=0)
        default_db.setdefault("OPTIONS", {})
        default_db["OPTIONS"].setdefault("connect_timeout", 10)
        if resolved_sslmode:
            default_db["OPTIONS"]["sslmode"] = resolved_sslmode
        if _resolved_hostaddr:
            default_db["OPTIONS"]["hostaddr"] = _resolved_hostaddr
        default_db["CONN_HEALTH_CHECKS"] = True
        DATABASES = {"default": default_db}
    else:
        db_scheme = (parsed_db_url.scheme or "").split("+")[0].lower()
        engine_map = {
            "postgres": "django.db.backends.postgresql",
            "postgresql": "django.db.backends.postgresql",
            "sqlite": "django.db.backends.sqlite3",
        }
        resolved_engine = engine_map.get(db_scheme, DB_ENGINE)
        resolved_name = (
            unquote(parsed_db_url.path.lstrip("/"))
            if resolved_engine != "django.db.backends.sqlite3"
            else (unquote(parsed_db_url.path) or str(BASE_DIR / "db.sqlite3"))
        )
        resolved_options: dict = {
            "connect_timeout": 10,  # 10 sec timeout — lets Neon wake up without hanging
        }
        if resolved_sslmode:
            resolved_options["sslmode"] = resolved_sslmode
        if _resolved_hostaddr:
            resolved_options["hostaddr"] = _resolved_hostaddr

        DATABASES = {
            "default": {
                "ENGINE": resolved_engine,
                "NAME": resolved_name,
                "USER": unquote(parsed_db_url.username or ""),
                "PASSWORD": unquote(parsed_db_url.password or ""),
                "HOST": parsed_db_url.hostname or "",
                "PORT": str(parsed_db_url.port or ""),
                **({"OPTIONS": resolved_options} if resolved_options else {}),
                # Neon / serverless Postgres: never reuse a connection between
                # requests — the idle connection will be dropped by Neon and
                # the next query will fail with "getaddrinfo failed".
                "CONN_MAX_AGE": 0,
                # Django 4.1+: health-check each connection before use so a
                # freshly obtained connection is guaranteed to be open.
                "CONN_HEALTH_CHECKS": True,
            }
        }
else:
    DATABASES = {
        "default": {
            "ENGINE": DB_ENGINE,
            "NAME": os.getenv("DB_NAME", str(BASE_DIR / "db.sqlite3")) if DB_ENGINE == "django.db.backends.sqlite3" else os.getenv("DB_NAME", "school_erp"),
            "USER": os.getenv("DB_USER", ""),
            "PASSWORD": os.getenv("DB_PASSWORD", ""),
            "HOST": os.getenv("DB_HOST", ""),
            "PORT": os.getenv("DB_PORT", ""),
            "CONN_MAX_AGE": 0,
            "CONN_HEALTH_CHECKS": True,
        }
    }

# Guarded database engine switch mapping — only applied when the
# feature flag is on and Postgres is in use (after DATABASES is defined).
if MULTI_TENANCY_ENABLED:
    if DATABASES.get("default", {}).get("ENGINE", "").startswith("django.db.backends.postgresql"):
        DATABASES["default"]["ENGINE"] = "django_tenants.postgresql_backend"
        # django-tenants recommends setting public schema name
        DATABASES["default"].setdefault("OPTIONS", {})
        DATABASES["default"]["OPTIONS"].setdefault("options", "-c search_path=public")

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTH_USER_MODEL = "users.User"

REST_FRAMEWORK = {
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "apps.tenancy.auth.TenantAwareJWTAuthentication"
        if MULTI_TENANCY_ENABLED
        else "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ),
    "DEFAULT_PAGINATION_CLASS": "config.pagination.ApiPageNumberPagination",
    "PAGE_SIZE": 25,
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
    "DEFAULT_EXCEPTION_HANDLER": "config.exception_handler.custom_exception_handler",
    "EXCEPTION_HANDLER": "config.exception_handler.custom_exception_handler",
}

REDIS_URL = os.getenv("REDIS_URL", "").strip()
if REDIS_URL:
    CACHES = {
        "default": {
            "BACKEND": "django_redis.cache.RedisCache",
            "LOCATION": REDIS_URL,
            "TIMEOUT": int(os.getenv("DJANGO_CACHE_TIMEOUT", "300")),
            "OPTIONS": {
                "CLIENT_CLASS": "django_redis.client.DefaultClient",
                "SOCKET_CONNECT_TIMEOUT": 3,
                "SOCKET_TIMEOUT": 3,
            },
        }
    }
else:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "eskoolia-default-cache",
            "TIMEOUT": int(os.getenv("DJANGO_CACHE_TIMEOUT", "300")),
        }
    }

SPECTACULAR_SETTINGS = {
    "TITLE": "School ERP API",
    "DESCRIPTION": "Rewrite API contracts for School ERP",
    "VERSION": "1.0.0",
}

CORS_ALLOW_ALL_ORIGINS = True
CORS_ALLOW_CREDENTIALS = True
# Trust dev-tunnel origins for CSRF (POST/PUT/DELETE from the tunneled frontend).
CSRF_TRUSTED_ORIGINS = [
    "https://*.devtunnels.ms",
    "https://*.inc1.devtunnels.ms",
    "https://*.usw3.devtunnels.ms",
    "https://*.githubpreview.dev",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

# JWT Configuration for longer token lifespan
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": os.getenv("JWT_ACCESS_TOKEN_LIFETIME", default=24 * 60),  # 24 hours (in minutes)
    "REFRESH_TOKEN_LIFETIME": os.getenv("JWT_REFRESH_TOKEN_LIFETIME", default=30 * 24 * 60),  # 30 days
    "ALGORITHM": "HS256",
    "SIGNING_KEY": SECRET_KEY,
}

# Convert minutes to timedelta for django-rest-simplejwt
try:
    SIMPLE_JWT["ACCESS_TOKEN_LIFETIME"] = timedelta(
        minutes=int(SIMPLE_JWT["ACCESS_TOKEN_LIFETIME"])
    )
    SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"] = timedelta(
        minutes=int(SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"])
    )
except (ValueError, TypeError):
    pass

CELERY_BROKER_URL = REDIS_URL or "redis://127.0.0.1:6379/0"
CELERY_RESULT_BACKEND = CELERY_BROKER_URL
# NOTE: CELERY_BEAT_SCHEDULE is defined in config/celery.py to avoid
# importing celery.schedules at Django settings load time, which deadlocks
# on Windows when daphne (or any non-python entry-point) starts the server.

# Optional AI suggestion settings for student category descriptions
CATEGORY_AI_SUGGESTION_ENABLED = os.getenv("CATEGORY_AI_SUGGESTION_ENABLED", "False").lower() == "true"

# ── Email / SMTP ────────────────────────────────────────────────────────────
EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST = "smtp.gmail.com"
EMAIL_PORT = 587
EMAIL_USE_TLS = True
EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "")
DEFAULT_FROM_EMAIL = EMAIL_HOST_USER or "noreply@eskoolia.com"
CATEGORY_AI_OPENAI_API_KEY = os.getenv("CATEGORY_AI_OPENAI_API_KEY", "").strip()
CATEGORY_AI_OPENAI_ENDPOINT = os.getenv(
    "CATEGORY_AI_OPENAI_ENDPOINT",
    "https://api.openai.com/v1/chat/completions",
).strip()
CATEGORY_AI_OPENAI_MODEL = os.getenv("CATEGORY_AI_OPENAI_MODEL", "gpt-4o-mini").strip()

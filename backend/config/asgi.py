import os
import sys
from pathlib import Path

# Normalise sys.path so the backend root is represented by exactly one
# resolved absolute entry.  When daphne (or any -m invocation) adds '' or
# '.' to sys.path, Django's AppConfig._path_from_module sees two filesystem
# locations for the same package and raises ImproperlyConfigured.
_backend_dir = str(Path(__file__).resolve().parent.parent)
sys.path = [p for p in sys.path if p and str(Path(p).resolve()) != _backend_dir]
sys.path.insert(0, _backend_dir)

from channels.auth import AuthMiddlewareStack
from channels.routing import ProtocolTypeRouter, URLRouter
from django.core.asgi import get_asgi_application

from apps.chat.routing import websocket_urlpatterns as chat_patterns
from apps.transport.routing import websocket_urlpatterns as transport_patterns

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.production")

django_asgi_app = get_asgi_application()

# Combine all WebSocket URL patterns
all_websocket_patterns = chat_patterns + transport_patterns

application = ProtocolTypeRouter(
	{
		"http": django_asgi_app,
		"websocket": AuthMiddlewareStack(URLRouter(all_websocket_patterns)),
	}
)

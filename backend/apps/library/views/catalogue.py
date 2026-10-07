from apps.library.models import Book, BookCategory
from apps.library.serializers import BookCategorySerializer, BookSerializer

from .base import LibraryViewSet


class BookCategoryViewSet(LibraryViewSet):
    model = BookCategory
    serializer_class = BookCategorySerializer
    select_related_fields = ("created_by", "updated_by")
    filterset_fields = ["is_active"]
    search_fields = ["name", "description"]
    ordering_fields = ["name", "created_at"]
    default_ordering = ["name"]
    permission_codes = {
        "list": "library.book_categories.view",
        "retrieve": "library.book_categories.view",
        "create": "library.book_categories.create",
        "update": "library.book_categories.update",
        "destroy": "library.book_categories.delete",
    }


class BookViewSet(LibraryViewSet):
    model = Book
    serializer_class = BookSerializer
    select_related_fields = ("category", "created_by", "updated_by")
    filterset_fields = ["category", "rack"]
    search_fields = ["title", "author", "isbn", "publisher"]
    ordering_fields = ["title", "available_quantity", "created_at"]
    default_ordering = ["title"]
    permission_codes = {
        "list": "library.books.view",
        "retrieve": "library.books.view",
        "create": "library.books.create",
        "update": "library.books.update",
        "destroy": "library.books.delete",
    }

from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    BookCategoryViewSet,
    BookCopyViewSet,
    BookIssueViewSet,
    BookViewSet,
    LibraryMemberViewSet,
    LibrarySettingsView,
)

router = DefaultRouter()
router.register("categories", BookCategoryViewSet, basename="library-category")
router.register("books", BookViewSet, basename="library-book")
router.register("copies", BookCopyViewSet, basename="library-copy")
router.register("members", LibraryMemberViewSet, basename="library-member")
router.register("issues", BookIssueViewSet, basename="library-issue")

urlpatterns = [
    path("settings/", LibrarySettingsView.as_view(), name="library-settings"),
    *router.urls,
]

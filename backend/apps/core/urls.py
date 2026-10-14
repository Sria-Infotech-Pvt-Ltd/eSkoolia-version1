from rest_framework.routers import DefaultRouter
from django.urls import path
from .views import (
    AcademicYearViewSet,
    ClassPeriodViewSet,
    ClassRoomViewSet,
    ClassViewSet,
    LevelScheduleConfigViewSet,
    SectionViewSet,
    SectionReplaceView,
    SectionBulkDeleteView,
    StreamViewSet,
    SubjectViewSet,
    ItemCategoryViewSet,
    ItemStoreViewSet,
    SupplierViewSet,
    ItemViewSet,
    ItemReceiveViewSet,
    ItemIssueViewSet,
    ItemSellViewSet,
    PincodeLookupView,
)
from .views import HolidayViewSet

router = DefaultRouter()
router.register("academic-years", AcademicYearViewSet, basename="academic-year")
router.register("classes", ClassViewSet, basename="class")
router.register("sections", SectionViewSet, basename="section")
router.register("streams", StreamViewSet, basename="stream")
router.register("subjects", SubjectViewSet, basename="subject")
router.register("class-periods", ClassPeriodViewSet, basename="class-period")
router.register("class-rooms", ClassRoomViewSet, basename="class-room")
router.register("level-schedule-configs", LevelScheduleConfigViewSet, basename="level-schedule-config")

# Transport routes moved to apps.transport.urls (still served at /api/v1/core/ - see config/urls.py)

# Inventory Module Routes
router.register("item-categories", ItemCategoryViewSet, basename="item-category")
router.register("item-stores", ItemStoreViewSet, basename="item-store")
router.register("suppliers", SupplierViewSet, basename="supplier")
router.register("items", ItemViewSet, basename="item")
router.register("item-receives", ItemReceiveViewSet, basename="item-receive")
router.register("item-issues", ItemIssueViewSet, basename="item-issue")
router.register("item-sells", ItemSellViewSet, basename="item-sell")

# Holiday Calendar
router.register("holidays", HolidayViewSet, basename="holiday")

urlpatterns = [
    # Section standalone API views (registered before router to take priority)
    path("sections/replace/", SectionReplaceView.as_view(), name="section-replace"),
    path("sections/bulk-delete/", SectionBulkDeleteView.as_view(), name="section-bulk-delete"),
    path("pincode-lookup/", PincodeLookupView.as_view(), name="pincode-lookup"),
] + router.urls

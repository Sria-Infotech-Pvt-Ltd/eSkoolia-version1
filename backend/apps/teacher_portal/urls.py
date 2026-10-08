from django.urls import path
from .library_views import (
    LibraryBookRequestsView,
    LibraryBookSearchView,
    LibraryMyBooksView,
    LibraryMyClassView,
    LibraryOverviewView,
    LibraryRemindView,
    LibraryRenewView,
)
from .views import (
    TeacherMeView,
    TeacherTimetableView,
    MyClassesView,
    StudentListView,
    StudentProfileView,
    StudentCredentialsView,
    StudentResetPasswordView,
    TeacherAttendanceFetchView,
    TeacherAttendanceStoreView,
    HomeworkListCreateView,
    HomeworkDetailView,
    HomeworkSubmissionsListView,
    HomeworkSubmissionGradeView,
    LessonGroupListCreateView,
    LessonPlanListCreateView,
    LessonPlanDetailView,
    LessonTopicListView,
    TeacherNoticesView,
    TeacherMessagesView,
    StudentResultsView,
    # Sprint 8 — Marks Entry
    TeacherExamListView,
    TeacherExamStudentsView,
    TeacherExamMarksSaveView,
    TeacherExamMarksLockView,
    # Sprint 8 — Notification Bell
    TeacherNotificationListView,
    TeacherNotificationMarkReadView,
)

urlpatterns = [
    path("me/",                          TeacherMeView.as_view(),               name="teacher-me"),
    path("timetable/",                   TeacherTimetableView.as_view(),        name="teacher-timetable"),
    # Sprint 3
    path("my-classes/",                  MyClassesView.as_view(),               name="teacher-my-classes"),
    path("students/",                    StudentListView.as_view(),              name="teacher-students"),
    # Sprint 4
    path("students/<int:pk>/",           StudentProfileView.as_view(),          name="teacher-student-profile"),
    # Sprint 5 — Credentials
    path("students/<int:pk>/credentials/",        StudentCredentialsView.as_view(),      name="teacher-student-credentials"),
    path("students/<int:pk>/reset-password/",     StudentResetPasswordView.as_view(),    name="teacher-student-reset-password"),
    # Sprint 5 — Attendance
    path("attendance/students/",         TeacherAttendanceFetchView.as_view(),  name="teacher-attendance-fetch"),
    path("attendance/store/",            TeacherAttendanceStoreView.as_view(),  name="teacher-attendance-store"),
    # Sprint 6 — Homework
    path("homework/",                            HomeworkListCreateView.as_view(),       name="teacher-homework-list-create"),
    path("homework/<int:pk>/",                    HomeworkDetailView.as_view(),           name="teacher-homework-detail"),
    path("homework/<int:pk>/submissions/",        HomeworkSubmissionsListView.as_view(),  name="teacher-homework-submissions"),
    path("homework/submissions/<int:pk>/grade/",  HomeworkSubmissionGradeView.as_view(),  name="teacher-homework-submission-grade"),
    # Sprint 6 — Lesson Plans
    path("lesson-groups/",               LessonGroupListCreateView.as_view(),   name="teacher-lesson-groups-list-create"),
    path("lessons/",                     LessonPlanListCreateView.as_view(),    name="teacher-lessons-list-create"),
    path("lessons/<int:pk>/",            LessonPlanDetailView.as_view(),        name="teacher-lesson-detail"),
    path("lesson-topics/",               LessonTopicListView.as_view(),         name="teacher-lesson-topics"),
    # Sprint 6 — Student Results tab
    path("students/<int:pk>/results/",   StudentResultsView.as_view(),          name="teacher-student-results"),
    # Sprint 7 — Notices & Messages
    path("notices/",                     TeacherNoticesView.as_view(),          name="teacher-notices"),
    path("messages/",                    TeacherMessagesView.as_view(),         name="teacher-messages"),
    # Sprint 8 — Marks Entry
    path("exam-marks/",                  TeacherExamListView.as_view(),         name="teacher-exam-marks-list"),
    path("exam-marks/students/",         TeacherExamStudentsView.as_view(),     name="teacher-exam-marks-students"),
    path("exam-marks/save/",             TeacherExamMarksSaveView.as_view(),    name="teacher-exam-marks-save"),
    path("exam-marks/lock/",             TeacherExamMarksLockView.as_view(),    name="teacher-exam-marks-lock"),
    # Sprint 8 — Notification Bell
    path("notifications/",               TeacherNotificationListView.as_view(),         name="teacher-notifications"),
    path("notifications/<int:pk>/read/", TeacherNotificationMarkReadView.as_view(),     name="teacher-notification-read"),
    # Library
    path("library/overview/",                                   LibraryOverviewView.as_view(),     name="teacher-library-overview"),
    path("library/my-class/",                                   LibraryMyClassView.as_view(),      name="teacher-library-my-class"),
    path("library/my-class/loans/<int:issue_id>/remind/",       LibraryRemindView.as_view(),       name="teacher-library-remind"),
    path("library/my-books/",                                   LibraryMyBooksView.as_view(),      name="teacher-library-my-books"),
    path("library/my-books/loans/<int:issue_id>/renew/",        LibraryRenewView.as_view(),        name="teacher-library-renew"),
    path("library/book-requests/",                              LibraryBookRequestsView.as_view(), name="teacher-library-book-requests"),
    path("library/books/search/",                               LibraryBookSearchView.as_view(),   name="teacher-library-book-search"),
]


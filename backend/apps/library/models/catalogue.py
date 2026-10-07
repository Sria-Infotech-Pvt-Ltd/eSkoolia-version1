from django.db import models

from .base import LibraryAuditModel


class BookCategory(LibraryAuditModel):
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="book_categories")
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "library_book_categories"
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["school", "name"], name="uq_lib_cat_school_name"),
        ]

    def __str__(self):
        return self.name


class Book(LibraryAuditModel):
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="books")
    category = models.ForeignKey(BookCategory, on_delete=models.SET_NULL, null=True, blank=True, related_name="books")
    title = models.CharField(max_length=255)
    author = models.CharField(max_length=180, blank=True)
    isbn = models.CharField(max_length=40, blank=True)
    publisher = models.CharField(max_length=180, blank=True)
    quantity = models.PositiveIntegerField(default=0)
    available_quantity = models.PositiveIntegerField(default=0)
    rack = models.CharField(max_length=50, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "library_books"
        ordering = ["title"]
        constraints = [
            models.UniqueConstraint(fields=["school", "title", "author"], name="uq_lib_book_title_author"),
        ]

    def __str__(self):
        return self.title

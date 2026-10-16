from django.test import TestCase
from apps.tenancy.models import School
from apps.exams.models import ExamType
from decimal import Decimal

class ExamTypeModelTest(TestCase):
    def setUp(self):
        self.school = School.objects.create(name="Eskoolia Demo School", subdomain="demo")
        
        self.exam_type = ExamType.objects.create(
            school=self.school,
            title="Midterm Exam",
            description="Testing midterms",
            is_active=True,
            average_mark=Decimal("50.00"),
            weight_percent=Decimal("30.00")
        )

    def test_exam_type_creation(self):
        self.assertEqual(self.exam_type.title, "Midterm Exam")
        self.assertEqual(self.exam_type.average_mark, Decimal("50.00"))
        self.assertTrue(self.exam_type.is_active)

    def test_exam_type_string_representation(self):
        self.assertEqual(str(self.exam_type), "Midterm Exam")

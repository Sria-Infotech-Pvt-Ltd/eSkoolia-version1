from django.contrib import admin
from .models import AcademicYear, Class, ClassPeriod, Section, Subject, ClassRoom

admin.site.register(AcademicYear)
admin.site.register(Class)
admin.site.register(Section)
admin.site.register(Subject)
admin.site.register(ClassPeriod)
admin.site.register(ClassRoom)

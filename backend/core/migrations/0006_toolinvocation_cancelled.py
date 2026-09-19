from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0005_persistent_chat_runs")]
    operations = [
        migrations.AlterField(
            model_name="toolinvocation",
            name="status",
            field=models.CharField(
                choices=[("pending", "pending"), ("approved", "approved"), ("declined", "declined"), ("cancelled", "cancelled"), ("completed", "completed"), ("failed", "failed")],
                default="pending",
                max_length=16,
            ),
        ),
    ]

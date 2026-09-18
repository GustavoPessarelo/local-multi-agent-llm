from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("core", "0003_backfill_conversation_titles")]
    operations = [
        migrations.AlterField(
            model_name="flowrun",
            name="flow_version",
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="runs", to="core.flowversion"),
        ),
    ]

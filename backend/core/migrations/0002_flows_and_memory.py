from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("core", "0001_initial")]

    operations = [
        migrations.CreateModel(
            name="Flow",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=120)),
                ("description", models.TextField(blank=True)),
                ("active_version", models.PositiveIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="flows", to="core.project")),
            ],
            options={"ordering": ["-updated_at"]},
        ),
        migrations.CreateModel(
            name="MemoryEntry",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("kind", models.CharField(choices=[("episodic", "episodic"), ("long_term", "long_term"), ("project", "project")], max_length=20)),
                ("content", models.TextField()),
                ("source_type", models.CharField(blank=True, max_length=40)),
                ("source_id", models.CharField(blank=True, max_length=80)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("embedding", models.JSONField(blank=True, default=list)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("conversation", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="memories", to="core.conversation")),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="memories", to="core.project")),
            ],
            options={"ordering": ["-updated_at"]},
        ),
        migrations.CreateModel(
            name="FlowVersion",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("version", models.PositiveIntegerField()),
                ("graph", models.JSONField(default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("flow", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="versions", to="core.flow")),
            ],
            options={"ordering": ["-version"]},
        ),
        migrations.AddConstraint(
            model_name="flowversion",
            constraint=models.UniqueConstraint(fields=("flow", "version"), name="unique_flow_version"),
        ),
        migrations.CreateModel(
            name="FlowRun",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("task", models.TextField()),
                ("status", models.CharField(choices=[("queued", "queued"), ("running", "running"), ("awaiting_approval", "awaiting_approval"), ("completed", "completed"), ("failed", "failed")], default="queued", max_length=24)),
                ("current_node", models.CharField(blank=True, max_length=80)),
                ("trace", models.JSONField(blank=True, default=list)),
                ("output", models.TextField(blank=True)),
                ("error", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("started_at", models.DateTimeField(blank=True, null=True)),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
                ("conversation", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="flow_runs", to="core.conversation")),
                ("flow_version", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="runs", to="core.flowversion")),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.AddField(model_name="toolinvocation", name="flow_node_id", field=models.CharField(blank=True, max_length=80)),
        migrations.AddField(model_name="toolinvocation", name="flow_run", field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="tool_invocations", to="core.flowrun")),
    ]

from django.db import migrations, models
import django.db.models.deletion


def migrate_flow_graphs(apps, schema_editor):
    FlowVersion = apps.get_model("core", "FlowVersion")
    for version in FlowVersion.objects.all().iterator():
        graph = dict(version.graph or {})
        nodes = list(graph.get("nodes") or [])
        edges = list(graph.get("edges") or [])
        if not nodes:
            continue
        incoming = {str(edge.get("target")) for edge in edges}
        root_id = graph.get("rootId") or next((str(node.get("id")) for node in nodes if str(node.get("id")) not in incoming), str(nodes[0].get("id")))
        cleaned = []
        for node in nodes:
            value = dict(node)
            value["systemPrompt"] = str(value.get("systemPrompt") or value.get("prompt") or "")
            for legacy in ("prompt", "model", "tools", "memory"):
                value.pop(legacy, None)
            cleaned.append(value)
        graph["nodes"] = cleaned
        graph["edges"] = edges
        graph["rootId"] = root_id
        version.graph = graph
        version.save(update_fields=["graph"])


class Migration(migrations.Migration):
    dependencies = [("core", "0004_flowrun_cascade")]

    operations = [
        migrations.AddField(model_name="flowrun", name="cancel_requested", field=models.BooleanField(default=False)),
        migrations.AddField(model_name="flowrun", name="profiling_enabled", field=models.BooleanField(default=False)),
        migrations.AddField(model_name="flowrun", name="profiling_file", field=models.CharField(blank=True, max_length=512)),
        migrations.AlterField(
            model_name="flowrun", name="status",
            field=models.CharField(choices=[("queued", "queued"), ("running", "running"), ("awaiting_approval", "awaiting_approval"), ("cancelling", "cancelling"), ("cancelled", "cancelled"), ("completed", "completed"), ("failed", "failed")], default="queued", max_length=24),
        ),
        migrations.CreateModel(
            name="ChatRun",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("model", models.CharField(max_length=255)),
                ("enabled_tools", models.JSONField(blank=True, default=list)),
                ("profiling_enabled", models.BooleanField(default=False)),
                ("status", models.CharField(choices=[("queued", "queued"), ("running", "running"), ("awaiting_approval", "awaiting_approval"), ("cancelling", "cancelling"), ("cancelled", "cancelled"), ("completed", "completed"), ("failed", "failed")], default="queued", max_length=24)),
                ("current_agent", models.CharField(blank=True, max_length=80)),
                ("events", models.JSONField(blank=True, default=list)),
                ("output", models.TextField(blank=True)),
                ("error", models.TextField(blank=True)),
                ("cancel_requested", models.BooleanField(default=False)),
                ("profiling_file", models.CharField(blank=True, max_length=512)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("started_at", models.DateTimeField(blank=True, null=True)),
                ("first_token_at", models.DateTimeField(blank=True, null=True)),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
                ("conversation", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="chat_runs", to="core.conversation")),
                ("flow_version", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="chat_runs", to="core.flowversion")),
                ("user_message", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="started_runs", to="core.message")),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.AddField(
            model_name="toolinvocation", name="chat_run",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="tool_invocations", to="core.chatrun"),
        ),
        migrations.RunPython(migrate_flow_graphs, migrations.RunPython.noop),
    ]

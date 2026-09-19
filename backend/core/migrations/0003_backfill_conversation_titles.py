from django.db import migrations


def backfill_titles(apps, schema_editor):
    Conversation = apps.get_model("core", "Conversation")
    Message = apps.get_model("core", "Message")
    for conversation in Conversation.objects.filter(title="Nova conversa"):
        content = Message.objects.filter(conversation=conversation, role="user").order_by("created_at").values_list("content", flat=True).first()
        if not content:
            continue
        compact = " ".join(content.split())
        conversation.title = compact[:64] + ("…" if len(compact) > 64 else "")
        conversation.save(update_fields=["title"])


class Migration(migrations.Migration):
    dependencies = [("core", "0002_flows_and_memory")]
    operations = [migrations.RunPython(backfill_titles, migrations.RunPython.noop)]

from django.db import models


class Project(models.Model):
    name = models.CharField(max_length=120)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]


class Conversation(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="conversations")
    title = models.CharField(max_length=160, default="Nova conversa")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]


class Message(models.Model):
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="messages")
    role = models.CharField(max_length=16, choices=[("user", "user"), ("assistant", "assistant"), ("tool", "tool")])
    content = models.TextField()
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]


class Resource(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="resources")
    name = models.CharField(max_length=255)
    relative_path = models.CharField(max_length=512)
    mime_type = models.CharField(max_length=120, blank=True)
    size_bytes = models.PositiveIntegerField()
    text_preview = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class ToolDefinition(models.Model):
    name = models.SlugField(unique=True, max_length=80)
    display_name = models.CharField(max_length=120)
    description = models.TextField()
    input_schema = models.JSONField(default=dict)
    requires_approval = models.BooleanField(default=True)
    enabled = models.BooleanField(default=True)
    version = models.CharField(max_length=20, default="1.0.0")


class ToolInvocation(models.Model):
    STATUS = [("pending", "pending"), ("approved", "approved"), ("declined", "declined"), ("cancelled", "cancelled"), ("completed", "completed"), ("failed", "failed")]
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="tool_invocations")
    conversation = models.ForeignKey(Conversation, on_delete=models.SET_NULL, related_name="tool_invocations", null=True, blank=True)
    flow_run = models.ForeignKey("FlowRun", on_delete=models.SET_NULL, related_name="tool_invocations", null=True, blank=True)
    chat_run = models.ForeignKey("ChatRun", on_delete=models.SET_NULL, related_name="tool_invocations", null=True, blank=True)
    flow_node_id = models.CharField(max_length=80, blank=True)
    tool = models.ForeignKey(ToolDefinition, on_delete=models.PROTECT)
    arguments = models.JSONField(default=dict)
    result = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=16, choices=STATUS, default="pending")
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)


class MemoryEntry(models.Model):
    KINDS = [("episodic", "episodic"), ("long_term", "long_term"), ("project", "project")]
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="memories")
    conversation = models.ForeignKey(Conversation, on_delete=models.SET_NULL, related_name="memories", null=True, blank=True)
    kind = models.CharField(max_length=20, choices=KINDS)
    content = models.TextField()
    source_type = models.CharField(max_length=40, blank=True)
    source_id = models.CharField(max_length=80, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    embedding = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]


class Flow(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="flows")
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    active_version = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]


class FlowVersion(models.Model):
    flow = models.ForeignKey(Flow, on_delete=models.CASCADE, related_name="versions")
    version = models.PositiveIntegerField()
    graph = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-version"]
        constraints = [models.UniqueConstraint(fields=["flow", "version"], name="unique_flow_version")]


class FlowRun(models.Model):
    STATUSES = [("queued", "queued"), ("running", "running"), ("awaiting_approval", "awaiting_approval"), ("cancelling", "cancelling"), ("cancelled", "cancelled"), ("completed", "completed"), ("failed", "failed")]
    flow_version = models.ForeignKey(FlowVersion, on_delete=models.CASCADE, related_name="runs")
    conversation = models.ForeignKey(Conversation, on_delete=models.SET_NULL, related_name="flow_runs", null=True, blank=True)
    task = models.TextField()
    status = models.CharField(max_length=24, choices=STATUSES, default="queued")
    current_node = models.CharField(max_length=80, blank=True)
    trace = models.JSONField(default=list, blank=True)
    output = models.TextField(blank=True)
    error = models.TextField(blank=True)
    cancel_requested = models.BooleanField(default=False)
    profiling_enabled = models.BooleanField(default=False)
    profiling_file = models.CharField(max_length=512, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]


class ChatRun(models.Model):
    STATUSES = [
        ("queued", "queued"),
        ("running", "running"),
        ("awaiting_approval", "awaiting_approval"),
        ("cancelling", "cancelling"),
        ("cancelled", "cancelled"),
        ("completed", "completed"),
        ("failed", "failed"),
    ]
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="chat_runs")
    flow_version = models.ForeignKey(FlowVersion, on_delete=models.SET_NULL, related_name="chat_runs", null=True, blank=True)
    user_message = models.ForeignKey(Message, on_delete=models.SET_NULL, related_name="started_runs", null=True, blank=True)
    model = models.CharField(max_length=255)
    enabled_tools = models.JSONField(default=list, blank=True)
    profiling_enabled = models.BooleanField(default=False)
    status = models.CharField(max_length=24, choices=STATUSES, default="queued")
    current_agent = models.CharField(max_length=80, blank=True)
    events = models.JSONField(default=list, blank=True)
    output = models.TextField(blank=True)
    error = models.TextField(blank=True)
    cancel_requested = models.BooleanField(default=False)
    profiling_file = models.CharField(max_length=512, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    first_token_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]


class AuditEvent(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="audit_events")
    event_type = models.CharField(max_length=80)
    payload = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

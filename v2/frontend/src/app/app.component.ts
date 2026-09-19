import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ApiService, ChatMessage, ChatRun, Conversation, Flow, FlowEdge, FlowGraph, FlowNode,
  FlowTemplate, MemoryEntry, Project, Resource, RunEvent, SearchResult, Tool,
} from './api.service';

type Page = 'chat' | 'flows' | 'config';
type ConfigTab = 'memory' | 'tools' | 'resources';
type Approval = { id: number; tool: string; arguments: Record<string, unknown>; created: boolean; chatRunId?: number };
type DeleteTarget = { type: 'conversation' | 'project'; id: number; name: string };
type TraceFilter = 'all' | 'agents' | 'tools' | 'errors';

@Component({
  selector: 'lap-root', standalone: true, imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html', styleUrl: './app.component.css',
})
export class AppComponent implements OnInit, OnDestroy {
  authenticated = false;
  authChecked = false;
  username = '';
  loginUser = '';
  loginPassword = '';
  loginBusy = false;
  page: Page = 'chat';
  configTab: ConfigTab = 'memory';
  projects: Project[] = [];
  conversations: Conversation[] = [];
  resources: Resource[] = [];
  tools: Tool[] = [];
  models: string[] = [];
  messages: ChatMessage[] = [];
  flows: Flow[] = [];
  flowTemplates: FlowTemplate[] = [];
  flowVersions: Array<{id: number; version: number; graph: FlowGraph; createdAt: string}> = [];
  memories: MemoryEntry[] = [];
  searchResults: SearchResult[] = [];
  project: Project | null = null;
  conversation: Conversation | null = null;
  selectedFlow: Flow | null = null;
  selectedChatFlowId: number | null = null;
  graph: FlowGraph = {rootId: '', nodes: [], edges: []};
  selectedNode: FlowNode | null = null;
  connectingFromId = '';
  currentRun: ChatRun | null = null;
  runEvents: RunEvent[] = [];
  traceRun: ChatRun | null = null;
  traceOpen = false;
  traceLoading = false;
  traceFilter: TraceFilter = 'all';
  traceQuery = '';
  selectedTraceEventId: number | null = null;
  model = 'google/gemma-3-4b';
  input = '';
  newProjectName = '';
  editingConversationTitle = '';
  error = '';
  notice = '';
  generationStatus = '';
  profilingEnabled = false;
  busy = false;
  creatingConversation = false;
  savingFlow = false;
  approval: Approval | null = null;
  deleteTarget: DeleteTarget | null = null;
  selectedTool = '';
  enabledTools: string[] = [];
  toolResourceId: number | null = null;
  toolQuery = 'SELECT * FROM source LIMIT 20';
  memoryKind: MemoryEntry['kind'] = 'project';
  memoryContent = '';
  memoryQuery = '';
  memoryBusy = false;
  private projectLoadToken = 0;
  private streamController?: AbortController;

  constructor(private readonly api: ApiService, private readonly changeDetector: ChangeDetectorRef) {}

  async ngOnInit() {
    try {
      const session = await this.api.session();
      this.authenticated = session.authenticated;
      this.username = session.username;
      if (this.authenticated) await this.initializeData();
    } catch (error) { this.fail(error); }
    finally { this.authChecked = true; this.render(); }
  }

  ngOnDestroy() { this.streamController?.abort(); }

  navigate(page: Page) { this.page = page; this.render(); }
  setConfigTab(tab: ConfigTab) { this.configTab = tab; this.render(); }

  async login() {
    if (!this.loginUser.trim() || !this.loginPassword || this.loginBusy) return;
    this.loginBusy = true;
    this.error = '';
    try {
      const session = await this.api.login(this.loginUser.trim(), this.loginPassword);
      this.authenticated = true;
      this.username = session.username;
      this.loginPassword = '';
      await this.initializeData();
    } catch (error) { this.fail(error); }
    finally { this.loginBusy = false; this.render(); }
  }

  async logout() {
    if (this.busy) await this.stopGeneration();
    await this.api.logout();
    this.authenticated = false;
    this.username = '';
    this.projects = [];
    this.render();
  }

  private async initializeData() {
    const [projects, tools, templates] = await Promise.all([this.api.projects(), this.api.tools(), this.api.flowTemplates()]);
    this.projects = projects.projects;
    this.tools = tools.tools;
    this.flowTemplates = templates.templates;
    this.selectedTool = this.tools[0]?.name ?? '';
    try {
      this.models = (await this.api.models()).data.map(item => item.id).filter(id => !id.toLowerCase().includes('embed'));
      if (!this.models.includes(this.model) && this.models[0]) this.model = this.models[0];
    } catch { this.models = [this.model]; }
    if (this.projects[0]) await this.selectProject(this.projects[0]);
    else await this.createProject('Meu primeiro projeto');
  }

  async createProject(name = this.newProjectName) {
    if (!name.trim()) return;
    try {
      const response = await this.api.createProject(name.trim());
      this.projects = [response.project, ...this.projects];
      this.newProjectName = '';
      await this.selectProject(response.project);
    } catch (error) { this.fail(error); }
    finally { this.render(); }
  }

  async selectProject(project: Project) {
    if (this.busy) return;
    const token = ++this.projectLoadToken;
    this.project = project;
    this.conversation = null;
    this.messages = [];
    this.selectedFlow = null;
    this.selectedChatFlowId = null;
    try {
      const [conversations, resources, flows, memories] = await Promise.all([
        this.api.conversations(project.id), this.api.resources(project.id), this.api.flows(project.id), this.api.memories(project.id),
      ]);
      if (token !== this.projectLoadToken) return;
      this.conversations = conversations.conversations;
      this.resources = resources.resources;
      this.flows = flows.flows;
      this.memories = memories.memories;
      if (this.conversations[0]) await this.selectConversation(this.conversations[0]); else await this.newConversation();
      if (this.flows[0]) await this.selectFlow(this.flows[0]);
    } catch (error) { this.fail(error); }
    finally { this.render(); }
  }

  async newConversation() {
    if (!this.project || this.creatingConversation || this.busy) return;
    this.creatingConversation = true;
    try {
      const response = await this.api.createConversation(this.project.id);
      this.conversations = [response.conversation, ...this.conversations.filter(item => item.id !== response.conversation.id)];
      this.page = 'chat';
      await this.selectConversation(response.conversation);
    } catch (error) { this.fail(error); }
    finally { this.creatingConversation = false; this.render(); }
  }

  async selectConversation(conversation: Conversation) {
    if (this.busy) return;
    this.closeTrace();
    this.conversation = conversation;
    this.editingConversationTitle = conversation.title;
    try { this.messages = (await this.api.messages(conversation.id)).messages; }
    catch (error) { this.fail(error); }
    finally { this.render(); }
  }

  async renameConversation() {
    const title = this.editingConversationTitle.trim();
    if (!this.conversation || !title || title === this.conversation.title) return;
    try {
      const result = await this.api.renameConversation(this.conversation.id, title);
      this.conversation = result.conversation;
      this.conversations = this.conversations.map(item => item.id === result.conversation.id ? result.conversation : item);
      this.notice = 'Conversa renomeada.';
    } catch (error) { this.fail(error); }
    finally { this.render(); }
  }

  confirmDeleteConversation(item: Conversation, event?: Event) { event?.stopPropagation(); this.deleteTarget = {type: 'conversation', id: item.id, name: item.title}; this.render(); }
  confirmDeleteProject(item: Project, event?: Event) { event?.stopPropagation(); this.deleteTarget = {type: 'project', id: item.id, name: item.name}; this.render(); }
  cancelDelete() { this.deleteTarget = null; this.render(); }

  async executeDelete() {
    const target = this.deleteTarget;
    if (!target) return;
    this.deleteTarget = null;
    this.render();
    try {
      if (target.type === 'conversation') {
        await this.api.deleteConversation(target.id);
        this.conversations = this.conversations.filter(item => item.id !== target.id);
        if (this.conversation?.id === target.id) {
          this.conversation = null; this.messages = [];
          if (this.conversations[0]) await this.selectConversation(this.conversations[0]); else await this.newConversation();
        }
        this.notice = 'Conversa excluída.';
      } else {
        await this.api.deleteProject(target.id);
        this.projects = this.projects.filter(item => item.id !== target.id);
        if (this.project?.id === target.id) {
          this.project = null; this.conversation = null; this.messages = []; this.conversations = []; this.flows = [];
          if (this.projects[0]) await this.selectProject(this.projects[0]);
        }
        this.notice = 'Projeto excluído.';
      }
    } catch (error) { this.fail(error); }
    finally { this.render(); }
  }

  titleKeydown(event: KeyboardEvent) { if (event.key === 'Enter') { event.preventDefault(); void this.renameConversation(); } }
  onComposerKeydown(event: KeyboardEvent) { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void this.send(); } }

  async send() {
    if (!this.input.trim() || !this.conversation || this.busy) return;
    const content = this.input.trim();
    const conversationId = this.conversation.id;
    this.input = '';
    this.messages = [...this.messages, {role: 'user', content}, {role: 'assistant', content: ''}];
    this.runEvents = [];
    this.busy = true;
    this.generationStatus = 'Aguardando worker local…';
    this.error = '';
    this.render();
    try {
      const response = await this.api.startChat(conversationId, {
        content, model: this.model, enabled_tools: this.enabledTools,
        flow_id: this.selectedChatFlowId, profiling_enabled: this.profilingEnabled,
      });
      this.currentRun = response.run;
      const placeholder = this.messages[this.messages.length - 1];
      if (placeholder?.role === 'assistant') placeholder.metadata = {chatRunId: response.run.id};
      await this.refreshConversations(conversationId);
      await this.followRun(response.run.id, 0);
    } catch (error) { this.fail(error); this.finishBusy(); }
  }

  async stopGeneration() {
    if (!this.currentRun || !this.busy) return;
    this.generationStatus = 'Cancelando execução…';
    this.render();
    try {
      await this.api.cancelChat(this.currentRun.id);
      this.streamController?.abort();
      this.notice = 'Geração interrompida.';
    } catch (error) { this.fail(error); }
    finally { await this.reloadConversation(); this.finishBusy(); }
  }

  private async followRun(runId: number, after: number) {
    this.streamController?.abort();
    this.streamController = new AbortController();
    try {
      const response = await fetch(`/api/chat-runs/${runId}/events?after=${after}`, {signal: this.streamController.signal});
      if (!response.ok || !response.body) throw new Error(await this.responseError(response));
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        buffer += decoder.decode(next.value, {stream: true});
        const packets = buffer.split('\n\n');
        buffer = packets.pop() ?? '';
        for (const packet of packets) this.consumePacket(packet);
      }
      const latest = (await this.api.chatRun(runId)).run;
      this.currentRun = latest;
      if (latest.status === 'awaiting_approval' && latest.pendingApproval) {
        this.approval = {...latest.pendingApproval, created: true, chatRunId: latest.id};
        this.generationStatus = 'Aguardando aprovação de tool.';
        this.render();
        return;
      }
      if (latest.status === 'failed') this.error = latest.error;
      if (latest.profilingFile) this.notice = `Profiling salvo em ${latest.profilingFile}`;
      await this.reloadConversation();
      this.finishBusy();
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') { this.fail(error); this.finishBusy(); }
    }
  }

  private consumePacket(packet: string) {
    if (!packet || packet.startsWith(':')) return;
    const type = packet.match(/^event: (.+)$/m)?.[1];
    const raw = packet.match(/^data: (.+)$/m)?.[1];
    if (!type || !raw) return;
    const payload = JSON.parse(raw) as RunEvent | ChatRun;
    if (type === 'run_state') {
      const state = payload as ChatRun;
      this.currentRun = state;
      if (this.traceRun?.id === state.id) this.traceRun = state;
      this.render();
      return;
    }
    const event = payload as RunEvent;
    if (typeof event.id === 'number') {
      this.runEvents = [...this.runEvents, event];
      if (this.currentRun) {
        this.currentRun.lastEventId = Math.max(this.currentRun.lastEventId, event.id);
        this.currentRun.events = [...this.currentRun.events.filter(item => item.id !== event.id), event];
      }
      const openTrace = this.traceRun;
      if (openTrace && this.currentRun && openTrace.id === this.currentRun.id) {
        openTrace.events = [...openTrace.events.filter(item => item.id !== event.id), event];
      }
    }
    if (type === 'run_started') this.generationStatus = 'Execução iniciada no modelo local.';
    if (type === 'agent_started') this.generationStatus = event.message ?? `${event.agentName} trabalhando…`;
    if (type === 'delegated') this.generationStatus = event.message ?? `${event.fromAgentName} delegou para ${event.toAgentName}.`;
    if (type === 'delta') {
      this.generationStatus = '';
      const last = this.messages[this.messages.length - 1];
      if (last?.role === 'assistant') last.content += event.content ?? '';
    }
    if (type === 'cancelling') this.generationStatus = 'Cancelando execução…';
    if (type === 'failed') this.error = event.error ?? 'Falha na execução local.';
    this.render();
  }

  private finishBusy() {
    this.busy = false;
    this.generationStatus = '';
    this.streamController = undefined;
    if (!this.messages[this.messages.length - 1]?.content && this.messages[this.messages.length - 1]?.role === 'assistant') this.messages = this.messages.slice(0, -1);
    this.render();
  }

  messageRunId(message: ChatMessage): number | null {
    const value = Number(message.metadata?.['chatRunId']);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  messageTraceLabel(message: ChatMessage): string {
    const agents = message.metadata?.['traceAgents'];
    if (!Array.isArray(agents) || !agents.length) return 'Ver execução';
    return agents.map(item => String((item as {name?: string}).name ?? '')).filter(Boolean).join(' → ');
  }

  async openMessageTrace(message: ChatMessage) {
    const runId = this.messageRunId(message);
    if (runId) await this.openTrace(runId);
  }

  async openCurrentTrace(event?: RunEvent) {
    if (!this.currentRun) return;
    await this.openTrace(this.currentRun.id, event?.id);
  }

  async openTrace(runId: number, eventId: number | null = null) {
    this.traceOpen = true;
    this.traceLoading = true;
    this.selectedTraceEventId = eventId;
    this.traceFilter = 'all';
    this.traceQuery = '';
    this.render();
    try {
      this.traceRun = (await this.api.chatRun(runId)).run;
    } catch (error) { this.fail(error); }
    finally { this.traceLoading = false; this.render(); }
  }

  closeTrace() {
    this.traceOpen = false;
    this.traceRun = null;
    this.selectedTraceEventId = null;
  }

  setTraceFilter(filter: TraceFilter) { this.traceFilter = filter; this.render(); }

  visibleTraceEvents(): RunEvent[] {
    const query = this.traceQuery.trim().toLowerCase();
    return (this.traceRun?.events ?? []).filter(event => {
      if (event.type === 'delta') return false;
      const isAgent = event.type.startsWith('agent_') || event.type === 'delegated';
      const isTool = event.type.startsWith('tool_');
      const isError = event.type === 'failed' || event.type === 'cancelled' || event.type === 'cancelling' || Boolean(event.error);
      if (this.traceFilter === 'agents' && !isAgent) return false;
      if (this.traceFilter === 'tools' && !isTool) return false;
      if (this.traceFilter === 'errors' && !isError) return false;
      if (!query) return true;
      return JSON.stringify(event).toLowerCase().includes(query);
    });
  }

  traceEventTitle(event: RunEvent): string {
    if (event.type === 'run_started') return 'Execução iniciada';
    if (event.type === 'agent_started') return `${event.agentName ?? 'Agente'} iniciou`;
    if (event.type === 'agent_completed') return `${event.agentName ?? 'Agente'} concluiu`;
    if (event.type === 'delegated') return `${event.fromAgentName ?? 'Agente'} → ${event.toAgentName ?? 'Agente'}`;
    if (event.type === 'tool_approval_required') return `Aprovação: ${event.tool ?? 'tool'}`;
    if (event.type === 'tool_completed') return `Tool concluída: ${event.tool ?? 'tool'}`;
    if (event.type === 'tool_declined') return `Tool recusada: ${event.tool ?? 'tool'}`;
    if (event.type === 'completed') return 'Execução concluída';
    if (event.type === 'failed') return 'Execução falhou';
    if (event.type === 'cancelled') return 'Execução cancelada';
    if (event.type === 'cancelling') return 'Cancelamento solicitado';
    return String(event.type || 'evento').replace(/_/g, ' ');
  }

  traceEventSummary(event: RunEvent): string {
    if (event.message) return event.message;
    if (event.type === 'run_started') return `Modelo local: ${this.traceRun?.model ?? ''}`;
    if (event.type === 'agent_started') return event.objective ? `Objetivo: ${event.objective.slice(0, 180)}` : 'Agente recebeu a etapa.';
    if (event.type === 'agent_completed') return event.decision === 'delegate' ? `Decidiu delegar para ${event.targetAgentName ?? event.targetAgentId}.` : 'Produziu a resposta desta etapa.';
    if (event.error) return event.error;
    return '';
  }

  traceEventIcon(event: RunEvent): string {
    if (event.type === 'failed') return '!';
    if (event.type.startsWith('tool_')) return 'T';
    if (event.type === 'delegated') return '→';
    if (event.type === 'agent_started') return 'A';
    if (event.type === 'agent_completed' || event.type === 'completed') return '✓';
    if (event.type.includes('cancel')) return '■';
    return '•';
  }

  formatDuration(duration?: number | null): string {
    if (duration === null || duration === undefined) return '—';
    return duration < 1000 ? `${duration} ms` : `${(duration / 1000).toFixed(2)} s`;
  }

  private async reloadConversation() {
    if (!this.conversation) return;
    this.messages = (await this.api.messages(this.conversation.id)).messages;
    await this.refreshConversations(this.conversation.id);
  }

  async refreshConversations(selectedId?: number) {
    if (!this.project) return;
    this.conversations = (await this.api.conversations(this.project.id)).conversations;
    const selected = this.conversations.find(item => item.id === (selectedId ?? this.conversation?.id));
    if (selected) { this.conversation = selected; this.editingConversationTitle = selected.title; }
  }

  async upload(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file || !this.project) return;
    try { const result = await this.api.upload(this.project.id, file); this.resources = [result.resource, ...this.resources]; this.notice = `${file.name} adicionado.`; }
    catch (error) { this.fail(error); } finally { this.render(); }
  }

  requestTool() {
    if (!this.project || !this.selectedTool || !this.toolResourceId) { this.error = 'Selecione uma tool e um resource.'; return; }
    const arguments_: Record<string, unknown> = {resource_id: Number(this.toolResourceId)};
    if (this.selectedTool === 'duckdb_query_csv') arguments_['query'] = this.toolQuery;
    this.approval = {id: 0, tool: this.selectedTool, arguments: arguments_, created: false};
    this.render();
  }

  async approveTool() {
    if (!this.project || !this.approval) return;
    const approval = this.approval;
    this.approval = null;
    this.render();
    try {
      const id = approval.created ? approval.id : (await this.api.invoke(this.project.id, this.conversation?.id ?? null, approval.tool, approval.arguments)).invocation.id;
      const result = await this.api.approve(id);
      if (approval.chatRunId) await this.followRun(approval.chatRunId, this.currentRun?.lastEventId ?? 0);
      else {
        this.messages = [...this.messages, {role: 'tool', content: JSON.stringify(result.invocation.result, null, 2)}];
        if (result.assistant) this.messages.push(result.assistant);
        this.page = 'chat';
      }
    } catch (error) { this.fail(error); this.finishBusy(); }
  }

  async declineTool() {
    const approval = this.approval;
    this.approval = null;
    this.render();
    if (!approval) return;
    try {
      if (approval.created) await this.api.decline(approval.id);
      if (approval.chatRunId) await this.followRun(approval.chatRunId, this.currentRun?.lastEventId ?? 0);
    } catch (error) { this.fail(error); this.finishBusy(); }
  }

  toggleAgentTool(name: string) { this.enabledTools = this.toggle(this.enabledTools, name); this.render(); }

  async createFlow(template: FlowTemplate) {
    if (!this.project) return;
    try { const result = await this.api.createFlow(this.project.id, {templateKey: template.key}); this.flows = [result.flow, ...this.flows]; await this.selectFlow(result.flow); }
    catch (error) { this.fail(error); } finally { this.render(); }
  }

  async createBlankFlow() {
    if (!this.project) return;
    const root = this.newNode(120, 160, 'Agente 1');
    const graph: FlowGraph = {rootId: root.id, nodes: [root], edges: []};
    try { const result = await this.api.createFlow(this.project.id, {name: 'Novo flow', description: 'Rede de agentes local', graph}); this.flows = [result.flow, ...this.flows]; await this.selectFlow(result.flow); }
    catch (error) { this.fail(error); } finally { this.render(); }
  }

  async selectFlow(flow: Flow) {
    try {
      const [detail, versions] = await Promise.all([this.api.flow(flow.id), this.api.flowVersions(flow.id)]);
      this.selectedFlow = detail.flow;
      this.graph = this.copyGraph(detail.flow.graph ?? {rootId: '', nodes: [], edges: []});
      this.selectedNode = this.graph.nodes[0] ?? null;
      this.flowVersions = versions.versions;
    } catch (error) { this.fail(error); } finally { this.render(); }
  }

  addAgent() {
    const index = this.graph.nodes.length;
    const node = this.newNode(120 + Math.floor(index / 4) * 300, 100 + (index % 4) * 180, `Agente ${index + 1}`);
    this.graph = {...this.graph, rootId: this.graph.rootId || node.id, nodes: [...this.graph.nodes, node]};
    this.selectedNode = node;
    this.render();
  }

  arrangeAgents() {
    this.graph.nodes.forEach((node, index) => {
      node.x = 120 + Math.floor(index / 4) * 300;
      node.y = 100 + (index % 4) * 180;
    });
    this.graph = {...this.graph, nodes: [...this.graph.nodes]};
    this.notice = 'Agentes organizados. Salve uma nova versão para persistir as posições.';
    this.render();
  }

  removeNode(node: FlowNode) {
    const nodes = this.graph.nodes.filter(item => item.id !== node.id);
    this.graph = {nodes, edges: this.graph.edges.filter(edge => edge.source !== node.id && edge.target !== node.id), rootId: this.graph.rootId === node.id ? (nodes[0]?.id ?? '') : this.graph.rootId};
    this.selectedNode = nodes[0] ?? null;
    this.render();
  }

  defineRoot(node: FlowNode) { this.graph = {...this.graph, rootId: node.id}; this.notice = `${node.name} definido como root.`; this.render(); }
  beginConnection(node: FlowNode, event: Event) {
    event.stopPropagation();
    this.connectingFromId = this.connectingFromId === node.id ? '' : node.id;
    this.selectedNode = node;
    this.notice = this.connectingFromId ? `Selecione o agente que ${node.name} poderá invocar.` : '';
    this.render();
  }
  cancelConnection() { this.connectingFromId = ''; this.render(); }
  handleNodeClick(node: FlowNode, event: Event) {
    event.stopPropagation();
    if (this.connectingFromId && this.connectingFromId !== node.id) {
      this.connectTo(node);
      return;
    }
    this.selectedNode = node;
    this.render();
  }
  connectTo(target: FlowNode) {
    const source = this.connectingFromId;
    if (!source || source === target.id) return;
    if (this.graph.edges.some(edge => edge.source === source && edge.target === target.id)) {
      this.notice = 'Essa ligação já existe.';
      this.connectingFromId = '';
      this.render();
      return;
    }
    const sourceName = this.nodeName(source);
    this.graph = {...this.graph, edges: [...this.graph.edges, {id: `e-${Date.now()}`, source, target: target.id}]};
    this.connectingFromId = '';
    this.notice = `${sourceName} agora pode invocar ${target.name}. Salve uma nova versão para persistir.`;
    this.render();
  }
  removeEdge(edge: FlowEdge) { this.graph = {...this.graph, edges: this.graph.edges.filter(item => item.id !== edge.id)}; this.render(); }

  onNodeDragStart(event: DragEvent, node: FlowNode) { event.dataTransfer?.setData('text/plain', node.id); }
  onCanvasDragOver(event: DragEvent) { event.preventDefault(); }
  onCanvasDrop(event: DragEvent) {
    event.preventDefault();
    const node = this.graph.nodes.find(item => item.id === event.dataTransfer?.getData('text/plain'));
    if (!node) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    node.x = Math.max(12, Math.round(event.clientX - rect.left - 110));
    node.y = Math.max(12, Math.round(event.clientY - rect.top - 35));
    this.graph = {...this.graph, nodes: [...this.graph.nodes]};
  }
  edgeLine(edge: FlowEdge) {
    const source = this.graph.nodes.find(node => node.id === edge.source);
    const target = this.graph.nodes.find(node => node.id === edge.target);
    return {x1: (source?.x ?? 0) + 220, y1: (source?.y ?? 0) + 55, x2: target?.x ?? 0, y2: (target?.y ?? 0) + 55};
  }
  outgoing(node: FlowNode) { return this.graph.edges.filter(edge => edge.source === node.id); }
  nodeName(id: string) { return this.graph.nodes.find(node => node.id === id)?.name ?? id; }

  async saveFlow() {
    if (!this.selectedFlow || this.savingFlow) return;
    if (!this.graph.rootId) { this.error = 'Defina um agente root.'; return; }
    this.savingFlow = true;
    try {
      await this.api.renameFlow(this.selectedFlow.id, this.selectedFlow.name, this.selectedFlow.description);
      const result = await this.api.saveFlowVersion(this.selectedFlow.id, this.copyGraph(this.graph));
      this.selectedFlow.activeVersion = result.version.version;
      this.flows = this.flows.map(item => item.id === this.selectedFlow?.id ? {...item, name: this.selectedFlow!.name, activeVersion: result.version.version} : item);
      this.flowVersions = (await this.api.flowVersions(this.selectedFlow.id)).versions;
      this.notice = `Flow salvo na versão ${result.version.version}.`;
    } catch (error) { this.fail(error); }
    finally { this.savingFlow = false; this.render(); }
  }

  restoreVersion(version: {version: number; graph: FlowGraph}) { this.graph = this.copyGraph(version.graph); this.selectedNode = this.graph.nodes[0] ?? null; this.notice = `Versão ${version.version} carregada no editor.`; }

  async addMemory() {
    if (!this.project || !this.memoryContent.trim()) return;
    this.memoryBusy = true;
    try { const result = await this.api.createMemory(this.project.id, this.memoryKind, this.memoryContent.trim(), this.conversation?.id); this.memories = [result.memory, ...this.memories]; this.memoryContent = ''; }
    catch (error) { this.fail(error); } finally { this.memoryBusy = false; this.render(); }
  }
  async removeMemory(memory: MemoryEntry) { try { await this.api.deleteMemory(memory.id); this.memories = this.memories.filter(item => item.id !== memory.id); } catch (error) { this.fail(error); } finally { this.render(); } }
  async searchMemory() { if (!this.project || !this.memoryQuery.trim()) return; this.memoryBusy = true; try { this.searchResults = (await this.api.search(this.project.id, this.memoryQuery)).results; } catch (error) { this.fail(error); } finally { this.memoryBusy = false; this.render(); } }

  trackId(_: number, item: {id: number | string}) { return item.id; }
  private toggle(values: string[], value: string) { return values.includes(value) ? values.filter(item => item !== value) : [...values, value]; }
  private newNode(x: number, y: number, name = `Agente ${this.graph.nodes.length + 1}`): FlowNode { return {id: `agent-${Date.now()}-${Math.floor(Math.random() * 1000)}`, name, x, y, systemPrompt: 'Você é um agente local especializado. Resolva a tarefa com precisão.'}; }
  private copyGraph(graph: FlowGraph): FlowGraph { return JSON.parse(JSON.stringify(graph)) as FlowGraph; }
  private render() { this.changeDetector.detectChanges(); }
  private fail(error: unknown) { this.error = error instanceof Error ? error.message : String(error); }
  private async responseError(response: Response) { const text = await response.text(); try { return JSON.parse(text).error ?? text; } catch { return text || 'Falha na requisição.'; } }
}

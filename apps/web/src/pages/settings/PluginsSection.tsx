import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle,
  Eye,
  Key,
  Layers,
  Lock,
  Play,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  XCircle,
} from "lucide-react";

import { Badge, Button, Toast } from "@/components/ui";
import {
  ipc,
  type PrivatePluginAuditEntry,
  type PrivatePluginManifest,
  type PrivatePluginRecord,
} from "@/lib/ipc";

export function PluginsSection() {
  const [plugins, setPlugins] = useState<PrivatePluginRecord[]>([]);
  const [discoverable, setDiscoverable] = useState<PrivatePluginManifest[]>([]);
  const [audits, setAudits] = useState<PrivatePluginAuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [secretInput, setSecretInput] = useState<{ [pluginId: string]: string }>({});
  const [hasSecretMap, setHasSecretMap] = useState<{ [pluginId: string]: boolean }>({});
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [list, disc, aud] = await Promise.all([
        ipc.plugins.list(),
        ipc.plugins.discover(),
        ipc.plugins.auditLog(undefined, 30),
      ]);
      setPlugins(list);
      setDiscoverable(disc);
      setAudits(aud);

      // Check secrets status
      const secretChecks: { [pid: string]: boolean } = {};
      for (const p of list) {
        try {
          secretChecks[p.id] = await ipc.plugins.hasSecret(p.id, "credentials");
        } catch {
          secretChecks[p.id] = false;
        }
      }
      setHasSecretMap(secretChecks);
    } catch (e) {
      console.error("Failed to load plugins data", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleInstall = async (manifest: PrivatePluginManifest) => {
    try {
      await ipc.plugins.install(`~/.local/share/com.ragton.auradesk/plugins/${manifest.id}`);
      setToastMsg(`Plugin ${manifest.name} instalado!`);
      loadData();
    } catch (e) {
      setToastMsg(`Erro ao instalar plugin: ${e}`);
    }
  };

  const handleToggle = async (plugin: PrivatePluginRecord) => {
    try {
      await ipc.plugins.setEnabled(plugin.id, !plugin.enabled);
      setToastMsg(
        !plugin.enabled
          ? `Plugin ${plugin.name} ativado.`
          : `Plugin ${plugin.name} desativado. Credenciais revogadas.`
      );
      loadData();
    } catch (e) {
      setToastMsg(`Erro ao alterar status: ${e}`);
    }
  };

  const handlePermissionToggle = async (
    pluginId: string,
    permission: string,
    currentGranted: boolean
  ) => {
    try {
      await ipc.plugins.setPermission(pluginId, permission, !currentGranted);
      setToastMsg(`Permissão '${permission}' atualizada.`);
      loadData();
    } catch (e) {
      setToastMsg(`Erro na permissão: ${e}`);
    }
  };

  const handleSaveSecret = async (pluginId: string) => {
    const val = secretInput[pluginId]?.trim();
    if (!val) return;
    try {
      await ipc.plugins.setSecret(pluginId, "credentials", val);
      setSecretInput((prev) => ({ ...prev, [pluginId]: "" }));
      setToastMsg(`Segredo salvo com segurança no cofre do SO.`);
      loadData();
    } catch (e) {
      setToastMsg(`Erro ao salvar segredo: ${e}`);
    }
  };

  const handleExecuteAction = async (pluginId: string, actionName: string) => {
    try {
      await ipc.plugins.executeAction({
        plugin_id: pluginId,
        action: actionName,
        params: { test: true },
        confirmed_by_user: true,
      });
      setToastMsg(`Ação '${actionName}' executada e auditada com sucesso!`);
      loadData();
    } catch (e) {
      setToastMsg(`Ação bloqueada/falhou: ${e}`);
      loadData();
    }
  };

  const handleUninstall = async (pluginId: string) => {
    try {
      await ipc.plugins.uninstall(pluginId);
      setToastMsg(`Plugin ${pluginId} desinstalado.`);
      loadData();
    } catch (e) {
      setToastMsg(`Erro ao desinstalar: ${e}`);
    }
  };

  return (
    <div className="space-y-6 text-sm">
      <div className="flex items-center justify-between pb-3 border-b border-border/40">
        <div>
          <h3 className="text-base font-medium text-foreground flex items-center gap-2">
            <Layers className="w-5 h-5 text-indigo-400" />
            Central de Plugins Privados (Fase 1)
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Plugins isolados para integrações corporativas. Segredos protegidos no cofre do sistema, permissões granulares e ações sob controle humano.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {/* Discover Local Plugins */}
      {discoverable.length > 0 && (
        <div className="rounded-lg border border-border/40 bg-card/50 p-4 space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Plugins Locais Descobertos (~/.local/share/.../plugins)
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {discoverable.map((d) => {
              const installed = plugins.some((p) => p.id === d.id);
              return (
                <div
                  key={d.id}
                  className="flex items-center justify-between p-3 rounded border border-border/30 bg-background/50"
                >
                  <div>
                    <div className="font-medium text-foreground flex items-center gap-2">
                      {d.name}
                      <Badge variant="neutral" className="text-[10px]">
                        v{d.version}
                      </Badge>
                      <Badge variant="neutral" className="text-[10px]">
                        Contrato {d.contract_version}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {d.description}
                    </p>
                  </div>
                  {!installed ? (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => handleInstall(d)}
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" />
                      Instalar
                    </Button>
                  ) : (
                    <Badge variant="success" className="text-emerald-400 border-emerald-500/30">
                      Instalado
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Installed Plugins */}
      <div className="space-y-4">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Plugins Instalados
        </h4>
        {plugins.length === 0 ? (
          <div className="text-center p-6 rounded-lg border border-dashed border-border/50 text-muted-foreground">
            Nenhum plugin privado instalado no perfil local.
          </div>
        ) : (
          plugins.map((plugin) => (
            <div
              key={plugin.id}
              className="rounded-lg border border-border/40 bg-card/30 p-4 space-y-4"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground text-sm">
                      {plugin.name}
                    </span>
                    <Badge variant={plugin.enabled ? "success" : "neutral"}>
                      {plugin.enabled ? "Ativo" : "Desativado"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      v{plugin.version} (Contrato {plugin.contract_version})
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {plugin.description}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={plugin.enabled ? "secondary" : "primary"}
                    onClick={() => handleToggle(plugin)}
                  >
                    {plugin.enabled ? "Desativar" : "Ativar"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-400 hover:text-red-300"
                    onClick={() => handleUninstall(plugin.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Permissions */}
              <div className="pt-2 border-t border-border/30">
                <h5 className="text-xs font-medium text-foreground mb-2 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-amber-400" />
                  Permissões Granulares
                </h5>
                <div className="flex flex-wrap gap-2">
                  {plugin.permissions.map((p) => (
                    <button
                      key={p.permission}
                      type="button"
                      onClick={() =>
                        handlePermissionToggle(plugin.id, p.permission, p.granted)
                      }
                      className={`text-xs px-2.5 py-1 rounded border transition-colors flex items-center gap-1.5 ${
                        p.granted
                          ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/20"
                          : "bg-muted/30 border-border/40 text-muted-foreground hover:bg-muted/50"
                      }`}
                    >
                      {p.granted ? (
                        <CheckCircle className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <XCircle className="w-3 h-3 text-muted-foreground" />
                      )}
                      <span>{p.permission}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Secret Store */}
              <div className="pt-2 border-t border-border/30">
                <h5 className="text-xs font-medium text-foreground mb-2 flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-blue-400" />
                  Cofre do SO (SecretStore)
                </h5>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-muted-foreground">Estado do Segredo:</span>
                    {hasSecretMap[plugin.id] ? (
                      <span className="text-emerald-400 flex items-center gap-1">
                        <Lock className="w-3 h-3" /> Armazenado no cofre
                      </span>
                    ) : (
                      <span className="text-amber-400 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Não configurado
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-1 max-w-sm">
                    <input
                      type="password"
                      placeholder="Novo token ou segredo..."
                      value={secretInput[plugin.id] ?? ""}
                      onChange={(e) =>
                        setSecretInput({ ...secretInput, [plugin.id]: e.target.value })
                      }
                      className="px-2.5 py-1 text-xs rounded bg-background border border-border/50 text-foreground w-full focus:outline-none focus:border-indigo-500"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleSaveSecret(plugin.id)}
                    >
                      Salvar
                    </Button>
                  </div>
                </div>
              </div>

              {/* Actions & Human Confirmation demo */}
              <div className="pt-2 border-t border-border/30 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Ações do Plugin (com autorização explícita):
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!plugin.enabled}
                    onClick={() => handleExecuteAction(plugin.id, "fetch_tickets")}
                  >
                    <Play className="w-3 h-3 mr-1" />
                    Ler (fetch_tickets)
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!plugin.enabled}
                    onClick={() => handleExecuteAction(plugin.id, "add_comment")}
                  >
                    <CheckCircle className="w-3 h-3 mr-1 text-amber-400" />
                    Escrever (add_comment - exige confirmação)
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Audit Log */}
      <div className="rounded-lg border border-border/40 bg-card/30 p-4 space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Eye className="w-4 h-4 text-purple-400" />
          Trilha de Auditoria (plugin_audit_log)
        </h4>
        {audits.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma ação registrada ainda.</p>
        ) : (
          <div className="max-h-48 overflow-y-auto space-y-1.5 pr-2">
            {audits.map((a) => (
              <div
                key={a.id}
                className="text-xs flex items-center justify-between p-2 rounded bg-background/40 border border-border/20"
              >
                <div className="flex items-center gap-2">
                  <Badge
                    variant={a.status.startsWith("denied") ? "danger" : "success"}
                    className="text-[10px]"
                  >
                    {a.status}
                  </Badge>
                  <span className="font-semibold text-foreground">{a.plugin_id}</span>
                  <span className="text-muted-foreground">&rarr;</span>
                  <span className="text-foreground">{a.action}</span>
                  {a.user_confirmed && (
                    <Badge variant="neutral" className="text-[9px]">
                      Aprovado pelo Usuário
                    </Badge>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(a.created_at).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <Toast
        open={Boolean(toastMsg)}
        message={toastMsg ?? ""}
        onClose={() => setToastMsg(null)}
      />
    </div>
  );
}

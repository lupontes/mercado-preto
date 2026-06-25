# Servidor claude-mem — Memória Compartilhada

Servidor de memória persistente para sessões do Claude Code, hospedado no Ambiente C da Oracle Cloud. Compartilhado entre todos os projetos de desenvolvimento.

## Dados do servidor

| Item | Valor |
|------|-------|
| URL | `https://163.176.168.207:37700` |
| Protocolo | HTTPS (certificado CA interno do Caddy) |

## Configuração inicial (uma vez por máquina)

### 1. Obter a API key

```bash
ssh -i ~/.ssh/oci_vms ubuntu@163.176.168.207 "grep API_KEY /opt/claude-mem/.env"
```

### 2. Instalar o certificado CA

```bash
# Extrair cert do servidor
ssh -i ~/.ssh/oci_vms ubuntu@163.176.168.207 \
  "docker cp \$(docker compose -f /opt/claude-mem/docker-compose.yml ps -q caddy):/data/caddy/pki/authorities/local/root.crt ~/caddy-root.crt"

scp -i ~/.ssh/oci_vms ubuntu@163.176.168.207:~/caddy-root.crt ./caddy-root.crt

# Linux
sudo cp caddy-root.crt /usr/local/share/ca-certificates/claude-mem-ca.crt
sudo update-ca-certificates

# macOS
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain caddy-root.crt
```

### 3. Configurar o Claude Code

Crie ou edite `.claude/settings.local.json` na raiz deste projeto:

```json
{
  "env": {
    "CLAUDE_MEM_SERVER_BETA_URL": "https://163.176.168.207:37700",
    "CLAUDE_MEM_SERVER_BETA_API_KEY": "<API_KEY>"
  }
}
```

O arquivo `settings.local.json` é ignorado pelo git — a API key não vai para o repositório.

### 4. Verificar

```bash
curl -s \
  -H "Authorization: Bearer <API_KEY>" \
  https://163.176.168.207:37700/health
```

# AI Platform - Multi-Agent Chat with RBAC

A multi-agent AI chat platform where different users access different Snowflake Cortex Agents based on their roles.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                    USERS                                        │
│                    (Browser - different roles/permissions)                      │
└─────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              LIBRECHAT (Docker)                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │   React     │  │   Node.js   │  │   MongoDB   │  │      MCP Client         │ │
│  │  Frontend   │──│   Backend   │──│   Users &   │  │  (connects to agents)   │ │
│  │  port 3080  │  │   Express   │  │   Sessions  │  │                         │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
                                       │
                          X-User-Email header
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           MCP PROXY (Node.js)                                   │
│                              port 3099                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         RBAC MIDDLEWARE                                  │   │
│  │  1. Extract email from X-User-Email header                              │   │
│  │  2. Query MongoDB for user.groups                                       │   │
│  │  3. Check if user's roles allow access to requested agent               │   │
│  │  4. ALLOW or DENY request                                               │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                       │                                         │
│         ┌─────────────────────────────┼─────────────────────────────┐          │
│         ▼                             ▼                             ▼          │
│  ┌─────────────┐              ┌─────────────┐              ┌─────────────┐     │
│  │  /farming   │              │   /grdt     │              │    /bi      │     │
│  │ farming_user│              │  grdt_user  │              │   bi_user   │     │
│  │   + admin   │              │   + admin   │              │   + admin   │     │
│  └─────────────┘              └─────────────┘              └─────────────┘     │
└─────────────────────────────────────────────────────────────────────────────────┘
                                       │
                          Bearer Token (PAT)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         SNOWFLAKE (Cloud)                                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                    CORTEX AGENTS (MCP Servers)                          │   │
│  │                                                                          │   │
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐               │   │
│  │  │   FARMING    │    │    GRDT      │    │     BI       │               │   │
│  │  │  MCP_SERVER  │    │  MCP_SERVER  │    │  MCP_SERVER  │               │   │
│  │  │              │    │              │    │              │               │   │
│  │  │ mortality    │    │ grdt-agent   │    │  bi-agent    │               │   │
│  │  │ alerts       │    │ reports      │    │  PowerBI     │               │   │
│  │  └──────────────┘    └──────────────┘    └──────────────┘               │   │
│  │         │                   │                   │                        │   │
│  │         └───────────────────┴───────────────────┘                        │   │
│  │                             │                                            │   │
│  │                    ┌────────┴────────┐                                   │   │
│  │                    │  Snowflake Data │                                   │   │
│  │                    │  Tables/Views   │                                   │   │
│  │                    └─────────────────┘                                   │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Technologies

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Frontend** | React + TypeScript | Chat UI, user authentication |
| **Backend** | Node.js + Express | API server, session management |
| **Database** | MongoDB | Users, conversations, roles (groups) |
| **MCP Proxy** | Node.js (custom) | RBAC gateway, routes to correct agent |
| **AI Agents** | Snowflake Cortex Agents | Domain-specific AI assistants |
| **Protocol** | MCP (Model Context Protocol) | Standardized tool calling between LLM and agents |
| **Auth** | Snowflake PAT | API authentication to Snowflake |
| **Containers** | Docker Compose | Orchestrates LibreChat + MongoDB |

## Role-Based Access Control (RBAC)

### How Roles Are Stored

Roles are stored in MongoDB in the `users` collection as a `groups` array:

```javascript
// User with full access
{
  email: "admin@company.com",
  groups: ["farming_user", "grdt_user", "bi_user", "admin"]
}

// User with limited access
{
  email: "analyst@company.com",
  groups: ["grdt_user"]
}
```

### Request Flow

1. User logs into LibreChat
2. User sends chat message
3. LibreChat calls MCP Proxy with `X-User-Email` header
4. Proxy extracts email → queries MongoDB for groups
5. Proxy checks: does user have required role for this agent?
6. If YES → forward to Snowflake agent
7. If NO → return "Access Denied"

### Role-to-Agent Mapping

Configured in `config.json`:

```json
{
  "agents": {
    "farming": { "allowed_roles": ["farming_user", "admin"] },
    "grdt":    { "allowed_roles": ["grdt_user", "admin"] },
    "bi":      { "allowed_roles": ["bi_user", "admin"] }
  }
}
```

### RBAC Priority Chain

The proxy checks roles in this order:

1. **X-User-Roles header** → if LibreChat sends groups directly
2. **MongoDB lookup** → `user.groups` array (primary source)
3. **config.json fallback** → `user_roles[email]`
4. **Default to admin** → workaround for initialization requests

## Project Structure

```
mcp-proxy/
├── index.js        # Main proxy server
├── rbac.js         # Role checking logic + MongoDB lookup
├── router.js       # Routes requests to Snowflake agents
├── config.json     # Agent URLs + role mappings
├── package.json    # Dependencies
└── README.md       # This file
```

## Configuration

### Environment Variables

Set in `../.env`:

```env
SNOWFLAKE_API_KEY=your-personal-access-token
MONGO_URI=mongodb://localhost:27017/LibreChat
MCP_PROXY_PORT=3099
```

### Agent Configuration

Edit `config.json` to add/modify agents:

```json
{
  "agents": {
    "agent_id": {
      "name": "Agent Display Name",
      "description": "What this agent does",
      "allowed_roles": ["role1", "role2", "admin"],
      "mcp_url": "https://account.snowflakecomputing.com/api/v2/databases/DB/schemas/SCHEMA/mcp-servers/SERVER_NAME"
    }
  }
}
```

### LibreChat MCP Configuration

In `librechat.yaml`:

```yaml
mcpServers:
  agent-tools:
    type: streamable-http
    url: "http://PROXY_IP:3099/agent_id"
    timeout: 180000
    headers:
      X-User-Id: "{{LIBRECHAT_USER_ID}}"
      X-User-Email: "{{LIBRECHAT_USER_EMAIL}}"
```

## Running the Platform

### Start LibreChat

```bash
cd ~/projects/LibreChat
docker compose up
```

### Start MCP Proxy

```bash
cd ~/projects/LibreChat/mcp-proxy
node index.js
```

## User Management

### View All Users

```bash
docker exec -i chat-mongodb mongosh LibreChat --eval '
db.users.find({}, {email:1, groups:1, name:1})
'
```

### Add Roles to User

```bash
docker exec -i chat-mongodb mongosh LibreChat --eval '
db.users.updateOne(
  { email: "user@example.com" },
  { $set: { groups: ["grdt_user", "bi_user"] } }
)
'
```

### Add Single Role

```bash
docker exec -i chat-mongodb mongosh LibreChat --eval '
db.users.updateOne(
  { email: "user@example.com" },
  { $addToSet: { groups: "farming_user" } }
)
'
```

### Remove Role

```bash
docker exec -i chat-mongodb mongosh LibreChat --eval '
db.users.updateOne(
  { email: "user@example.com" },
  { $pull: { groups: "farming_user" } }
)
'
```

### Delete User

```bash
docker exec -i chat-mongodb mongosh LibreChat --eval '
db.users.deleteOne({ email: "user@example.com" })
'
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/agents` | GET | List accessible agents for current user |
| `/` | POST | MCP request to all accessible tools |
| `/{agent_id}` | POST | MCP request to specific agent |

## Testing RBAC

Test with curl:

```bash
# Test as user with grdt_user role (should succeed)
curl -X POST http://localhost:3099/grdt \
  -H "Content-Type: application/json" \
  -H "X-User-Email: analyst@company.com" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# Test as user without bi_user role (should fail)
curl -X POST http://localhost:3099/bi \
  -H "Content-Type: application/json" \
  -H "X-User-Email: analyst@company.com" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

## Troubleshooting

### Proxy not connecting to MongoDB

Ensure MongoDB port is exposed in `docker-compose.yml`:

```yaml
mongodb:
  ports:
    - "27017:27017"
```

### Snowflake returns "Invalid OAuth access token"

Check that `SNOWFLAKE_API_KEY` is set correctly in `.env` and the PAT hasn't expired.

### Placeholders not resolved

Initial MCP requests may show `{{LIBRECHAT_USER_EMAIL}}` - this is normal during initialization. Actual user requests will have resolved emails.

## Architecture Decisions

| Decision | Reason |
|----------|--------|
| **LibreChat** | Open-source, supports MCP, multi-user, self-hosted |
| **MCP Proxy** | LibreChat can't do per-user RBAC natively; proxy intercepts and enforces |
| **MongoDB for roles** | Already used by LibreChat; single source of truth |
| **Snowflake Cortex** | Enterprise AI with direct data access, no data movement |
| **Separate agents** | Domain isolation (farming vs BI vs GRDT) |

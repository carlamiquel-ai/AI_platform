# Connecting Snowflake Cortex Agent to LibreChat

## Your Agent Details

| Property | Value |
|----------|-------|
| **Database** | `SNOWFLAKE_LEARNING_DB` |
| **Schema** | `MORTALITY_BOT_TST` |
| **Agent Name** | `A_MORTALITY_BOT_TST` |
| **Model** | `claude-4-sonnet` |
| **Tools** | `mortality_data` (Cortex Analyst), `create_mortality_warning`, `check_mortality_and_send_email` |

---

## Integration Options

There are **two ways** to connect a Cortex Agent to LibreChat:

### Option A: MCP Server (Recommended)
Expose your Cortex Agent as an MCP server and connect LibreChat to it.

### Option B: Custom Endpoint
Configure your agent as a custom endpoint in LibreChat (requires OpenAI-compatible API).

---

## Option A: MCP Server Integration (Recommended)

### Step 1: Create an MCP Server for Your Agent

Snowflake allows you to create MCP servers that wrap Cortex Agents. Run this SQL:

```sql
CREATE OR REPLACE MCP SERVER SNOWFLAKE_LEARNING_DB.MORTALITY_BOT_TST.MORTALITY_MCP_SERVER
  FROM AGENT SNOWFLAKE_LEARNING_DB.MORTALITY_BOT_TST.A_MORTALITY_BOT_TST;
```

### Step 2: Grant Access to the MCP Server

```sql
-- Grant usage to your role
GRANT USAGE ON MCP SERVER SNOWFLAKE_LEARNING_DB.MORTALITY_BOT_TST.MORTALITY_MCP_SERVER 
  TO ROLE PROD_CARLA.MIQUEL_ROLE;
```

### Step 3: Get the MCP Server URL

The MCP server URL follows this pattern:
```
https://<account>.snowflakecomputing.com/api/v2/databases/<DATABASE>/schemas/<SCHEMA>/mcp-servers/<MCP_SERVER_NAME>
```

For your setup:
```
https://fha72713-pa00178.snowflakecomputing.com/api/v2/databases/SNOWFLAKE_LEARNING_DB/schemas/MORTALITY_BOT_TST/mcp-servers/MORTALITY_MCP_SERVER
```

### Step 4: Update .env File

Add these variables to your `.env`:

```env
SNOWFLAKE_MCP_URL=https://fha72713-pa00178.snowflakecomputing.com/api/v2/databases/SNOWFLAKE_LEARNING_DB/schemas/MORTALITY_BOT_TST/mcp-servers/MORTALITY_MCP_SERVER
SNOWFLAKE_MCP_API_KEY=<your-snowflake-api-key>
```

> **Note:** Use the same API key as `SNOWFLAKE_API_KEY` or generate a new one for the role with MCP access.

### Step 5: Update librechat.yaml

Edit your `librechat.yaml` to enable the MCP server:

```yaml
version: 1.3.1
cache: false

interface:
  # ... your existing interface config ...

endpoints:
  custom:
    - name: "Snowflake"
      apiKey: "${SNOWFLAKE_API_KEY}"
      baseURL: "${SNOWFLAKE_BASE_URL}"
      iconURL: "https://avatars.githubusercontent.com/u/6453780?s=200&v=4"
      models:
        default:
          - "claude-sonnet-4-5"
          - "claude-opus-4-5"
        fetch: false
      titleConvo: true
      titleModel: "current_model"
      summarize: false
      summaryModel: "current_model"
      forcePrompt: false
      modelDisplayLabel: "Snowflake"

# MCP Servers - Enable your Mortality Bot Agent
mcpServers:
  mortality-bot:
    type: streamable-http
    url: "${SNOWFLAKE_MCP_URL}"
    headers:
      Authorization: "Bearer ${SNOWFLAKE_MCP_API_KEY}"
    timeout: 120000
```

### Step 6: Restart LibreChat

```bash
docker compose down
docker compose up
```

### Step 7: Use the Agent

In LibreChat, the MCP tools from your agent will be available when chatting. You can:
- Query mortality data
- Create mortality warnings
- Send email alerts

---

## Option B: Direct Agent API (Alternative)

If MCP doesn't work, you can call the agent directly via REST API.

### Agent REST API Endpoint

```
POST https://fha72713-pa00178.snowflakecomputing.com/api/v2/cortex/agent:run
```

### Request Body Format

```json
{
  "agent": "SNOWFLAKE_LEARNING_DB.MORTALITY_BOT_TST.A_MORTALITY_BOT_TST",
  "messages": [
    {
      "role": "user",
      "content": "What was the total mortality count last week?"
    }
  ],
  "stream": true
}
```

### Headers

```
Authorization: Bearer <SNOWFLAKE_API_KEY>
Content-Type: application/json
```

### Configure as Custom Endpoint in librechat.yaml

```yaml
endpoints:
  custom:
    - name: "Mortality Bot"
      apiKey: "${SNOWFLAKE_API_KEY}"
      baseURL: "https://fha72713-pa00178.snowflakecomputing.com/api/v2/cortex"
      iconURL: "https://avatars.githubusercontent.com/u/6453780?s=200&v=4"
      models:
        default:
          - "agent:SNOWFLAKE_LEARNING_DB.MORTALITY_BOT_TST.A_MORTALITY_BOT_TST"
        fetch: false
      titleConvo: true
      modelDisplayLabel: "Mortality Bot"
```

> **Note:** This option may require additional configuration depending on LibreChat's API compatibility.

---

## Troubleshooting

### Error: "MCP Server not found"
- Verify the MCP server was created: `SHOW MCP SERVERS IN SCHEMA SNOWFLAKE_LEARNING_DB.MORTALITY_BOT_TST;`
- Check permissions: `SHOW GRANTS ON MCP SERVER ...`

### Error: "Authentication failed"
- Verify your API key is valid
- Check the role has access to the MCP server and underlying agent

### Error: "Connection timeout"
- Increase timeout in librechat.yaml: `timeout: 300000`
- Check if SSL inspection is blocking (add `NODE_TLS_REJECT_UNAUTHORIZED=0` to .env)

### Test MCP Server Connection

```bash
curl -X POST "https://fha72713-pa00178.snowflakecomputing.com/api/v2/databases/SNOWFLAKE_LEARNING_DB/schemas/MORTALITY_BOT_TST/mcp-servers/MORTALITY_MCP_SERVER" \
  -H "Authorization: Bearer $SNOWFLAKE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"method": "tools/list"}'
```

---

## Quick Checklist

- [ ] Create MCP Server from Agent (Step 1)
- [ ] Grant access to MCP Server (Step 2)
- [ ] Add `SNOWFLAKE_MCP_URL` to `.env`
- [ ] Add `SNOWFLAKE_MCP_API_KEY` to `.env`
- [ ] Update `librechat.yaml` with mcpServers config
- [ ] Restart LibreChat
- [ ] Test the integration

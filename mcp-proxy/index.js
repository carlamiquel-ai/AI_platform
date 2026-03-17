const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const http = require('http');
const url = require('url');
const config = require('./config.json');
const { getRolesFromRequest, canAccessAgentByRoles, getAccessibleAgentsByRoles } = require('./rbac');
const { routeToAgent } = require('./router');

const PORT = process.env.MCP_PROXY_PORT || 3099;
const SNOWFLAKE_API_KEY = process.env.SNOWFLAKE_API_KEY;

function getAgentFromPath(pathname) {
  const match = pathname.match(/^\/([^/]+)/);
  const agent = match ? match[1] : null;
  if (agent === 'agents') return null;
  return agent;
}

async function fetchAgentTools(agentId) {
  const agentConfig = config.agents[agentId];
  console.log(`[MCP Proxy] Fetching tools from Snowflake for ${agentId}: ${agentConfig.mcp_url}`);
  try {
    const response = await fetch(agentConfig.mcp_url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SNOWFLAKE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1, params: {} })
    });
    const result = await response.json();
    console.log(`[MCP Proxy] Snowflake response for ${agentId}:`, JSON.stringify(result).substring(0, 200));
    return result.result?.tools || [];
  } catch (err) {
    console.error(`[MCP Proxy] Error fetching tools for ${agentId}:`, err.message);
    return [];
  }
}

function handleAgentsEndpoint(req, res) {
  const roles = getRolesFromRequest(req);
  const agents = getAccessibleAgentsByRoles(roles);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ agents, roles }));
}

async function handleMcpRequest(req, res) {
  const pathname = url.parse(req.url).pathname;

  if (req.method === 'GET' && pathname === '/agents') {
    return handleAgentsEndpoint(req, res);
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      if (!body || body.trim() === '') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: 0,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'mcp-proxy', version: '1.0.0' }
          }
        }));
        return;
      }
      const mcpRequest = JSON.parse(body);
      console.log(`[MCP Proxy] ${mcpRequest.method} from ${pathname}`);
      console.log(`[MCP Proxy] ALL Headers:`, JSON.stringify(req.headers, null, 2));
      const roles = await getRolesFromRequest(req);
      console.log(`[MCP Proxy] Resolved roles: ${roles.join(', ') || '(none)'}`);
      const method = mcpRequest.method;
      const targetAgent = getAgentFromPath(pathname);

      if (method === 'initialize') {
        const serverName = targetAgent ? `${targetAgent}-proxy` : 'platform-agents-proxy';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: mcpRequest.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: serverName, version: '1.0.0' }
          }
        }));
        return;
      }

      if (targetAgent && !config.agents[targetAgent]) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: mcpRequest.id, error: { code: -32600, message: `Agent not found: ${targetAgent}` } }));
        return;
      }

      if (targetAgent && !canAccessAgentByRoles(roles, targetAgent)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: mcpRequest.id, error: { code: -32600, message: `Access denied to agent: ${targetAgent}` } }));
        return;
      }

      if (method === 'tools/list') {
        let allTools = [];

        if (targetAgent) {
          allTools = await fetchAgentTools(targetAgent);
        } else {
          const accessibleAgents = getAccessibleAgentsByRoles(roles);
          for (const agent of accessibleAgents) {
            const tools = await fetchAgentTools(agent.id);
            const prefixedTools = tools.map(tool => ({ ...tool, name: `${agent.id}__${tool.name}` }));
            allTools.push(...prefixedTools);
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: mcpRequest.id, result: { tools: allTools } }));
        return;
      }

      if (method === 'ping') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: mcpRequest.id, result: {} }));
        return;
      }

      if (method === 'notifications/initialized' || method?.startsWith('notifications/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: mcpRequest.id, result: {} }));
        return;
      }

      if (method === 'tools/call') {
        let agentId, actualToolName;

        if (targetAgent) {
          agentId = targetAgent;
          actualToolName = mcpRequest.params?.name;
        } else {
          const toolName = mcpRequest.params?.name;
          agentId = toolName.split('__')[0];
          actualToolName = toolName.split('__').slice(1).join('__');
          if (!canAccessAgentByRoles(roles, agentId)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: '2.0', id: mcpRequest.id, error: { code: -32600, message: `Access denied to agent: ${agentId}` } }));
            return;
          }
        }

        const agentRequest = { ...mcpRequest, params: { ...mcpRequest.params, name: actualToolName } };
        const result = await routeToAgent(agentId, agentRequest, SNOWFLAKE_API_KEY);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }

      const serverName = targetAgent ? `${targetAgent}-proxy` : 'platform-agents-proxy';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        id: mcpRequest.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: serverName, version: '1.0.0' }
        }
      }));

    } catch (err) {
      console.error('[MCP Proxy Error]', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: err.message } }));
    }
  });
}

const server = http.createServer(handleMcpRequest);
server.listen(PORT, () => {
  console.log(`[MCP Proxy] Platform Agents Proxy running on port ${PORT}`);
  console.log(`[MCP Proxy] Agents: ${Object.keys(config.agents).join(', ')}`);
  console.log(`[MCP Proxy] Endpoints:`);
  console.log(`  - GET  /agents         → List accessible agents`);
  console.log(`  - POST /               → MCP (all accessible tools)`);
  console.log(`  - POST /{agent}        → MCP (specific agent tools)`);
});

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const http = require('http');
const url = require('url');
const config = require('./config.json');
const { getRolesFromRequest, canAccessAgentByRoles, getAccessibleAgentsByRoles } = require('./rbac');
const { routeToAgent } = require('./router');
const { summarizeDocument } = require('./summarize');
const { renderChartToBase64 } = require('./chart-renderer');

const PORT = process.env.MCP_PROXY_PORT || 3099;
const SNOWFLAKE_API_KEY = process.env.SNOWFLAKE_API_KEY;

const SUMMARIZE_TOOL_DEFINITION = {
  name: 'summarize-document',
  description: 'Summarize an uploaded document (PDF, DOCX, TXT). Send the document content as base64-encoded data.',
  inputSchema: {
    type: 'object',
    properties: {
      file_content: {
        type: 'string',
        description: 'Base64-encoded file content'
      },
      file_name: {
        type: 'string',
        description: 'Original file name (used to detect type)'
      },
      mime_type: {
        type: 'string',
        description: 'MIME type of the file (e.g. application/pdf, text/plain)'
      },
      format: {
        type: 'string',
        description: 'Summary format: "structured" (detailed) or "brief" (bullet points). Default: structured',
        enum: ['structured', 'brief']
      },
      model: {
        type: 'string',
        description: 'Cortex model to use. Default: snowflake-llama-3.3-70b'
      }
    },
    required: ['file_content', 'file_name']
  }
};

function getMimeType(fileName, providedMime) {
  if (providedMime && providedMime !== '') return providedMime;
  const ext = path.extname(fileName).toLowerCase();
  const mimeMap = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.md': 'text/markdown'
  };
  return mimeMap[ext] || 'text/plain';
}

function getAgentFromPath(pathname) {
  const match = pathname.match(/^\/([^/]+)/);
  const agent = match ? match[1] : null;
  if (agent === 'agents' || agent === 'summarize') return null;
  return agent;
}

function isSummarizePath(pathname) {
  return pathname === '/summarize' || pathname.startsWith('/summarize/');
}

/**
 * Post-process a Cortex agent MCP response: extract text/chart blocks,
 * render Vega-Lite charts to PNG, return clean MCP content.
 */
async function postProcessAgentResponse(result) {
  if (!result?.result?.content || !Array.isArray(result.result.content)) return result;

  const newContent = [];
  let chartCount = 0;

  for (const item of result.result.content) {
    if (item.type !== 'text') {
      newContent.push(item);
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(item.text);
    } catch {
      newContent.push(item);
      continue;
    }

    if (!parsed.content || !Array.isArray(parsed.content)) {
      newContent.push(item);
      continue;
    }

    for (const block of parsed.content) {
      if (block.type === 'text' && block.text && block.text.trim()) {
        newContent.push({ type: 'text', text: block.text });
      } else if (block.type === 'chart' && block.chart?.chart_spec) {
        chartCount++;
        try {
          const spec = typeof block.chart.chart_spec === 'string'
            ? JSON.parse(block.chart.chart_spec)
            : block.chart.chart_spec;
          console.log(`[Charts] Rendering chart from agent response (${spec.mark || spec.title || 'chart'})`);
          const base64Png = await renderChartToBase64(spec);
          console.log(`[Charts] Agent chart rendered (${Math.round(base64Png.length / 1024)}KB)`);
          newContent.push({ type: 'image', data: base64Png, mimeType: 'image/png' });
        } catch (err) {
          console.error('[Charts] Failed to render agent chart:', err.message);
          newContent.push({ type: 'text', text: `[Chart rendering failed: ${err.message}]` });
        }
      } else if (block.type === 'suggested_queries' && Array.isArray(block.suggested_queries)) {
        const suggestions = block.suggested_queries.map(q => `- ${q.query}`).join('\n');
        newContent.push({ type: 'text', text: `\nSuggested follow-ups:\n${suggestions}` });
      }
    }
  }

  if (chartCount === 0) return result;

  console.log(`[Charts] Post-processed agent response: ${chartCount} chart(s) rendered`);
  return { ...result, result: { ...result.result, content: newContent } };
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
        const serverName = isSummarizePath(pathname) ? 'summarize-proxy' : targetAgent ? `${targetAgent}-proxy` : 'platform-agents-proxy';
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

      // === Summarize endpoint ===
      if (isSummarizePath(pathname)) {
        if (method === 'tools/list') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            id: mcpRequest.id,
            result: { tools: [SUMMARIZE_TOOL_DEFINITION] }
          }));
          return;
        }

        if (method === 'tools/call' && mcpRequest.params?.name === 'summarize-document') {
          const args = mcpRequest.params.arguments || {};
          if (!args.file_content || !args.file_name) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              id: mcpRequest.id,
              result: { content: [{ type: 'text', text: 'Error: file_content and file_name are required.' }], isError: true }
            }));
            return;
          }

          try {
            const buffer = Buffer.from(args.file_content, 'base64');
            const mimeType = getMimeType(args.file_name, args.mime_type);
            console.log(`[Summarize] Processing ${args.file_name} (${mimeType}, ${buffer.length} bytes)`);
            const summary = await summarizeDocument(buffer, mimeType, SNOWFLAKE_API_KEY, {
              model: args.model,
              format: args.format
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              id: mcpRequest.id,
              result: { content: [{ type: 'text', text: summary }] }
            }));
          } catch (err) {
            console.error('[Summarize Error]', err.message);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              id: mcpRequest.id,
              result: { content: [{ type: 'text', text: `Summarization error: ${err.message}` }], isError: true }
            }));
          }
          return;
        }

        // Other methods on /summarize (ping, notifications)
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: mcpRequest.id, result: {} }));
        return;
      }

      if (targetAgent && !config.agents[targetAgent]) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: mcpRequest.id, error: { code: -32600, message: `Agent not found: ${targetAgent}` } }));
        return;
      }

      if (targetAgent && !canAccessAgentByRoles(roles, targetAgent)) {
        if (method === 'tools/list') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            id: mcpRequest.id,
            result: {
              tools: [{
                name: 'access-denied',
                description: 'Access denied to this server. Please ask your admin to grant you access.',
                inputSchema: { type: 'object', properties: {} }
              }]
            }
          }));
          return;
        }
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
        const rawResult = await routeToAgent(agentId, agentRequest, SNOWFLAKE_API_KEY);
        const result = await postProcessAgentResponse(rawResult);
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
  console.log(`  - POST /summarize      → MCP (document summarization via Cortex)`);
});

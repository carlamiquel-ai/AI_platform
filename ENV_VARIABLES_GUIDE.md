# LibreChat Environment Variables Guide

## Variable Explanations

### Server Configuration

| Variable | Description | Local Value |
|----------|-------------|-------------|
| `HOST` | Server hostname | `localhost` |
| `PORT` | Server port number | `3080` |
| `MONGO_URI` | MongoDB connection string | `mongodb://127.0.0.1:27017/LibreChat` |
| `DOMAIN_CLIENT` | Frontend URL for CORS and redirects | `http://localhost:3080` |
| `DOMAIN_SERVER` | Backend URL for API calls | `http://localhost:3080` |

### Snowflake Configuration

| Variable | Description | Example |
|----------|-------------|---------|
| `SNOWFLAKE_API_KEY` | API key for Snowflake Cortex authentication | Jerry should know |
| `SNOWFLAKE_BASE_URL` | Snowflake Cortex API endpoint | `https://fha72713-pa00178.snowflakecomputing.com/api/v2/cortex/v1` |
| `SNOWFLAKE_MCP_URL` | MCP server endpoint in Snowflake | `https://fha72713-pa00178.snowflakecomputing.com/api/v2/databases/<database>/schemas/<schema>/mcp-servers/<mcp-server-name>` |
| `SNOWFLAKE_MCP_API_KEY` | API key for user/role with MCP access | Jerry should know |

### Security Tokens

| Variable | Description | How to Generate |
|----------|-------------|-----------------|
| `JWT_SECRET` | Secret for signing JWT access tokens | `openssl rand -base64 32` |
| `JWT_REFRESH_SECRET` | Secret for signing JWT refresh tokens | `openssl rand -base64 32` |

### OpenID Connect / Microsoft Entra ID SSO

#### Core Settings

| Variable | Description | Value |
|----------|-------------|-------|
| `OPENID_GENERATE_NONCE` | Generate security nonce for OIDC flow | `true` |
| `OPENID_CLIENT_ID` | Application (client) ID from Azure App Registration | `80ea30c9-e18b-49da-a43c-c22781140d4e` |
| `OPENID_CLIENT_SECRET` | Client secret from Azure App Registration | Jerry should know |
| `OPENID_ISSUER` | Azure AD token issuer URL (includes tenant ID) | `https://login.microsoftonline.com/84659319-c8cc-4302-a6cf-508dde8aaefe/v2.0/` |
| `OPENID_SESSION_SECRET` | Random secret for encrypting session data | Generate with `openssl rand -base64 32` |
| `OPENID_SCOPE` | OAuth scopes to request during authentication | `api://80ea30c9-e18b-49da-a43c-c22781140d4e/.default openid profile email offline_access` |
| `OPENID_CALLBACK_URL` | OAuth callback path (relative to DOMAIN_SERVER) | `/oauth/openid/callback` |

#### Token Claims Mapping

| Variable | Description | Value |
|----------|-------------|-------|
| `OPENID_USERNAME_CLAIM` | JWT claim containing username | `preferred_username` |
| `OPENID_NAME_CLAIM` | JWT claim containing display name | `name` |
| `OPENID_AUDIENCE` | Expected audience in JWT tokens | `api://80ea30c9-e18b-49da-a43c-c22781140d4e` |

#### UI Customization

| Variable | Description | Value |
|----------|-------------|-------|
| `OPENID_BUTTON_LABEL` | Text shown on SSO login button | `Continue with Mowi SSO` |
| `OPENID_IMAGE_URL` | Icon shown on SSO login button | `https://upload.wikimedia.org/wikipedia/commons/4/44/Microsoft_logo.svg` |
| `OPENID_AUTO_REDIRECT` | Skip login page, go directly to SSO | `true` |

#### Security Features

| Variable | Description | Value |
|----------|-------------|-------|
| `OPENID_USE_PKCE` | Enable PKCE (Proof Key for Code Exchange) for security | `true` |
| `OPENID_REUSE_TOKENS` | Reuse valid tokens instead of re-authenticating | `true` |
| `OPENID_JWKS_URL_CACHE_ENABLED` | Cache JSON Web Key Set for performance | `true` |
| `OPENID_JWKS_URL_CACHE_TIME` | JWKS cache duration in milliseconds (10 min) | `600000` |

#### On-Behalf-Of Flow (for Microsoft Graph API)

| Variable | Description | Value |
|----------|-------------|-------|
| `OPENID_ON_BEHALF_FLOW_FOR_USERINFO_REQUIRED` | Enable OBO flow for user info | `true` |
| `OPENID_ON_BEHALF_FLOW_USERINFO_SCOPE` | Scope for OBO user info request | `user.read` |
| `OPENID_USE_END_SESSION_ENDPOINT` | Use Azure logout endpoint on sign out | `true` |

#### Microsoft Graph / People Search

| Variable | Description | Value |
|----------|-------------|-------|
| `USE_ENTRA_ID_FOR_PEOPLE_SEARCH` | Enable people picker via Microsoft Graph | `true` |
| `ENTRA_ID_INCLUDE_OWNERS_AS_MEMBERS` | Include group owners as members in search | `true` |
| `OPENID_GRAPH_SCOPES` | Microsoft Graph API permissions | `User.Read,People.Read,GroupMember.Read.All,User.ReadBasic.All` |

#### Role-Based Access Control (Optional)

| Variable | Description | Value |
|----------|-------------|-------|
| `OPENID_REQUIRED_ROLE` | Group/role required to access the app | (configure in Azure) |
| `OPENID_REQUIRED_ROLE_TOKEN_KIND` | Where to find role claim (`id` or `access`) | `id` |
| `OPENID_REQUIRED_ROLE_PARAMETER_PATH` | JSON path to role in token | (depends on Azure config) |
| `OPENID_ADMIN_ROLE` | Group/role for admin access | (configure in Azure) |
| `OPENID_ADMIN_ROLE_PARAMETER_PATH` | JSON path to admin role in token | (depends on Azure config) |
| `OPENID_ADMIN_ROLE_TOKEN_KIND` | Where to find admin role claim | (depends on Azure config) |

---

## Current Status in Your .env

### ✅ Already Configured Correctly

- `HOST=localhost`
- `PORT=3080`
- `MONGO_URI=mongodb://127.0.0.1:27017/LibreChat`
- `DOMAIN_CLIENT=http://localhost:3080`
- `DOMAIN_SERVER=http://localhost:3080`
- `JWT_SECRET` (set)
- `JWT_REFRESH_SECRET` (set)
- `SNOWFLAKE_API_KEY` (set)
- `SNOWFLAKE_BASE_URL` (set)
- `OPENID_CALLBACK_URL=/oauth/openid/callback`

### ❌ Needs Configuration

The following variables are empty or have incorrect values:

```env
# Missing entirely - add these:
OPENID_GENERATE_NONCE=true
SNOWFLAKE_MCP_URL=https://fha72713-pa00178.snowflakecomputing.com/api/v2/databases/<database>/schemas/<schema>/mcp-servers/<mcp-server-name>
SNOWFLAKE_MCP_API_KEY=<api key for user/role with access to mcp>

# Empty - need values:
OPENID_CLIENT_ID=80ea30c9-e18b-49da-a43c-c22781140d4e
OPENID_CLIENT_SECRET=<Jerry should know>
OPENID_ISSUER=https://login.microsoftonline.com/84659319-c8cc-4302-a6cf-508dde8aaefe/v2.0/
OPENID_SESSION_SECRET=<generate with: openssl rand -base64 32>
OPENID_SCOPE=api://80ea30c9-e18b-49da-a43c-c22781140d4e/.default openid profile email offline_access
OPENID_USERNAME_CLAIM=preferred_username
OPENID_NAME_CLAIM=name
OPENID_AUDIENCE=api://80ea30c9-e18b-49da-a43c-c22781140d4e
OPENID_BUTTON_LABEL=Continue with Mowi SSO
OPENID_IMAGE_URL=https://upload.wikimedia.org/wikipedia/commons/4/44/Microsoft_logo.svg
OPENID_REUSE_TOKENS=true
OPENID_JWKS_URL_CACHE_ENABLED=true
OPENID_JWKS_URL_CACHE_TIME=600000
OPENID_ON_BEHALF_FLOW_FOR_USERINFO_REQUIRED=true
OPENID_USE_END_SESSION_ENDPOINT=true

# Need to change from false to true:
OPENID_AUTO_REDIRECT=true
OPENID_USE_PKCE=true
USE_ENTRA_ID_FOR_PEOPLE_SEARCH=true
ENTRA_ID_INCLUDE_OWNERS_AS_MEMBERS=true

# Need to update scope (remove quotes):
OPENID_ON_BEHALF_FLOW_USERINFO_SCOPE=user.read

# Need to add User.ReadBasic.All:
OPENID_GRAPH_SCOPES=User.Read,People.Read,GroupMember.Read.All,User.ReadBasic.All

# Role config (if using role-based access):
OPENID_REQUIRED_ROLE_TOKEN_KIND=id
```

---

## Quick Setup Commands

Generate random secrets:
```bash
# JWT Secret
openssl rand -base64 32

# JWT Refresh Secret  
openssl rand -base64 32

# OpenID Session Secret
openssl rand -base64 32
```

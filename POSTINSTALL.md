Open the app to finish setup:

1. In your dashboard, go to **Settings → API Tokens** and create a token. A read-only token keeps every client read-only.
2. Paste the token into the app's settings page.
3. Create a key for each MCP client and connect it to `https://$CLOUDRON-APP-FQDN/mcp` with the header `Authorization: Bearer <key>`.

Until a token is saved, anyone allowed into this app can set it up. Restrict the app to admins in its **Access Control** settings if other users can reach it.

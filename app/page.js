export default function Home() {
  return (
    <main style={{ maxWidth: 760, margin: "64px auto", padding: "0 24px", lineHeight: 1.55 }}>
      <h1>Gemini Critic MCP</h1>
      <p>Remote MCP for ChatGPT. Gemini reviews and compares proposals but receives no execution tools.</p>
      <ul>
        <li>MCP endpoint: <code>/api/mcp</code></li>
        <li>Health endpoint: <code>/api/health</code></li>
        <li>Default model: <code>gemini-3.8-flash-high</code></li>
      </ul>
    </main>
  );
}

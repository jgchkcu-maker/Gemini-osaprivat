export const metadata = {
  title: "Gemini Critic MCP",
  description: "Read-only Gemini critic for ChatGPT via MCP"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>{children}</body>
    </html>
  );
}

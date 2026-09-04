import "./globals.css";

export const metadata = {
  title: "Gemini Critic Control",
  description: "Account pool and remote MCP control center for Gemini 3.8 Flash High"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

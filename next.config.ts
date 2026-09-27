import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Evita que `next dev` reescriba CLAUDE.md / AGENTS.md: las reglas para
  // agentes del repo viven en CLAUDE.md y se mantienen a mano.
  agentRules: false,
};

export default nextConfig;

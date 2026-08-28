/**
 * Default permission rules for the harness.
 *
 * Deny rules are code, not prompts. They inspect tool calls before
 * execution and block dangerous operations deterministically.
 */

import type { ToolDef, ToolExecutionContext } from "@bankai/tools";
import type { PermissionRule, PermissionStackConfig } from "./index.js";

// --- Bash deny patterns ---

const BASH_DENY_PATTERNS: ReadonlyArray<{
  readonly name: string;
  readonly pattern: RegExp;
  readonly description: string;
}> = [
  {
    name: "no-rm-root",
    pattern: /\brm\s+.*(?<=^|\s)(-r[fFx]?|--recursive|--no-preserve-root).*([\/]~\s|\/)\b/,
    description: "Blocks rm -rf with root or home paths",
  },
  {
    name: "no-rm-force-root",
    pattern: /\brm\s+-rf\s+[\/~\s]*$/i,
    description: "Blocks rm -rf targeting root or home directory",
  },
  {
    name: "no-chmod-777",
    pattern: /\bchmod\s+777\b/,
    description: "Blocks world-writable permissions",
  },
  {
    name: "no-mount",
    pattern: /\b(mount|umount)\b/,
    description: "Blocks mount/umount operations",
  },
  {
    name: "no-filesystem-format",
    pattern: /\bmkfs\b/,
    description: "Blocks filesystem formatting",
  },
  {
    name: "no-systemctl",
    pattern: /\bsystemctl\s+(start|stop|restart|enable|disable)\b/,
    description: "Blocks systemctl service management",
  },
  {
    name: "no-shutdown",
    pattern: /\b(shutdown|reboot|halt|poweroff)\b/,
    description: "Blocks system shutdown/reboot",
  },
  {
    name: "no-dd",
    pattern: /\bdd\s+.*of=/,
    description: "Blocks dd writes to files/devices",
  },
  {
    name: "no-fork-bomb",
    pattern: /:()\s*\{\s*:\|:\s*&\s*\}\s*;:/,
    description: "Blocks fork bomb patterns",
  },
  {
    name: "no-curl-wget-external",
    pattern: /\b(curl|wget)\b\s+.*https?:\/\//,
    description: "Blocks curl/wget to external URLs (network egress)",
  },
];

// --- Bash allow patterns (safe navigation/build commands) ---

const BASH_ALLOW_PATTERNS: ReadonlyArray<{
  readonly name: string;
  readonly pattern: RegExp;
}> = [
  { name: "ls", pattern: /^\s*ls\b/ },
  { name: "grep", pattern: /^\s*grep\b/ },
  { name: "find", pattern: /^\s*find\b/ },
  { name: "cat", pattern: /^\s*cat\b/ },
  { name: "head", pattern: /^\s*head\b/ },
  { name: "tail", pattern: /^\s*tail\b/ },
  { name: "wc", pattern: /^\s*wc\b/ },
  { name: "git", pattern: /^\s*git\b/ },
  { name: "node", pattern: /^\s*node\b/ },
  { name: "python", pattern: /^\s*(python3?|python3)\b/ },
  { name: "pnpm", pattern: /^\s*pnpm\b/ },
  { name: "npm", pattern: /^\s*npm\b/ },
  { name: "tsc", pattern: /^\s*tsc\b/ },
  { name: "make", pattern: /^\s*make\b/ },
  { name: "echo", pattern: /^\s*echo\b/ },
];

// --- Rule implementations ---

export class BashDenyRule implements PermissionRule {
  readonly decision = "deny" as const;
  constructor(
    readonly name: string,
    readonly pattern: RegExp,
    readonly description: string
  ) {}
  risk = "destructive";
  matches(toolName: string, params: Record<string, unknown>): boolean {
    if (toolName !== "bash") return false;
    const cmd = (params.command ?? params.cmd ?? "") as string;
    return this.pattern.test(cmd);
  }
}

export class BashAllowRule implements PermissionRule {
  readonly decision = "allow" as const;
  constructor(
    readonly name: string,
    readonly pattern: RegExp
  ) {}
  risk = "safe";
  matches(toolName: string, params: Record<string, unknown>): boolean {
    if (toolName !== "bash") return false;
    const cmd = (params.command ?? params.cmd ?? "") as string;
    return this.pattern.test(cmd);
  }
}

export class ToolDenyRule implements PermissionRule {
  readonly decision = "deny" as const;
  constructor(readonly name: string, readonly toolName: string, readonly reason: string) {}
  risk = "destructive";
  matches(toolName: string): boolean {
    return toolName === this.toolName;
  }
}

export class ToolAllowRule implements PermissionRule {
  readonly decision = "allow" as const;
  constructor(readonly name: string, readonly toolName: string) {}
  risk = "safe";
  matches(toolName: string): boolean {
    return toolName === this.toolName;
  }
}

/**
 * Build the default permission stack configuration.
 * Deny-first: dangerous bash commands are blocked in code.
 * Allow: safe navigation tools and common build commands.
 */
export function defaultPermissionConfig(): PermissionStackConfig {
  const deny: PermissionRule[] = [
    ...BASH_DENY_PATTERNS.map(
      (p) => new BashDenyRule(p.name, p.pattern, p.description)
    ),
  ];

  const allow: PermissionRule[] = [
    new ToolAllowRule("safe-file-read", "file_read"),
    new ToolAllowRule("safe-code-exec", "code_exec"),
    ...BASH_ALLOW_PATTERNS.map((p) => new BashAllowRule(p.name, p.pattern)),
    // file_edit requires approval by default
  ];

  const ask: PermissionRule[] = [
    {
      name: "file-edit-approval",
      risk: "requires_approval",
      decision: "ask",
      matches: (toolName: string) => toolName === "file_edit",
    },
  ];

  return {
    deny,
    ask,
    allow,
    maxConsecutiveDenials: 3,
    maxTotalDenials: 20,
  };
}

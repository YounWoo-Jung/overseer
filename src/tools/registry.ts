export interface ToolEntry<Input = any, Output = unknown> {
  name: string;
  toolset: string;
  description: string;
  handler: (input: Input) => Output | Promise<Output>;
}

const tools = new Map<string, ToolEntry>();

export function registerTool(entry: ToolEntry): void {
  tools.set(entry.name, entry);
}

export function getTool(name: string): ToolEntry | undefined {
  return tools.get(name);
}

export function listTools(toolset?: string): ToolEntry[] {
  return [...tools.values()]
    .filter((tool) => !toolset || tool.toolset === toolset)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function callTool<Input, Output>(name: string, input: Input): Promise<Output> {
  const tool = getTool(name);
  if (!tool) throw new Error(`tool not found: ${name}`);
  return await tool.handler(input) as Output;
}

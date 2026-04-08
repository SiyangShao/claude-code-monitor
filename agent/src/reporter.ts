import type {
  AgentReport,
  SessionReport,
  EnvironmentType,
} from "@claude-monitor/shared";

export class Reporter {
  private serverUrl: string;
  private apiKey: string;
  private machineName: string;
  private environment: EnvironmentType;
  private lastReportHash: string = "";

  constructor(
    serverUrl: string,
    apiKey: string,
    machineName: string,
    environment: EnvironmentType
  ) {
    this.serverUrl = serverUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.machineName = machineName;
    this.environment = environment;
  }

  // Returns true if the report was sent (state changed or heartbeat)
  async report(
    sessions: SessionReport[],
    force: boolean = false
  ): Promise<boolean> {
    const hash = this.hashSessions(sessions);

    if (!force && hash === this.lastReportHash) {
      return false; // No change
    }

    const payload: AgentReport = {
      machineName: this.machineName,
      environment: this.environment,
      timestamp: new Date().toISOString(),
      sessions,
    };

    try {
      const response = await fetch(`${this.serverUrl}/api/report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey
            ? { Authorization: `Bearer ${this.apiKey}` }
            : {}),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error(
          `[reporter] Server returned ${response.status}: ${text}`
        );
        return false;
      }

      this.lastReportHash = hash;
      return true;
    } catch (err) {
      console.error(
        "[reporter] Failed to send report:",
        (err as Error).message
      );
      return false;
    }
  }

  private hashSessions(sessions: SessionReport[]): string {
    // Simple hash: sort sessions and stringify status + sessionId
    const key = sessions
      .map((s) => `${s.sessionId}:${s.status}:${s.lastActivity}`)
      .sort()
      .join("|");
    return key;
  }
}

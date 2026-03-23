import { create } from "zustand";

export type ContainerInfo = {
  name: string;
  service: string;
  status: string;
  memory: string;
  ports: string[];
};

export type ProjectTask = {
  id: string;
  title: string;
  status: string;
};

export type ProjectGitInfo = {
  branch: string;
  dirty: number;
  ahead: number;
  behind: number;
  lastCommitMsg: string;
  branches: number;
};

export type ProjectInfo = {
  name: string;
  dir: string;
  git: ProjectGitInfo;
  containers: ContainerInfo[];
  tasks: ProjectTask[];
};

export type ServiceInfo = {
  name: string;
  kind: "process" | "docker";
  status: "running" | "stopped";
  port?: number;
  dir?: string;
  description?: string;
  pid?: number;
};

export type UntrackedPort = {
  port: number;
  bind: string;
  pid: number | null;
  process: string;
  cwd: string;
};

export type UntrackedInfo = {
  containers: ContainerInfo[];
  ports: UntrackedPort[];
};

export type ProjectWithService = ProjectInfo & {
  service?: ServiceInfo;
};

type ProjectsResponse = {
  projects: ProjectInfo[];
  untracked?: Partial<UntrackedInfo>;
};

type ServicesResponse = {
  services: ServiceInfo[];
};

interface ProjectStoreState {
  projects: ProjectWithService[];
  services: ServiceInfo[];
  untracked: UntrackedInfo;
  loading: boolean;
  error: string | null;
  actionLoadingByName: Record<string, boolean>;
  load: (token: string) => Promise<void>;
  startPolling: (token: string, intervalMs?: number) => void;
  stopPolling: () => void;
  startService: (name: string, token: string) => Promise<void>;
  stopService: (name: string, token: string) => Promise<void>;
}

let projectPollingInterval: ReturnType<typeof setInterval> | null = null;

async function fetchJson<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `${init?.method || "GET"} ${url} failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}

function mergeProjectsWithServices(projects: ProjectInfo[], services: ServiceInfo[]): ProjectWithService[] {
  const byName = new Map(services.map((service) => [service.name, service]));
  return projects.map((project) => ({ ...project, service: byName.get(project.name) }));
}

/** Shallow-compare two project arrays to avoid unnecessary re-renders */
function projectsEqual(a: ProjectWithService[], b: ProjectWithService[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].name !== b[i].name) return false;
    if (a[i].git?.branch !== b[i].git?.branch) return false;
    if (a[i].git?.dirty !== b[i].git?.dirty) return false;
    if (a[i].containers?.length !== b[i].containers?.length) return false;
    if (a[i].service?.status !== b[i].service?.status) return false;
  }
  return true;
}

export const useProjectStore = create<ProjectStoreState>((set, get) => ({
  projects: [],
  services: [],
  untracked: { containers: [], ports: [] },
  loading: false,
  error: null,
  actionLoadingByName: {},

  load: async (token) => {
    set({ loading: true, error: null });
    try {
      const [projectsRes, servicesRes] = await Promise.all([
        fetchJson<ProjectsResponse>("/api/projects", token),
        fetchJson<ServicesResponse>("/api/services", token),
      ]);

      const projects = Array.isArray(projectsRes.projects) ? projectsRes.projects : [];
      const services = Array.isArray(servicesRes.services) ? servicesRes.services : [];
      const untracked = {
        containers: Array.isArray(projectsRes.untracked?.containers) ? projectsRes.untracked?.containers : [],
        ports: Array.isArray(projectsRes.untracked?.ports) ? projectsRes.untracked?.ports : [],
      };

      const merged = mergeProjectsWithServices(projects, services);
      const prev = get();
      const unchanged = projectsEqual(prev.projects, merged)
        && prev.untracked.containers.length === untracked.containers.length
        && prev.untracked.ports.length === untracked.ports.length;

      if (!unchanged || prev.loading) {
        set({
          projects: merged,
          services,
          untracked,
          loading: false,
          error: null,
        });
      }
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  startPolling: (token, intervalMs = 30_000) => {
    if (projectPollingInterval) {
      clearInterval(projectPollingInterval);
    }

    projectPollingInterval = setInterval(() => {
      void get().load(token);
    }, intervalMs);
  },

  stopPolling: () => {
    if (!projectPollingInterval) return;
    clearInterval(projectPollingInterval);
    projectPollingInterval = null;
  },

  startService: async (name, token) => {
    set((state) => ({
      actionLoadingByName: {
        ...state.actionLoadingByName,
        [name]: true,
      },
      error: null,
    }));

    try {
      await fetchJson<{ ok: boolean; message?: string }>(`/api/services/${encodeURIComponent(name)}/start`, token, { method: "POST" });
      await get().load(token);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set((state) => ({
        actionLoadingByName: {
          ...state.actionLoadingByName,
          [name]: false,
        },
      }));
    }
  },

  stopService: async (name, token) => {
    set((state) => ({
      actionLoadingByName: {
        ...state.actionLoadingByName,
        [name]: true,
      },
      error: null,
    }));

    try {
      await fetchJson<{ ok: boolean; message?: string }>(`/api/services/${encodeURIComponent(name)}/stop`, token, { method: "POST" });
      await get().load(token);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set((state) => ({
        actionLoadingByName: {
          ...state.actionLoadingByName,
          [name]: false,
        },
      }));
    }
  },
}));

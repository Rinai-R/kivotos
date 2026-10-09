/**
 * Ambient types for the Client module. The dsh Client runtime provides these
 * at load time; Kivotos does not depend on dsh packages, so the surface it
 * uses is declared here.
 */

type ReactModule = typeof import("react");

type Translate = (key: string, params?: Record<string, unknown>) => string;

interface SlotRegistration {
  name: string;
  id?: string;
  order?: number;
  locale?: string;
}

interface ClientContext {
  effect(factory: () => () => void, label?: string): void;
  locale: {
    register(ns: string, dictionaries: Record<string, Record<string, string>>): () => void;
  };
  layout: { toggleSidebar(): void };
  slots: {
    inject(name: string, register: () => () => void): void;
    register<Props>(
      registration: SlotRegistration,
      component: (props: Props) => unknown,
    ): () => void;
  };
}

interface ClientPlugin {
  inject: string[];
  apply(ctx: ClientContext): void;
}

interface Window {
  __ModuleLoader__: {
    load(module: {
      id: string;
      factory(require: (id: "react") => ReactModule): ClientPlugin;
    }): void;
  };
}

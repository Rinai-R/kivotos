import type { KivotosApi } from "@kivotos/client";
import { createContext, useContext, type ReactNode } from "react";

const KivotosApiContext = createContext<KivotosApi | null>(null);

export function useKivotosContextValue(): KivotosApi | null {
  return useContext(KivotosApiContext);
}

export function KivotosApiProvider({ children, kivotos }: { children: ReactNode; kivotos: KivotosApi }) {
  return <KivotosApiContext.Provider value={kivotos}>{children}</KivotosApiContext.Provider>;
}

export function useKivotos(): KivotosApi {
  const kivotos = useKivotosContextValue();
  if (!kivotos) throw new Error("useKivotos must run inside a contributed plugin surface");
  return kivotos;
}

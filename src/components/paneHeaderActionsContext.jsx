import { createContext, useContext } from "react";

const PaneHeaderActionsContext = createContext(null);

export function PaneHeaderActionsProvider({ value = null, children }) {
  return <PaneHeaderActionsContext.Provider value={value}>
    {children}
  </PaneHeaderActionsContext.Provider>;
}

export function usePaneHeaderActions() {
  return useContext(PaneHeaderActionsContext);
}

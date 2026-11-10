import { createContext, useContext, useMemo, useState } from "react";
import type { FeedbackController, FeedbackProviderProps } from "./types";
import { Widget } from "./Widget";

const FeedbackContext = createContext<FeedbackController | null>(null);

const inactive: FeedbackController = {
  open() {},
  close() {},
  isOpen: false,
  pendingCount: 0,
  retryPending: async () => {},
};

/** Renders `children` plus the feedback widget, and exposes the widget through {@link useFeedback}. */
export function FeedbackProvider({ children, ...props }: FeedbackProviderProps) {
  const [controller, setController] = useState<FeedbackController>(inactive);
  const value = useMemo(() => controller, [controller]);
  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <Widget {...props} onController={setController} />
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): FeedbackController {
  const controller = useContext(FeedbackContext);
  if (!controller) throw new Error("useFeedback() must be used inside <FeedbackProvider>.");
  return controller;
}

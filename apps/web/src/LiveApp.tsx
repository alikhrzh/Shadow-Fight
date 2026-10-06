import { AccountProvider } from "./account/AccountContext";
import { TrainingFlow } from "./training/TrainingFlow";

export function App() {
  return (
    <AccountProvider>
      <TrainingFlow />
    </AccountProvider>
  );
}
